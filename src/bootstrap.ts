// Composition root — docs/TECHNICAL.md §Sidecar software design, "Construction
// is not the same as starting". Constructs every singleton, then calls
// init() on each in dependency order. This file is the only place `new`
// gets called for a singleton.
//
// Current slice: Logger, the process-level safety net, EventBus,
// ConfigService, MongoService, the three repositories, their owning
// services, AuthService, NginxProcessManager (which is what actually
// calls NginxConfigRenderer now), IngestEventReceiver + RelayRouter, the
// module routers, and a first-cut HttpApi. Still missing vs.
// docs/TECHNICAL.md's module list: StreamState, HealthService,
// StreamOrchestrator and its submodules, AuditLogger — added
// incrementally, bottom-up by dependency. Graceful SIGTERM shutdown
// (stopping nginx/Mongo/HttpApi cleanly on container stop) is also still
// unwired here — a pre-existing gap across every module, not something
// introduced by this step; flagged, not silently left implicit.

import { HttpApi, type ModuleRouter } from "./http-api.ts";
import { ConfigService } from "./infra/config-service.ts";
import { EventBus } from "./infra/event-bus.ts";
import { Logger } from "./infra/logger.ts";
import { MongoService } from "./infra/mongo-service.ts";
import { AuthRouter } from "./modules/auth/auth.router.ts";
import { AuthService } from "./modules/auth/auth.service.ts";
import { HealthRouter } from "./modules/health/health.router.ts";
import { DestinationProfileRepository } from "./modules/profiles/profiles.repository.ts";
import { ProfilesRouter } from "./modules/profiles/profiles.router.ts";
import { ProfileService } from "./modules/profiles/profiles.service.ts";
import { IngestEventReceiver } from "./modules/relay/ingest-event-receiver.ts";
import { NginxProcessManager } from "./modules/relay/nginx-process-manager.ts";
import { RelayStateRepository } from "./modules/relay/relay.repository.ts";
import { RelayRouter } from "./modules/relay/relay.router.ts";
import { UserRepository } from "./modules/users/users.repository.ts";
import { UsersRouter } from "./modules/users/users.router.ts";
import { UsersService } from "./modules/users/users.service.ts";

export interface App {
  readonly logger: Logger;
  readonly eventBus: EventBus;
  readonly config: ConfigService;
  readonly mongo: MongoService;
  readonly users: UserRepository;
  readonly destinationProfiles: DestinationProfileRepository;
  readonly relayState: RelayStateRepository;
  readonly auth: AuthService;
  readonly nginxProcessManager: NginxProcessManager;
  readonly httpApi: HttpApi;
}

export async function bootstrap(): Promise<App> {
  // Step 0: Logger first — everything after this has somewhere to log to.
  const logger = new Logger();

  // Step 0, continued: the process-level safety net, registered before any
  // other init() runs. Something reaching this point escaped every other
  // layer of try/catch in the design; continuing in an unknown state is
  // worse than a clean restart via docker-compose.yml's `restart:
  // unless-stopped`.
  process.on("uncaughtException", (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, "uncaughtException — exiting");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal(
      { reason: reason instanceof Error ? reason.message : reason },
      "unhandledRejection — exiting",
    );
    process.exit(1);
  });

  // init(), in dependency order — Step 1: bootstrap env vars, before Mongo
  // or anything else is touched.
  const eventBus = new EventBus(logger);
  const config = new ConfigService(logger);
  config.init();

  // Step 2: MongoService connects, then the repositories that depend on its
  // Db handle can be constructed and get their own indexes in place.
  const mongo = new MongoService(logger, config.get().mongoUri);
  await mongo.init();

  const users = new UserRepository(mongo.db());
  await users.init();
  const destinationProfiles = new DestinationProfileRepository(
    mongo.db(),
    eventBus,
    config.get().encryptionKey,
  );
  await destinationProfiles.init();
  const relayState = new RelayStateRepository(mongo.db(), eventBus);

  // Step 3: AuthService has no init() — stateless, no side effects beyond
  // per-call behavior.
  const auth = new AuthService(users, eventBus, config.get().jwtSecret);

  // Step 4: NginxProcessManager — subscribes to ActiveProfileChanged and
  // DestinationCredentialsUpdated, and if a profile is already active
  // (a restart, not a fresh install), renders + starts nginx immediately.
  // Ahead of the service objects below since nothing there depends on it
  // and docs/TECHNICAL.md's own numbered init order puts it here, right
  // after MongoService-dependent state exists.
  const nginxProcessManager = new NginxProcessManager({
    logger,
    eventBus,
    destinationProfiles,
    relayState,
    httpPort: config.get().httpPort,
  });
  await nginxProcessManager.init();

  // Step 5: the service objects that orchestrate across more than one
  // repository — UsersService (list-with-status, admin activation) and
  // ProfileService (own-profile activation). Routers below talk only to
  // these, never to a repository directly.
  const usersService = new UsersService(users, destinationProfiles, relayState, eventBus);
  const profileService = new ProfileService(destinationProfiles, relayState);
  const ingestEventReceiver = new IngestEventReceiver(destinationProfiles, relayState, eventBus);

  // Step 6: module routers — each owns its own routes and its own service.
  const routers: ModuleRouter[] = [
    new AuthRouter(auth, users),
    new UsersRouter(usersService, auth),
    new ProfilesRouter(profileService, auth),
    new HealthRouter(mongo),
    new RelayRouter(ingestEventReceiver),
  ];

  // Step 7: HttpApi last — binds the listener only once everything it
  // might touch on an incoming request is already up.
  const httpApi = new HttpApi({
    auth,
    users,
    routers,
    logger,
    httpPort: config.get().httpPort,
  });
  await httpApi.init();

  return {
    logger,
    eventBus,
    config,
    mongo,
    users,
    destinationProfiles,
    relayState,
    auth,
    nginxProcessManager,
    httpApi,
  };
}
