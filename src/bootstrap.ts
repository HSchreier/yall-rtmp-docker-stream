// Composition root — docs/TECHNICAL.md §Sidecar software design, "Construction
// is not the same as starting". Constructs every singleton, then calls
// init() on each in dependency order. This file is the only place `new`
// gets called for a singleton.
//
// Current slice: Logger, the process-level safety net, EventBus,
// ConfigService, MongoService, the three repositories, AuthService, and a
// first-cut HttpApi. Still missing vs. docs/TECHNICAL.md's module list:
// StreamState, the nginx-facing modules (NginxConfigRenderer,
// NginxProcessManager, IngestEventReceiver), HealthService, StreamOrchestrator
// and its submodules, AuditLogger — added incrementally, bottom-up by
// dependency.

import { AuthService } from "./auth-service.ts";
import { ConfigService } from "./config-service.ts";
import { DestinationProfileRepository } from "./destination-profile-repository.ts";
import { EventBus } from "./event-bus.ts";
import { HttpApi } from "./http-api.ts";
import { Logger } from "./logger.ts";
import { MongoService } from "./mongo-service.ts";
import { RelayStateRepository } from "./relay-state-repository.ts";
import { UserRepository } from "./user-repository.ts";

export interface App {
  readonly logger: Logger;
  readonly eventBus: EventBus;
  readonly config: ConfigService;
  readonly mongo: MongoService;
  readonly users: UserRepository;
  readonly destinationProfiles: DestinationProfileRepository;
  readonly relayState: RelayStateRepository;
  readonly auth: AuthService;
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
  const destinationProfiles = new DestinationProfileRepository(mongo.db(), eventBus);
  await destinationProfiles.init();
  const relayState = new RelayStateRepository(mongo.db(), eventBus);

  // Step 3: AuthService has no init() — stateless, no side effects beyond
  // per-call behavior.
  const auth = new AuthService(users, eventBus, config.get().jwtSecret);

  // Step 4: HttpApi last — binds the listener only once everything it might
  // touch on an incoming request is already up.
  const httpApi = new HttpApi({
    auth,
    destinationProfiles,
    relayState,
    mongo,
    logger,
    httpPort: config.get().httpPort,
  });
  httpApi.init();

  return {
    logger,
    eventBus,
    config,
    mongo,
    users,
    destinationProfiles,
    relayState,
    auth,
    httpApi,
  };
}
