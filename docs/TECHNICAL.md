# Technical Design

## What

A single containerized agent that takes one RTMP ingest from OBS (encoded at the one low-quality rendition the operator wants) and relays it live, unmodified, to three destinations at once: Mixcloud Live, YouTube, and Twitch — but *whose* Mixcloud/YouTube/Twitch is a per-user choice. Each user account has its own destination profile (own stream keys, own ingest key); exactly one profile is **active** at a time, and that's whose credentials the relay is currently configured with. One broadcast at a time, multiple people who could be the one broadcasting.

Stack: **Docker**, **nginx** (`nginx-rtmp-module`) doing the actual RTMP relay, **Bun + TypeScript** as a control/health sidecar process running alongside it — compiled to a single standalone binary (`bun build --compile`), not run from source, to keep the runtime image small and startup fast — **MongoDB** persisting per-user destination profiles and which one is active, and an **auth layer** (real user accounts, not a single shared token) gating who can edit or activate a profile.

**Runtime switched from Node.js to Bun** partway through this design, specifically for `bun build --compile`: the sidecar ships as one compiled executable, not source + a separate JS runtime + `node_modules` in the final image. Everything designed against Node's own APIs (`node:http`-equivalent behavior via `Bun.serve`, `child_process`, the native `mongodb` driver) is expected to keep working, since Bun implements most of Node's API surface — but that expectation needs verifying against a real build, not assumed; see Open Questions.

## Why

- **One source, one quality, three destinations — per active profile.** There's no adaptive bitrate requirement and no per-destination rendition — whichever profile is active, every destination gets exactly what OBS sends. That rules out transcoding entirely: the relay only needs to copy packets, not decode/re-encode them.
- **No single destination should be able to stall the others.** Twitch, YouTube, and Mixcloud are three different backends with different reliability characteristics. A relay design where one slow or dead destination blocks the others is a real risk with three simultaneous pushes.
- **Low latency matters more than flexibility on the data path.** The destination *platforms* are fixed (Mixcloud/YouTube/Twitch, always) per profile — but which profile is live, and what its keys are, need to change without a redeploy, so config lives in Mongo behind an authenticated API rather than baked into `.env`. This only affects the control path; the RTMP relay path itself is unchanged.
- **Resilience and observability are first-class, not bolted on.** Auto-reconnect per destination and a health endpoint are v1 requirements, not follow-ups.
- **Config changes need real accountability.** More than one person can plausibly change stream keys — that means actual user accounts, not a single shared secret passed around.
- **Per-user profiles, not per-user simultaneous streams.** The relay stays a single nginx `ingest` application with static `push` directives — the architecture already chosen for its failure-isolation properties. Multiple users each having their own profile doesn't change that; only one profile is ever active, so nginx only ever needs one coherent, statically-rendered config at a time. Concurrent multi-user streaming was considered and rejected — see Explicitly not doing.

## How

### RTMP relay: nginx + nginx-rtmp-module

nginx accepts the OBS publish on a single `ingest` application, authenticated by treating the stream key itself as the secret (`rtmp://<host>/ingest/<key>` — any other key is rejected). **That key is the *active profile's* ingest key, specifically** — not a fixed value baked in once. It then holds up to three static `push` directives, one per *enabled* destination on the active profile, each doing a pure stream copy (no transcoding directive anywhere in the config). A disabled destination on the active profile simply gets no `push` line at all, rather than one pointed at an empty key.

Switching which profile is active means re-rendering this whole block — new ingest key, new push targets — and reloading. It's a full config swap, not a partial one: the previously-active user's ingest key stops being valid the moment a different profile activates, which is the intended behavior (activating someone else *is* handing them the broadcast), but it does mean activating a new profile while the old one is mid-stream cuts that stream off. See Open Questions for what that transition actually looks like in practice.

```
OBS ──RTMP──▶ nginx-rtmp (ingest app, key-based auth)
                   │
                   ├──push (copy)──▶ Mixcloud Live
                   ├──push (copy)──▶ YouTube
                   └──push (copy)──▶ Twitch
```

Each `push` target is its own outbound connection managed independently by nginx's event loop — a stalled or dead destination affects only its own connection, not the other two. Reconnection on a dropped push is handled by nginx-rtmp's own `push_reconnect` directive, natively — no custom reconnect logic needed in the agent.

The `ingest` application also configures nginx-rtmp's `notify` module: `on_publish` and `on_publish_done` point at internal-only HTTP callbacks on the sidecar. nginx calls these itself, the instant a publish starts or stops — this is how the sidecar learns the ingest is live, and it's push-based from nginx's side, not something the sidecar has to ask for.

### Control/health sidecar: Bun + TypeScript

Runs as a second process in the same container, responsible for everything that isn't the RTMP data path itself:

- Validates required configuration (stream keys for all three destinations, the ingest key) at startup and fails fast with a clear error if anything is missing, before nginx even starts.
- Renders the nginx config from a template using that configuration.
- Starts nginx as a child process and supervises it (if nginx dies, the container should exit/restart rather than silently run with no relay).
- Receives nginx's own `on_publish`/`on_publish_done` webhook calls and exposes a small, safe HTTP API (`/health`, `/stats`) for external monitoring — built entirely from those events plus the child process's own state, no polling of nginx involved.
- Handles graceful shutdown (SIGTERM stops nginx cleanly rather than killing it out from under an active broadcast).

One container, one process tree, Node as the supervising entrypoint — matches "agent" as a single deployable unit rather than a multi-container system for what is fundamentally one job.

### Sidecar software design

Goal: one process, minimal memory footprint, every side effect flowing through one EventBus rather than modules polling each other or calling each other's methods directly.

**Composition root.** `bootstrap.ts` is the only place any *singleton* service gets constructed. Every singleton is instantiated exactly once, injected into whatever needs it via constructor. No module reaches for another by importing it directly; everything talks through an injected reference or the EventBus. No DI framework/container (e.g. InversifyJS, tsyringe) — plain constructor injection wired by hand. A reflection-based container adds runtime overhead and a dependency for something this size; hand-wiring the `new` calls isn't the part of this project worth abstracting.

**Construction is not the same as starting.** Every singleton follows the same two-phase contract: `constructor(deps)` only wires references — no I/O, no EventBus subscriptions, no side effects, so an object can exist without anything happening yet. `init()` is where the actual startup work happens — connecting, subscribing, checking existing state, rendering, listening — and `bootstrap.ts` constructs every singleton first, then calls `init()` on each **in dependency order**, not construction order or file order:

0. `Logger` is constructed (not `init()`'d — it has no async startup, it's ready the instant it exists) before anything else, and `process.on('uncaughtException'/'unhandledRejection')` is registered immediately after — so literally everything from this point on, including `ConfigService.init()` failing, has somewhere to log to and a safety net underneath it.
1. `ConfigService.init()` — parse/validate bootstrap env vars; throws immediately if anything's missing, before Mongo or anything else is touched.
2. `MongoService.init()` — connects the client, registers the driver's own connection-topology events (feeding `isConnected()`/`getLastError()`).
3. `NginxProcessManager.init()` — subscribes to `ActiveProfileChanged` and `DestinationCredentialsUpdated`; checks `RelayStateRepository.getActiveUserId()` — if a profile is already active (a restart, not a fresh install), renders and starts nginx immediately; if not, just subscribes and waits for the first activation from the setup wizard.
4. `StreamState.init()`, `StreamOrchestrator.init()`, `AuditLogger.init()` — each subscribes to its own events. (Repositories, `AuthService`, `NginxConfigRenderer` don't need an `init()` at all — they have no startup-time side effects, only per-call behavior, so they're fully ready the moment they're constructed.)
5. **`HealthService` — no subscriptions of its own, nothing to connect, but it composes reads from `StreamState`, `NginxProcessManager`, and `MongoService`, so it has to be constructed and become readable only after all three of those have already run their `init()`.** This is the concrete answer to "where does health go": not wherever's convenient, specifically after the things it reads from are actually up — otherwise `/health` could report on a `NginxProcessManager` that hasn't registered its own child-process listeners yet, which is worse than useless, it's actively misleading.
6. `HttpApi.init()` — binds the listener and starts accepting connections, last of all. No request should be able to arrive before every dependency it might touch is actually ready.

Not everything is a singleton, though — see `StreamStatsSession` below. A singleton is right for a domain concern that exists once for the life of the process (config, the Mongo pool, the nginx child process). It's wrong for something whose lifetime is tied to an event, like one broadcast — that needs an object created on the start event and destroyed on the end event, not a permanent instance with an `if (active)` flag bolted onto it.

**Event taxonomy.** Events are typed objects per domain, not bare strings with loose payloads — the payload shape is part of the event's identity, enforced at the type level.

- **User events** — authenticated dashboard actions: `UserLoggedIn { userId, at }`, `UserLoggedOut { userId, at }`, `UserRegistered { userId, email, role, registeredBy, at }`, `DestinationCredentialsUpdated { userId, destination, at }`, `ActiveProfileChanged { userId, activatedBy, at }`. Deliberately never carries the credential value itself — a listener that needs the actual key re-reads it from `DestinationProfileRepository`, the source of truth. The event says *what changed and who changed it*, not *here is the secret*. `DestinationCredentialsUpdated` only triggers a re-render if `userId` matches the currently active profile — editing a profile that isn't live persists to Mongo but doesn't touch nginx; `ActiveProfileChanged` always triggers a full re-render + reload (or first start), since ingest key and all destinations swap together.
- **Client events** — RTMP connection lifecycle below the level of an authorized publish: `IngestClientConnected { address, at }`, `IngestClientDisconnected { address, at }`. This is distinct from stream events because a client can complete the RTMP handshake and never successfully publish (wrong stream key, for instance) — that's visible here even when nothing ever starts streaming. (This is my read of what you meant by "client events" as distinct from stream start/stop — flag it if that's not the distinction you had in mind.)
- **Stream events** — the publish lifecycle, from nginx's `on_publish`/`on_publish_done` plus a state we derive ourselves: `StreamStarted { streamKey, at, dataType, chunkSize }`, `StreamEnded { streamKey, at, durationMs, totalBytesIn }`, `StreamIdle { streamKey, since, at }`, `StreamResumed { streamKey, at }`. `StreamIdle`/`StreamResumed` cover "still connected, no data actually flowing" — a frozen OBS or a stalled network path doesn't trigger a clean `on_publish_done`, so it has to be detected, not just relayed from nginx. `dataType` (video/audio codec) and `chunkSize` are flagged in Open Questions below — not confirmed yet that nginx's publish callback actually carries them.
- **Stat events** — owned by a per-broadcast submodule, not a global poller (see `StreamStatsSession` below): `StreamStatUpdated { streamKey, bytesIn, bitrateKbps, at }`. This is also what idle detection derives from — see `StreamIdleDetector` below.
- **Log events** — cross-cutting: `LogEvent { source, payload, at }`, one wrapping any event from the domains above, for audit/observability. Sink: structured stdout via Pino, redacted — see Error handling, logging & try/catch discipline below.

**Modules** (each a singleton unless noted, one file, one responsibility):

- `Logger` — wraps Pino, constructed *before every other singleton, including `ConfigService`*, so even a config-validation failure logs cleanly. One shared redact list (stream keys, passwords, tokens) guards both this and the `secret-like-field-in-event-payload` Semgrep rule — see Error handling below. Everything else either subscribes to `LogEvent` (`AuditLogger`) or calls into it directly on error (never through the `EventBus` — see below for why).
- `ConfigService` — parses & validates *bootstrap* env vars exactly once at startup: Mongo URI, JWT secret, HTTP port. Not the destination stream keys anymore — those live in Mongo (see Persistence & auth below).
- `MongoService` — owns the single MongoDB client/connection pool. Everything that touches the database goes through this, not through ad hoc `MongoClient` instances — one pool for the process. Same getter/private-setter shape as `StreamState`: `isConnected()`, `getLastConnectedAt()`, `getLastError()`, updated only from the native driver's own connection topology events (`serverHeartbeatSucceeded`/`serverHeartbeatFailed`) — push-based from the driver, not a poll we write ourselves. Those handlers carry their own local try/catch — they're listeners on the driver's own emitter, not ours, so `EventBus`'s centralized error handling doesn't cover them.
- `DestinationProfileRepository` — reads/writes each user's own profile (ingest key + three destination stream keys, each individually enabled/disabled, each with an optional custom ingest URL override). One document per user, keyed by `userId`. Emits `DestinationCredentialsUpdated` on write.
- `RelayStateRepository` — the one document recording which single profile is currently active (`activeUserId`). `NginxConfigRenderer`'s actual source of truth is "whichever profile `RelayStateRepository` currently points at," not any one fixed document. Emits `ActiveProfileChanged` on write.
- `UserRepository` — reads/writes user accounts (email, password hash, role) in Mongo. Exposes an `isEmpty()` check `AuthService` uses to decide whether a register call is the unauthenticated bootstrap case.
- `AuthService` — verifies credentials against `UserRepository`, issues and verifies JWTs (role included in the payload), handles registration (bootstrap-or-admin-gated, per Persistence & auth below), emits `UserLoggedIn`/`UserLoggedOut`/`UserRegistered`. Stateless — no server-side session store, so no `sessions` collection to manage or leak. Also the one place role-based authorization is checked (`requireRole('admin')` used by `HttpApi` route handlers) — kept here rather than scattered per-route, so "what role can do what" has one home. On login, also issues the `HttpOnly`/`Secure`/`SameSite=Strict` cookie the browser UI relies on (see Frontend & first install below) — same JWT, two delivery mechanisms.
- `NginxConfigRenderer` — renders `nginx.conf` from `RelayStateRepository`'s active user id, resolved to that user's document via `DestinationProfileRepository`. Runs at startup (if a profile is already active), on `ActiveProfileChanged` (always), and on `DestinationCredentialsUpdated` (only when the edited profile is the active one).
- `NginxProcessManager` — spawns and supervises the nginx child process, and reloads it after a config change. Owns the only reference to the child process handle. Emits `nginx.started` / `nginx.exited` / `nginx.crashed` onto the EventBus — these come from the (Node-compatible) `child_process` events Bun implements (`exit`, `error`), inherently event-driven, not polled, and handled with their own local try/catch (same reason as `MongoService`'s driver-event handlers — `child_process` isn't our `EventBus`). Same getter/private-setter shape as `StreamState`: `isRunning()`, `getPid()`, `getLastExitCode()`, `getLastCrashError()`, updated only from its own `child_process` event handlers. Branches on its own `isRunning()` whenever a re-render is warranted: not running yet (fresh install, or no profile has ever been activated) → `.start()`; already running → `.reload()`. Same handler for both `ActiveProfileChanged` and a same-profile `DestinationCredentialsUpdated`, one `if`. Attempts a restart after `nginx.crashed`; after 3 crashes within 60s, gives up and exits the whole sidecar instead of crash-looping — see Error handling below.
- `IngestEventReceiver` — handles the internal-only HTTP routes nginx itself calls (publish/unpublish and, if available, connect/disconnect — per the `notify` module config in the RTMP relay section above). Translates each call into the corresponding Client or Stream event. Bound to loopback only.
- `StreamOrchestrator` — the singleton that owns the broadcast lifecycle. Doesn't itself know how to collect stats or detect idle — it's constructed with an injected list of **submodule factories** (`bootstrap.ts` wires this: `new StreamOrchestrator(eventBus, [statsSessionFactory, idleDetectorFactory])`). On `StreamStarted`, it calls every factory to create one submodule instance per stream and calls `.start(streamKey)` on each. On `StreamEnded` or `nginx.crashed`, it calls `.dispose()` on every live submodule for that stream — a broadcast's submodules never outlive the event that justified them, and adding a new per-stream concern later (say, a destination-lag detector) means writing one more submodule and adding it to the injected list, not touching the orchestrator itself.
- **Submodule contract** — every per-stream submodule implements `start(streamKey)` / `dispose()`. `dispose()` is guaranteed to clear any timer *and* unsubscribe any EventBus listener the submodule registered — the same "leaked closure" risk as any other listener, just scoped to a shorter lifetime here.
  - `StreamStatsSession` — **not a singleton**, one instance per active broadcast. The only submodule that owns an actual timer: its constructor starts a bounded interval, `dispose()` clears it. Emits `StreamStatUpdated`. The interval callback has its own local try/catch — required, not optional, since an uncaught throw inside a `setInterval` callback becomes an `uncaughtException` with nothing upstream to catch it. Logs and skips the tick on error; disposes itself after 3 consecutive failures rather than looping forever.
  - `StreamIdleDetector` — **not a singleton**, one instance per active broadcast, but **owns no timer of its own**. It subscribes to `StreamStatUpdated` and tracks whether `bytesIn` has grown since the last tick; N consecutive ticks with no meaningful growth emits `StreamIdle` (once, not per tick — a flag prevents duplicate emits), growth resuming after that emits `StreamResumed`. Riding the stats submodule's existing cadence instead of running a second interval means one active stream still only ever has one timer in the whole process, not two.
- `StreamState` — the domain singleton for "what is happening with the stream right now." Public getters only: `getStatus(): 'offline' | 'live' | 'idle'`, `getStreamKey()`, `getBytesIn()`, `getBitrateKbps()`, `getStartedAt()`, `getLastEventAt()`. The setters are **private**, called only from `StreamState`'s own EventBus subscriptions (`StreamStarted` / `StreamEnded` / `StreamIdle` / `StreamResumed` / `StreamStatUpdated`, registered once at construction) — nothing outside this class can push state into it directly, only trigger it indirectly by emitting the event. One mutable object, overwritten in place — no history array. This replaces what used to be a duplicate copy of the same state living inside `HealthService`.
- `HealthService` — tracks no state of its own; it *composes* a `/health` response by reading `StreamState.getStatus()`, `NginxProcessManager.isRunning()`, and `MongoService.isConnected()` — three separate facts, three separate owners, `HealthService` just assembles the read. Thin by design.
- `AuditLogger` — subscribes broadly (user + client + stream events) and emits `LogEvent`s to whatever sink is decided (see Open Questions).
- `HttpApi` — built on `Bun.serve`, Bun's built-in HTTP server, exposing `/health`, `/stats` (public), the internal nginx-notify routes (loopback only), `/auth/login`, `/auth/register` (open only for bootstrap, admin-gated after), `/profile` GET/PUT (own profile — `user` or `admin`), `/profile/activate` POST (own profile → active — `user` or `admin`), `/users/:userId/activate` POST (any profile → active — `admin` only), `/events` (SSE, authenticated), and the static UI pages (`/`, `setup.html`, `login.html`, `dashboard.html`, `app.js`/`app.css`, served from memory). `/stats` reads `StreamState`'s getters directly; `/health` reads `HealthService`. Accepts auth via cookie or `Authorization: Bearer`. Owns the `Set` of open SSE connections and the single EventBus subscription that fans out to all of them — the only per-connection state it holds; everything else stays stateless across requests.
- `EventBus` — typed emitter; the one thing every other service depends on. `emit()` wraps each listener invocation in its own try/catch internally — one subscriber throwing is logged and isolated, never propagates, never blocks the other subscribers for that same event. See Error handling below for why this centralization only covers listeners on *this* emitter, not `child_process` or the Mongo driver's.

**File layout for what's actually built so far.** The modules above are grouped by domain folder under `src/modules/{auth,users,profiles,relay,health}/`, each with its own `*.router.ts` (HTTP <-> service translation only, no domain decisions) and, where there's real orchestration to own, a `*.service.ts` — `UsersService.listWithStatus()`/`.activateFor()`, `ProfileService.activateOwn()`. Repositories stay dumb (CRUD + the event emit on write); a router never reaches into a repository directly for anything that spans more than one collection — that orchestration belongs to the service, not scattered inline in the HTTP layer. Cross-cutting infra (`EventBus`, `Logger`, `ConfigService`, `MongoService`, the typed error hierarchy, the session-cookie/bearer-token extraction helper) lives under `src/infra/`, imported by any module that needs it, never the reverse. `bootstrap.ts` and the top-level `http-api.ts` (static asset serving, root-route redirect, dispatch to whichever module router's `handle()` matches) are the only files still living at `src/` root — everything else that owns a domain concern sits under `modules/`.

**Event flow:**

```
Startup:
ConfigService ──bootstrap config──▶ MongoService ──connects──▶ RelayStateRepository (is a profile active?)
                                                                        │ (yes — a restart, not a fresh install)
                                                        NginxConfigRenderer ──renders active profile──▶ NginxProcessManager.start()
                                                                        │
                                                     nginx.started / nginx.crashed ──▶ EventBus

Runtime — editing the active profile's credentials (authenticated, User event):
HttpApi ──verified via AuthService──▶ DestinationProfileRepository.update()
                                                │
                                  DestinationCredentialsUpdated ──▶ EventBus
                                                │ (only if userId == active profile)
                                    NginxConfigRenderer (re-renders) ──▶ NginxProcessManager.reload()

Runtime — activating a different profile (authenticated, User event):
HttpApi ──verified via AuthService──▶ RelayStateRepository.setActive(userId)
                                                │
                                     ActiveProfileChanged ──▶ EventBus
                                                │ (always — ingest key + destinations both changed)
                                    NginxConfigRenderer (re-renders) ──▶ NginxProcessManager.start()/.reload()

Broadcast lifecycle (push-based to start; one bounded timer total while live):
nginx (on_publish) ──▶ IngestEventReceiver ──StreamStarted──▶ EventBus ──▶ StreamOrchestrator
                                                                                    │
                                                               for each injected factory: create + .start(streamKey)
                                                                                    │
                                                       ┌────────────────────────────┴────────────────────────────┐
                                                       ▼                                                          ▼
                                            StreamStatsSession                                          StreamIdleDetector
                                          (owns the one timer)                                      (owns no timer — listens only)
                                                       │                                                          ▲
                                                       └──────────────── StreamStatUpdated ──▶ EventBus ──────────┘
                                                                                                    │
                                                                          (no growth for N ticks) StreamIdle ──▶ EventBus
                                                                          (growth resumes)      StreamResumed ──▶ EventBus

nginx (on_publish_done) ──▶ IngestEventReceiver ──StreamEnded──▶ EventBus ──▶ StreamOrchestrator
   (or nginx.crashed, from NginxProcessManager) ─────────────────────────────────────┘
                                                                                    │
                                                            .dispose() on every live submodule for that stream
                                                                       (timer cleared, listeners unsubscribed)

Ongoing:
EventBus ──StreamStarted/Ended/Idle/Resumed/StatUpdated──▶ StreamState (private setters, public getters)
                                                                    │
                                        HttpApi./stats reads StreamState directly
                                                                    │
                                        HealthService reads StreamState.getStatus() + NginxProcessManager's process state
                                                                    │
                                                            HttpApi./health reads HealthService
EventBus ──▶ AuditLogger (writes LogEvents)
```

**Memory discipline:**

- **No unscoped timers.** Ingest liveness comes from nginx's `on_publish`/`on_publish_done` webhooks (push, not poll); nginx process health comes from `child_process` exit events (push, not poll). The one exception is `StreamStatsSession`, and it's a deliberate, bounded one: its timer is created in its constructor and guaranteed cleared in its `dispose()`, called by `StreamOrchestrator` the instant the owning stream ends (cleanly or via `nginx.crashed`). `StreamIdleDetector` sits alongside it as a second submodule but owns no timer of its own — it derives idle state from `StreamStatUpdated` ticks the stats session already produces, so one active broadcast is still only one timer in the whole process, not two. Zero instances exist when nothing is streaming, so zero timers run when nothing is streaming — the discipline isn't "no timers ever," it's "no timer whose lifetime isn't provably tied to the event that justifies it, and don't add a second one where an existing event stream already carries the signal." Docker's own `HEALTHCHECK` is the only other interval-driven thing touching this system, and it's infrastructure calling `/health` from outside the process, not app code polling itself.
- No history retention — `StreamState` overwrites its fields in place; nothing accumulates past states, and `HealthService` holds no state of its own to duplicate it.
- No framework where a socket suffices — plain `Bun.serve` with hand-rolled routing, not an Express/Fastify dependency tree, still true even once the UI's static pages and `/events` are added on top. Revisit only if the route count grows enough that hand-rolled routing itself becomes the maintenance burden (see open questions).
- Listeners registered once, in each module's `init()`, called once from `bootstrap.ts` — never inside a hot path (a poll tick, an HTTP request). Subscribing inside a hot path is exactly the pattern that leaks closures over the life of a long-running process.
- Single process, no worker pool — one RTMP source, three fixed pushes, all handled by nginx; the sidecar itself never needs concurrency beyond Node's own event loop.
- One Mongo connection pool for the whole process, owned by `MongoService` — no repository opens its own client.
- No ODM — native `mongodb` driver, not Mongoose. Three small collections (`users`, `destination_profiles`, `relay_state`) don't justify the schema-casting/memory overhead of an ODM layer.
- **No BullMQ/Redis, for now.** Considered for `StreamStatsSession`'s timer (a repeatable job instead of a raw `setInterval`) and for decoupling `AuditLogger`'s Mongo writes from the request/event path. Neither need is real yet: the stats timer is already correctly bounded by object lifecycle without it, and log-write volume here is tiny (one process, occasional user actions, one broadcast at a time) — nothing queuing up. Redis is a whole extra piece of infrastructure and its own memory footprint; adding it before there's an actual queuing/retry/delayed-job problem would be solving one that doesn't exist yet. Revisit if a real need shows up (e.g. retryable async validation of a destination key before saving it).

### Error handling, logging & try/catch discipline

Every error in this design falls into one of six sources, and each source gets a *different* answer for who catches it — because Node doesn't give the same safety guarantees everywhere, and pretending it does is how a transient Mongo blip ends up crash-looping the whole container.

**The rule that decides where try/catch actually goes:** our own `EventBus` is infrastructure we wrote, so we can make it swallow-and-log a listener's error centrally, once. Anything hooking into an emitter we *didn't* write — Node's `ChildProcess` (`child.on('exit', ...)`), the MongoDB driver's own connection events, a raw `setInterval` callback — gets no such protection for free. An uncaught throw inside any of those becomes an `uncaughtException` and crashes the process by default. So:

1. **`EventBus` listeners** — wrapped centrally, inside `EventBus.emit()` itself, not by each subscriber. One listener throwing is caught, logged (with the event name and which listener), and **does not stop other listeners for the same event from running**, and does not propagate. No module needs its own try/catch around its own event handler body for this reason alone.
2. **`NginxProcessManager`'s `child_process` listeners, `MongoService`'s driver-event listeners, `StreamStatsSession`'s timer callback** — these are **required** to have their own local try/catch, specifically because they're the one category not covered by rule 1. This is the one place explicit try/catch is mandatory, not a style choice.
3. **`HttpApi` route handlers** — one centralized wrapper applied when routes are registered (not per-handler try/catch), catching both sync throws and rejected promises, logging, and mapping to a response. Individual handlers only need their own try/catch for genuine custom recovery (e.g. "retry this write once") — never just to format an error response, since the wrapper already does that correctly based on error type.
4. **Repositories** — let Mongo errors propagate; translate the ones that matter into typed errors at the point they're thrown (a duplicate-key error on the bootstrap-race unique index becomes a `ConflictError`, not a raw driver exception leaking up to an HTTP handler that doesn't know what to do with it).
5. **`AuthService`/business logic** — throws typed errors (below), doesn't catch its own; the HTTP wrapper or an EventBus listener up the chain is where handling actually happens.
6. **Process-level safety net** — `process.on('uncaughtException')` / `process.on('unhandledRejection')`, registered *first* in `bootstrap.ts`, before anything else. Logs at `fatal`, then `process.exit(1)` deliberately — not an attempt to keep running. Something reaching this point means it escaped every layer above; continuing in an unknown state is worse than a clean restart via `docker-compose.yml`'s existing `restart: unless-stopped`.

**Typed errors** — a small hierarchy, not one generic `Error` everywhere: `AppError` (base, carries a status + machine-readable `code`), with `ValidationError` (400), `AuthError`/`ForbiddenError` (401/403), `NotFoundError` (404), `ConflictError` (409 — the bootstrap race), `UpstreamError` (503 — Mongo or nginx unreachable). The HTTP wrapper checks `instanceof AppError` to pick the response; anything else is an unexpected bug, becomes a generic 500, and **the raw error/stack trace never reaches the client** — only the log.

**Logging: Pino, specifically for redaction — a deliberate exception to "no framework where unnecessary."** Structured logging by itself could be hand-rolled (`console.error(JSON.stringify(...))`), but redaction is the actual requirement here, not a nice-to-have: an error thrown while handling `PUT /profile` could easily have the request body attached as context, and that body contains a raw stream key. The same risk the `secret-like-field-in-event-payload` Semgrep rule guards against for events exists identically for error logs. Pino's `redact` option is a maintained, tested implementation of exactly this; hand-rolling our own regex-based scrubbing is the kind of thing that's easy to get subtly wrong and silently miss a field. One shared redact list (`ingestStreamKey`, every destination `streamKey`, `password`, `passwordHash`, `token`) — worth keeping in sync with (or generating from the same source as) the Semgrep rule's field list, since they're guarding against the same mistake in two different places.

**`Logger` is a new singleton, constructed *before* everything else** — even before `ConfigService`, so a failure during config validation itself still gets logged cleanly. `AuditLogger` (the existing `LogEvent` subscriber) calls into it for domain events; every error-catching layer above calls into it directly for errors — **not** through the `EventBus`, deliberately: routing error reports through the same bus that might itself be the thing failing is circular. This also resolves the earlier open question about `LogEvent`'s sink: **structured stdout via Pino, not a Mongo `logs` collection** — writing error/audit logs to the same database that might be the reason something's failing is its own circular-dependency risk, and container stdout is already captured by Docker/whatever the host aggregates logs with, with nothing extra to build.

**Displaying errors, not just logging them** — the UI needs both: HTTP error responses from `/profile` etc. surface as inline form errors (standard REST handling client-side, not specified further here — implementation detail). But `nginx.crashed` and `MongoService` losing its connection are *not* things a user would discover from a failed button click — they should reach the dashboard proactively. `/events` (SSE) already carries `StreamState` changes; extending it to also push `nginx.crashed` and Mongo connectivity changes means the dashboard can show a "relay lost connection to nginx" banner instead of the operator only finding out when they try to do something and it silently doesn't work.

**Crash-loop protection for nginx specifically** — `NginxProcessManager` may attempt to restart the nginx child after a crash, but if it crashes repeatedly in a short window (e.g. 3 times within 60s), it gives up and lets the *sidecar itself* exit rather than tight-looping forever — Docker's own `restart: unless-stopped` has its own backoff at the container level, which is the right place for that backoff to live, not duplicated inside the app.

### Persistence & auth

**Collections:**

- `destination_profiles` — one document per user: `{ userId (unique), ingestStreamKey, mixcloud: { enabled, streamKey, customIngestUrl? }, youtube: { enabled, streamKey, customIngestUrl? }, twitch: { enabled, streamKey, customIngestUrl? }, updatedAt, updatedBy }`. `customIngestUrl` is the fix for a real gap found while designing this: the default ingest URLs (`rtmp.mixcloud.com`, `a.rtmp.youtube.com`, `live.twitch.tv`) are hardcoded per platform, but Twitch specifically has multiple regional ingest servers and picking the closest one is a genuine, documented latency win — directly relevant given this whole project's stated goal. Rather than maintain a curated region list that can go stale, each destination just accepts an optional raw override URL, falling back to the documented default when unset. `enabled` is the other gap this closes: a destination with no key, or explicitly disabled, gets no `push` line at all instead of one pointed at nothing.
- `relay_state` — a single document: `{ activeUserId, activatedAt, activatedBy }`. The pointer `NginxConfigRenderer` actually reads.
- `users` — `email`, `passwordHash` (bcrypt), `role: 'user' | 'admin'`, `createdAt`, `registeredBy` (another user's id, or `null` for the one bootstrap account).

**Roles:**

- `user` — can read and write **their own** destination profile, and activate **their own** profile (make themselves the current broadcaster).
- `admin` — everything `user` can do for their own profile, plus `POST /auth/register` (create other accounts, as either role) and activating *any* user's profile (`/users/:userId/activate`) — useful when one person operates the tablet/relay but different people are the ones actually streaming. Editing *another* user's stream keys is **not** included for v1 — see Open Questions.

**Registration flow (bootstrap-then-admin-gated — no public signup at any point):**

- `POST /auth/register` when the `users` collection is empty: allowed unauthenticated, exactly once in practice. The `role` field in the request body is **ignored** in this case — the account is forced to `admin` regardless of what's sent, since this is specifically the "create the first admin" path, not a general signup endpoint that happens to be open right now.
- `POST /auth/register` once the collection is non-empty: requires a valid **admin** JWT. The calling admin sets the new account's `role` explicitly (`user` or `admin`). A non-admin `user` token gets `403`, not `401` — it's a valid session, just the wrong role.
- Emits `UserRegistered { userId, email, role, registeredBy, at }` on success (`registeredBy: null` for the bootstrap account).

**Auth flow:**

- `POST /auth/login` — email + password against `UserRepository`; on success, issues a JWT (short-lived access token, signed with a secret from `ConfigService`'s bootstrap env vars — this one secret has to stay in `.env`, it's what bootstraps trust in the first place). JWT payload carries `role` so `HttpApi` can authorize without a Mongo lookup per request.
- Protected routes require `Authorization: Bearer <jwt>`, verified by `AuthService`: `/profile` GET/PUT and `/profile/activate` need role `user` or `admin`, scoped to the caller's own `userId`; `/users/:userId/activate` and `/auth/register` need role `admin` (except the one-time bootstrap case above). No server-side session store — the JWT itself is the full auth state.
- Passwords hashed with **`Bun.password`** (built into the Bun runtime — no `bcrypt`/`bcryptjs` npm dependency at all) before ever touching Mongo; plaintext never persisted or logged. This resolves what used to be an open question (native `bcrypt` vs. pure-JS `bcryptjs`) in the direction the compile-to-binary decision above already forces: a native-addon dependency like `bcrypt` doesn't bundle into a `bun build --compile` output the way pure JS does, and `Bun.password` sidesteps the question entirely by not being an external dependency in the first place. Minimum length: 12 characters — a `ValidationError`, checked before hashing, not after (per `docs/design-briefs/screens-and-journeys.md`).

**Security invariants:**

- `updatedBy` on a profile write, `registeredBy` on a registration, and `activatedBy` on an activation, always come from the verified JWT's user id — never from the request body.
- **Ownership check on `/profile`:** a `user`-role request can only ever read/write/activate the profile matching its own JWT's `userId` — never a `userId` from the request body or params. `admin` is the only role that can act on a `userId` that isn't its own, and only for activation, not editing keys.
- The bootstrap unauthenticated path only ever forces role `admin`; it never trusts a client-supplied role. Once one user document exists, that path is closed — every subsequent registration requires an admin JWT, full stop.
- `/health` and `/stats` stay public/unauthenticated (they're already scrubbed of secrets); every other route that reads or changes state requires auth.
- The RTMP ingest path is untouched by any of this in terms of *mechanism* — OBS still authenticates purely via the stream-key-as-secret model — but *which* key is currently valid now depends on which profile is active. Auth here gates who can change a profile's keys, who can become the active broadcaster, and who can create accounts.

### Frontend & first install

**What it is:** a handful of server-rendered HTML pages, served by `HttpApi` itself — no bundler, no framework, no separate build pipeline or container. This is a single-operator tool with four screens; a full SPA would be a footprint mismatch with everything else in this design. Static files (`setup.html`, `login.html`, `dashboard.html`, one shared `app.js`/`app.css`, plus the `mark-32.png`/`mark-180.png` favicon and apple-touch-icon from `assets/brand/` — see `docs/design-briefs/screens-and-journeys.md` §Visual identity) live in the same image, read once at startup and served from memory — they're tiny and never change at runtime, so there's no reason to hit disk per request.

**Auth for the browser: cookie, alongside the existing Bearer header.** `POST /auth/login` now sets an `HttpOnly; Secure; SameSite=Strict` cookie carrying the JWT, *in addition to* returning it in the JSON body — a full-page navigation can't attach an `Authorization` header, so cookie-based auth is what makes server-rendered pages work at all. `HttpApi`'s auth check accepts either the cookie or the Bearer header — the cookie for the UI, the header still available for scripts/curl. `HttpOnly` means page JS can't read the token even if something else on the page were compromised; `SameSite=Strict` is the CSRF mitigation — a cross-site request simply never carries the cookie, so there's no need for a separate CSRF token scheme on top of it, given this UI is single-origin by construction (the same process that serves the pages serves the API).

**Bootstrap wizard — reuses the same routes and events already designed, doesn't add new ones:**

1. `docker compose up`. The sidecar starts, connects to Mongo, starts `HttpApi` immediately — but **`NginxProcessManager` does not start nginx yet** if `RelayStateRepository` has no active profile. This is a real gap the original design didn't cover: `ConfigService`'s "fail fast if config is missing" logic was written when destination keys were env vars, always present by the time the container could even start. Now that they live in Mongo and are per-user, "nobody's active yet" is the normal state on a fresh install, not an error — nginx simply stays down until someone is, and the UI is the only thing up at that point.
2. `GET /` checks, in order: `UserRepository.isEmpty()` → serve `setup.html`. Not empty, no valid cookie/header → serve `login.html`. Authenticated → serve `dashboard.html`.
3. `setup.html` — email + password form, posts to `POST /auth/register` (the bootstrap case, forced `admin` role, already designed above). Sets the cookie, redirects to the profile step.
4. Profile step (part of `dashboard.html` in a "required, first-run" mode when the logged-in user has no `destination_profiles` document yet) — form for the three destination stream keys, each independently enabled/disabled, each with an optional custom ingest URL. The ingest key is **not** typed in by the admin — the server generates it (crypto-random, on first write) and displays it. Submitting this form does two things in sequence: writes the profile (`DestinationCredentialsUpdated`), then activates it (`ActiveProfileChanged`) — since this is the very first profile ever created, activating it immediately is the obviously-correct default rather than a separate manual step. `NginxProcessManager` reacts to `ActiveProfileChanged` by calling `.start()` instead of `.reload()` specifically because it wasn't running yet.
5. `dashboard.html` from then on: the OBS ingest URL front and center, live status via SSE (below), a form to update the logged-in user's own destination keys (`DestinationCredentialsUpdated`, triggers `.reload()` only while that profile is active), an activate button (self-service for `user`; any-profile for `admin`), and — `admin` role only — a form to register additional accounts.

**View templates, not string concatenation.** `dashboard.html`'s dynamic tables (the users list, the connection-info endpoints) are `<template>` elements bound via a small dependency-free renderer (`/template.js`, ~50 lines): `data-field` for text, `data-when`/`data-unless` for conditional presence, `data-bind` for setting an attribute from a data key. A fetch handler's job stops at producing a plain data array; the row markup and what a boolean flag looks like on screen live in the `<template>`, not inside the handler as a `.map(...).join("")` string. Not a UI framework — no virtual DOM, no reactivity, nothing watches for changes — sized to match "no framework where unnecessary" while still keeping view and handler genuinely separate.

**Live status: Server-Sent Events, not polling.** `GET /events` (authenticated, cookie-based) is one more thing `HttpApi` owns: a `Set` of open SSE connections, and **exactly one** EventBus subscription (registered once, at construction — same discipline as everywhere else in this doc) to `StreamStarted`/`StreamEnded`/`StreamIdle`/`StreamResumed`/`StreamStatUpdated`. On any of those, it formats one SSE message and writes it to every connection currently in the set — one listener fanning out to N browser tabs, not N listeners. A connection is added to the set on `GET /events` and removed on `close`/`error`. This is the same "derive from an existing event stream instead of adding a new poll" pattern `StreamIdleDetector` already uses, just applied at the browser edge instead of inside the process.

Relay image is its own multi-stage build, same shape as the nginx stage already uses — build with the full toolchain, copy only the artifact into a minimal final image:

1. `nginx-build` — compile nginx with `nginx-rtmp-module` from source (unchanged from before).
2. `sidecar-build` (`oven/bun:1-alpine` or similar) — `bun install --frozen-lockfile`, `bunx tsc --noEmit`, then `bun build ./src/index.ts --compile --outfile sidecar` to produce the standalone executable.
3. Final runtime stage — copies the compiled nginx tree *and* the compiled `sidecar` binary. **No Bun runtime, no `node_modules`, no package manager in the final image at all** — the binary is self-contained. This is the concrete payoff of the Bun switch: the final image only needs whatever thin OS-level libraries the binary itself links against (glibc vs. musl — see Open Questions), not a JS runtime.

`docker-compose.yml` adds a second service for MongoDB itself (standard official image, not something we build). Bootstrap configuration (Mongo URI, JWT secret, HTTP port) still comes in via environment variables; destination/ingest stream keys no longer do — see Persistence & auth.

### Testing strategy

No source code exists yet, so this is a plan to build test coverage against, not a description of tests that exist. Each layer maps directly to a guarantee this design actually depends on — not generic boilerplate coverage. One exception, already real: `scripts/check-spec-sync.ts` (§CI/CD pipeline) needs no application code, only the two documents, and actually runs today — verified by deliberately breaking it once and watching it catch the break, not just written and assumed to work.

**Unit tests (Bun's built-in test runner, `bun test` — no extra dependency, consistent with the rest of this doc's "no framework where unnecessary" theme):**

- `StreamState`, `NginxProcessManager`, `MongoService` — feed each a fake EventBus/fake driver events, assert the getters reflect it. The "no public setter" guarantee is a TypeScript `private` compile-time check, not a runtime test — worth noting so nobody goes looking for a test that can't exist.
- `StreamOrchestrator` — the single most important behavioral guarantee in the whole design: inject fake submodule factories (spies), assert `.start(streamKey)` is called on `StreamStarted`, and — critically — assert `.dispose()` is called on **both** `StreamEnded` *and* `nginx.crashed`, and that calling `.dispose()` twice (both events firing in a race) doesn't throw or double-fire cleanup. This is what "no leaked timer" actually rests on; it deserves direct coverage, not incidental coverage via something else.
- `StreamIdleDetector` — feed a sequence of synthetic `StreamStatUpdated` ticks with flat `bytesIn`, assert `StreamIdle` fires exactly once (not per tick) at the threshold; feed growth afterward, assert `StreamResumed` fires once.
- `AuthService` — bootstrap registration path forces `admin` regardless of requested role; post-bootstrap registration without a valid admin JWT is rejected; a `user`-role JWT hitting an admin-only route gets `403` not `401`; a tampered/expired JWT is rejected.
- `NginxConfigRenderer`'s `envsubst` step — regression test, not a nice-to-have: assert that rendering never touches nginx's own `$name` variable in the template, only the four explicit placeholder names. This was a real bug class caught by hand while designing the entrypoint script; it's exactly the kind of thing that silently breaks again after a refactor if nothing asserts it.
- `IngestEventReceiver` — the internal nginx-notify routes reject anything not from loopback.
- **Error handling, specifically:** an `EventBus` listener throwing doesn't stop sibling listeners for the same event from running, and doesn't crash the process (this is the direct test for the centralized-wrapping claim above). Redaction: an error thrown with a stream key or password anywhere in its context never appears in the logged output — assert against the actual serialized log line, not just that `redact` is configured. The HTTP error wrapper: an unexpected (non-`AppError`) exception in a route handler produces a generic 500 with no stack trace or internal detail in the response body, while the full detail *does* reach the logger.

**Integration tests (docker compose: relay + Mongo + a local test RTMP receiver standing in for Mixcloud/YouTube/Twitch):**

- Real destination credentials never touch CI — no live Mixcloud/YouTube/Twitch secrets checked into pipeline config, ever. Instead, `MIXCLOUD_STREAM_KEY`/`YOUTUBE_STREAM_KEY`/`TWITCH_STREAM_KEY` point at a throwaway local RTMP listener in the compose stack for CI only, so the actual push/copy/fan-out logic is verified without needing live accounts.
- Push a short synthetic stream at the ingest URL with `ffmpeg` (a generated test pattern, not a real recording), then assert: `/health` transitions `offline → live`; `/stats`' `bytesIn` increases; the local test receiver actually received the relayed stream (proves the `push` fan-out itself, not just our own event bookkeeping); stopping the `ffmpeg` process brings `/health` back to `offline` within a bounded window.
- `DestinationProfileRepository` write on the active profile → `NginxConfigRenderer` reload: change a destination key via the authenticated API mid-test, confirm nginx picks it up — this is also where the open question about `nginx -s reload` and an already-active publish gets answered empirically instead of guessed at.
- `RelayStateRepository.setActive()` switching to a *different* user mid-stream: confirm the previously-active user's ingest key stops being accepted and the new user's starts working — this is where the "activation cuts off whoever was live" behavior from the RTMP relay section gets verified as intended, not assumed.
- Ownership: a `user`-role JWT attempting to read/write a `userId` that isn't its own gets rejected; `admin` can activate any profile but cannot edit another user's keys (not built for v1, so this should assert `404`/`403`, not silently succeed).
- Bootstrap race: fire two concurrent unauthenticated `POST /auth/register` calls at an empty `users` collection, assert exactly one succeeds — once the unique-index fix from the open questions is in, this is what proves it actually works.

### Security suite

Modeled directly on Stagebox's own three-pronged setup (`docs/CI_CD.md §2.3` there), not invented from scratch — same shape, rules grounded in *this* project's actual invariants rather than copied generically.

**1. Secret scan (gitleaks, full history, blocking).** Already covered above: it's the last line of defense, not the plan — the structural defense (secrets in Mongo, `.env` gitignored, no real third-party keys in CI) is what actually matters. Runs both as a local pre-commit hook (so a secret never leaves the machine) and as the first CI job on every PR/push.

**2. SAST (Semgrep, custom rules for this project's own invariants).** `.semgrep/security.yml` exists and is real — validated with `docker run semgrep/semgrep` (no network access to PyPI in this environment, Docker was the working path), both that it parses (an early draft didn't — an unquoted pattern containing a colon broke the YAML, fixed) and that it actually fires: a throwaway file with every violation type deliberately introduced was caught by all four rules before this was trusted. Generic OWASP scanning is noise for a codebase this small and specific; the value is in encoding the exact mistakes this design has already identified as dangerous. Same severity split as Stagebox's (`ERROR` blocks the PR, `WARNING` is advisory-only):

| id | severity | catches |
|---|---|---|
| `updated-by-from-body` | ERROR | `body.updatedBy` anywhere — note: `body`, not Express's `req.body`, since `HttpApi` reads request bodies via `const body = await readJson<T>(req)`, not an Express-style req object. The rule matches this codebase's actual shape, not a generic one. |
| `registered-by-from-body` | ERROR | `body.registeredBy` anywhere — same rule, for registration |
| `activated-by-from-body` | ERROR | `body.activatedBy` anywhere — same rule, for activation |
| `role-from-body-unchecked` | WARNING, not ERROR | `body.role` outside `AuthService`'s own registration handler — advisory rather than blocking because the actual correctness guarantee (bootstrap forces `admin`, post-bootstrap requires an admin JWT) is proven by `AuthService`'s unit tests, not by this pattern match; this just flags a new call site worth a second look |
| `secret-like-field-in-event-payload` | WARNING | an `eventBus.emit(...)` call whose payload includes a field named `streamKey`/`password`/`passwordHash`/`token` — enforces "events say what changed, never the value" from the Event taxonomy above |

**Not implemented — a documented gap, not a fake rule:** `user-id-from-params-unchecked` (a route handler reading a `userId` from params/body and passing it to a repository call without a preceding ownership check in the same function — the exact shape of "user edits someone else's profile"). Expressing this precisely needs real taint-tracking (Semgrep OSS supports this via `pattern-sources`/`pattern-sinks`, not attempted here yet) — a naive pattern would either never fire or false-positive constantly, which is worse than not having the rule at all.

**3. OpenAPI security lint (Spectral).** `openapi.yaml` (repo root) now exists — **second source of truth**, generated from this doc's own Data objects section, validated clean against Spectral's default `oas` ruleset (zero errors, zero warnings, checked directly rather than assumed). Fails the build if any operation omits a `security` block — catches the coarse mistake ("someone added a route and forgot auth entirely"). What it **can't** express cleanly, documented in `openapi.yaml`'s own `info.description` so it isn't only written down here: either of this project's two conditional-auth cases — `/auth/register`'s bootstrap exception, and `/profile`'s ownership check (role `user` is only sometimes enough; it also has to be *this* user). OpenAPI's `security` block is static per-operation, not conditional on database state or request params. Spectral only ever proves "this route declares *some* auth requirement," not "the conditional logic is correct" — that half stays on unit tests (`AuthService`'s bootstrap-race test, and the ownership tests added above), the same belt-and-suspenders split as the `role-from-body-unchecked` and `user-id-from-params-unchecked` rules. A project-specific `security`-block-required rule now exists (`.spectral.yaml`, extends `spectral:oas`) — validated two ways, not just written and assumed: ran clean against the real `openapi.yaml` (zero errors), and confirmed it actually fires by deliberately stripping a `security` block from a test copy and watching it get caught. Wired into `.github/workflows/security.yml`, which itself was validated with `actionlint` before being trusted.

### CI/CD pipeline

```
feature/<name> ──PR──▶ staging ──PR──▶ main
```

Two tiers, not Stagebox's three (`feature → deployable → staging → main`) — there's only one deployable here, so the middle tier doesn't exist. `staging` is still the integration branch and is expected to stay green; `main` receives only deliberate merges from it, same spirit as Stagebox even though the branch count differs.

> Note: an earlier version of this doc argued explicitly *against* a staging tier ("no intermediate staging tier, since there's only one thing here to integrate") — reversed. A single deployable was never really the reason to skip it; `staging` earns its place as the place PRs land and CI runs before anything reaches `main`, independent of how many deployables there are.

**On every PR (into `staging`):**

**Real, in `.github/workflows/`, both validated before being trusted (`actionlint` for schema, then watched actually run on GitHub) rather than just written and hoped:**

1. **Security suite** (`security.yml`) — gitleaks, Semgrep (`.semgrep/security.yml`), Spectral (`openapi.yaml` against `.spectral.yaml`). Runs first, before anything else touches the code.
2. **Spec sync** (`ci.yml`) — `bun scripts/check-spec-sync.ts`. Zero dependencies: diffs `openapi.yaml`'s paths against this doc's own HTTP payload table, with an explicit allowlist for the known, intentional asymmetries (static HTML pages aren't in `openapi.yaml`; the internal nginx-notify routes aren't in this table). Verified by deliberately breaking it once before trusting it.
3. **Lint** — Biome (`bunx @biomejs/biome check src/ scripts/ tests/`).
4. **Typecheck** — `bunx tsc --noEmit`.
5. **Unit tests** — `bun test tests/unit/` — no external services, matches Stagebox's `tests/unit/`/`tests/integration/` split exactly.
6. **Integration tests** — `bun test tests/integration/`, against a real Mongo *service container* in the CI job (not a manually-started local one) — the actual heartbeat-event connection tracking, the fixed-`_id` upsert behavior, the per-destination event emission, all proven in CI the same way they were proven locally.
7. **Compile** — `bun build ./src/index.ts --compile --outfile dist/sidecar`.

**Both workflows trigger on PRs and on push to `staging`/`main`/`feature/**`** — "the same checks run again on staging → main" is real, not just documented, since both workflow files list all three branches as triggers. No separate Main CI shape, unlike Stagebox's, since there's no docs-only fast path worth speeding up here.

**Still not real, deliberately, not by oversight:**

8. **Docker build** — no job for this yet. There's no `Dockerfile` until the nginx-facing modules exist; a CI job that always fails because its input doesn't exist would be a permanent red X with no signal, worse than not having the job.
9. **The docker-compose + synthetic-ffmpeg-stream integration suite** (relaying an actual test stream and asserting the push fan-out) — same reason, waits on the same missing pieces.
10. **Spec coverage** (fails if any `openapi.yaml` path has no route handler, or vice versa) — `check-spec-sync.ts` only checks the two *documents* against each other; this would be the piece that catches code drifting from the spec, and there's real code to drift against now, but it isn't built yet.
11. **Contract tests** — asserting actual HTTP responses match `openapi.yaml`'s schemas (e.g. via `openapi-response-validator`), not just that the design intends them to.

**On `staging → main`, once there's something to deploy:**

12. Build and push the image to a registry (GHCR: `ghcr.io/hschreier/yall-rtmp-docker-stream`), tagged with the commit SHA and `:latest`. Waits on the Dockerfile existing at all.
13. Actual deployment stays manual for v1 — there's one instance, redeployed by hand when needed. Not automating a deploy target that doesn't exist yet.

## Explicitly not doing

- **Transcoding / adaptive bitrate** — one rendition, unchanged, to all three destinations.
- **Custom reconnect logic** — nginx-rtmp's `push_reconnect` already does this at the protocol layer, closer to the data than anything in the sidecar could be.
- **Open/public self-signup** — `POST /auth/register` exists (see Persistence & auth), but it's never open to just anyone: exactly one unauthenticated call succeeds (the empty-collection bootstrap, forced to `admin`), every call after that requires an existing admin's JWT. There is no flow where an arbitrary visitor gets an account.
- **Server-side sessions** — JWTs are stateless by design specifically to avoid needing a sessions collection and its cleanup/expiry logic.
- **A global poller of nginx state.** No `/stat` XML polling loop, no internal stat HTTP server bound to `127.0.0.1:8090`. Liveness comes from nginx's own `on_publish`/`on_publish_done` webhooks and `child_process` exit events — both push-based. Per-broadcast stats (`bytes_in`, bitrate) are *not* dropped — see `StreamStatsSession` above — they're just not served by an always-on poller; the counter exists only while a stream exists.
- **BullMQ/Redis, for now** — see Memory discipline above. No identified need yet that an event-scoped in-process object doesn't already cover.
- **A separate CSRF token scheme** — `SameSite=Strict` on the auth cookie already means a cross-site request can't carry it, which is what CSRF protection is for; the UI is single-origin by construction (same process serves pages and API), so there's no legitimate cross-site request this needs to distinguish from an attack.
- **A client-side SPA framework** — four server-rendered pages don't need React/Vue and a build pipeline; see Frontend & first install.
- **Ingest-key rotation UI** — the key is generated once, on first destination setup, and displayed. Changing it later (e.g. if it leaked) isn't built in v1 — flagged in Open Questions, not silently out of scope forever.
- **Concurrent multi-user streaming.** Considered directly (see the original three-way credential-scope question this doc was built from) and rejected in favor of per-user *profiles* with a single active one — nginx stays one static `ingest` application with one coherent config at a time, which is what makes the failure-isolation and reconnect properties in the RTMP relay section hold. Genuinely simultaneous streams from different users would mean multiple ingest applications, dynamically templated per user — a much bigger change, not attempted here.
- **Admin editing another user's stream keys.** Admin can activate any profile (hand the broadcast to someone else) but can't edit their destination keys directly — only the owning `user` can. Flagged in Open Questions in case that turns out to be needed in practice (e.g. helping someone fix a typo'd key).

> Note: an earlier version of this doc ruled out *any* control API for managing destinations as premature, on the assumption the destination set (and its keys) would be fully static. That assumption changed — keys need to be updatable without a redeploy, and by more than one accountable person — which is the whole reason Mongo and auth are here now.
>
> A later version of this doc had the sidecar polling nginx's `/stat` endpoint every 2s to detect ingest liveness, and then simply dropped byte/bitrate counters entirely once that poller was removed. Both were wrong: liveness detection moved to nginx's own `on_publish`/`on_publish_done` webhooks (push, not poll — genuinely more accurate, not just more "pure"), and the counters came back as `StreamStatsSession`, a per-broadcast object with its own bounded timer, created on `StreamStarted` and disposed on `StreamEnded`/`nginx.crashed`. The fix wasn't "delete the feature to satisfy the no-polling rule," it was "scope the timer to the event that justifies it."

## Data objects

Every typed shape referenced above, in one place. EventBus payloads and Mongo documents are settled by the design above; the HTTP request/response and in-memory snapshot shapes below are drafts synthesized for completeness — they were only named as routes/services earlier, never given a field list, so treat them as a starting proposal, not a decision.

### EventBus payloads — User events

| Event | Shape |
|---|---|
| `UserLoggedIn` | `{ userId, at }` |
| `UserLoggedOut` | `{ userId, at }` |
| `UserRegistered` | `{ userId, email, role: 'user' \| 'admin', registeredBy, at }` — `registeredBy` is `null` for the one bootstrap account |
| `DestinationCredentialsUpdated` | `{ userId, destination: 'mixcloud' \| 'youtube' \| 'twitch', at }` — never the credential value itself; `userId` is whose profile changed, not necessarily the active one |
| `ActiveProfileChanged` | `{ userId, activatedBy, at }` — `userId` is the profile that's now active; `activatedBy` is who triggered it (self for `user` role, possibly someone else for `admin`). The UI's "your broadcast was ended" handoff notice (see design brief) is derived client-side from this one event — the browser already knows if it was the previously-active profile, so no separate "you got cut off" event type exists or is needed. |

### EventBus payloads — Client events

| Event | Shape |
|---|---|
| `IngestClientConnected` | `{ address, at }` |
| `IngestClientDisconnected` | `{ address, at }` |

### EventBus payloads — Stream events

| Event | Shape |
|---|---|
| `StreamStarted` | `{ streamKey, at, dataType, chunkSize }` — `dataType`/`chunkSize` sourcing unverified, see Open Questions |
| `StreamEnded` | `{ streamKey, at, durationMs, totalBytesIn }` |
| `StreamIdle` | `{ streamKey, since, at }` |
| `StreamResumed` | `{ streamKey, at }` |

### EventBus payloads — Stat events

| Event | Shape |
|---|---|
| `StreamStatUpdated` | `{ streamKey, bytesIn, bitrateKbps, at }` |

### EventBus payloads — Log events

| Event | Shape |
|---|---|
| `LogEvent` | `{ source, payload, at }` — wraps any event from the domains above |

### EventBus payloads — process/infra (not a domain of their own, but on the same bus)

| Event | Shape |
|---|---|
| `nginx.started` | `{ at }` |
| `nginx.exited` | `{ code, at }` |
| `nginx.crashed` | `{ error, at }` |

### Mongo documents

| Collection | Document shape |
|---|---|
| `destination_profiles` | `{ userId, ingestStreamKey, mixcloud: { enabled, streamKey, customIngestUrl? }, youtube: { enabled, streamKey, customIngestUrl? }, twitch: { enabled, streamKey, customIngestUrl? }, updatedAt, updatedBy }` — one per user, unique on `userId` |
| `relay_state` | `{ activeUserId, activatedAt, activatedBy }` — single document |
| `users` | `{ email, passwordHash, role: 'user' \| 'admin', createdAt, registeredBy }` |

### HTTP payloads — draft, not yet decided

| Route | Request | Response |
|---|---|---|
| `POST /auth/login` | `{ email, password }` | `{ token }` (JWT, carries `role`) — **plus** sets the `HttpOnly`/`Secure`/`SameSite=Strict` session cookie carrying the same token |
| `POST /auth/register` | `{ email, password, role? }` — `role` ignored and forced to `admin` on the one bootstrap call; required and honored on every subsequent (admin-only) call | `{ userId, email, role }` |
| `GET /profile` (own profile, `user` or `admin`) | — | `{ ingestStreamKey, mixcloud, youtube, twitch, updatedAt, updatedBy }` — same shape as the `destination_profiles` document, scoped to the caller's own `userId` (never in the URL or body); includes `ingestStreamKey` since the UI needs to display the OBS ingest URL — it was never meant to be secret *from its owner*, only from the public |
| `PUT /profile` (own profile) | `{ mixcloud?, youtube?, twitch? }` (partial update per destination; `ingestStreamKey` is server-generated on first write, not client-settable) | the updated document, same shape as GET |
| `POST /profile/activate` (own profile, `user` or `admin`) | — | `{ activeUserId, activatedAt }` |
| `GET /users` (`admin` only) | — | `{ users: [{ userId, email, role, hasProfile, isActive }] }` — `passwordHash` deliberately excluded, same discipline as the `_id`-leak fix on `DestinationProfileRepository.get()`. Replaces the earlier "paste a userId to activate" workaround with a real table in the dashboard. |
| `POST /users/:userId/activate` (`admin` only) | — | `{ activeUserId, activatedAt }` — same response shape, different `userId` source (path param, admin-only) |
| `GET /health` (public) | — | `{ ingestStatus: 'offline' \| 'live' \| 'idle', nginxReachable: boolean, mongoReachable: boolean, at }` |
| `GET /stats` (public) | — | `{ ingestStatus, bytesIn, bitrateKbps, since, at }` — fields only exist while `ingestStatus !== 'offline'`; shape when offline not decided (omit the fields entirely vs. null them out) |
| `GET /events` (`user` or `admin`, cookie) | — | SSE stream of `StreamState` changes plus `nginx.crashed`/Mongo-connectivity changes — one formatted event per `StreamStarted`/`StreamEnded`/`StreamIdle`/`StreamResumed`/`StreamStatUpdated`/`nginx.crashed`/Mongo disconnect, so the dashboard can show a banner instead of only surfacing problems on the next failed request |
| `GET /`, `/setup.html`, `/login.html`, `/dashboard.html` | — | static HTML, routed server-side per the Frontend & first install logic above (which page depends on `UserRepository.isEmpty()` and auth state, not the URL alone) |

### Typed errors

| Class | HTTP status | Example |
|---|---|---|
| `AppError` | — (base class, not thrown directly) | carries `code` + `status`, everything below extends it |
| `ValidationError` | 400 | malformed request body |
| `AuthError` | 401 | missing/invalid/expired JWT (cookie or Bearer) |
| `ForbiddenError` | 403 | valid session, wrong role, or wrong `userId` (ownership check failed) |
| `NotFoundError` | 404 | e.g. activating a `userId` that doesn't exist |
| `ConflictError` | 409 | the bootstrap-registration race — duplicate-key on the one-admin unique index |
| `UpstreamError` | 503 | Mongo or nginx unreachable when a write/render was attempted |

Anything thrown that ISN'T one of these becomes a generic 500 with no detail in the response body — see Error handling, logging & try/catch discipline above.

### In-memory state — `StreamState` (domain singleton)

The one authoritative object for current stream state, mutated only by its own internal EventBus subscriptions:

| Getter | Type | Source event |
|---|---|---|
| `getStatus()` | `'offline' \| 'live' \| 'idle'` | `StreamStarted` → `live`, `StreamIdle` → `idle`, `StreamResumed` → `live`, `StreamEnded` → `offline` |
| `getStreamKey()` | `string \| null` | `StreamStarted` / `StreamEnded` |
| `getBytesIn()` | `number` | `StreamStatUpdated` |
| `getBitrateKbps()` | `number` | `StreamStatUpdated` |
| `getStartedAt()` | `Date \| null` | `StreamStarted` / `StreamEnded` |
| `getLastEventAt()` | `Date` | any of the above |

`HttpApi`'s `/stats` reads these directly. `HealthService` reads `getStatus()` plus two more domain singletons of its own to build `/health` — the same pattern applied where else it fit:

| Singleton | Getters | Driven by |
|---|---|---|
| `NginxProcessManager` | `isRunning()`, `getPid()`, `getLastExitCode()`, `getLastCrashError()` | its own `child_process` event handlers |
| `MongoService` | `isConnected()`, `getLastConnectedAt()`, `getLastError()` | the native driver's own connection topology events |

Three singletons, three owners, one write path each (its own events), no cross-writing — `HealthService` only ever reads.

## Open questions to settle before implementation

- Whether per-destination push status (e.g. "is the Twitch push specifically connected") is obtainable from nginx-rtmp at all without polling `/stat` — if it turns out to require polling, that's a deliberate, scoped exception to raise explicitly, not something to add quietly.
- nginx build specifics (version pins, exact configure flags) — to be nailed down when we write the Dockerfile, not guessed at in this doc.
- **[Elevated priority]** Whether `nginx -s reload` actually picks up changed `push` targets for the *currently active* publish session, or only affects publishes that start after the reload — this determines whether a config change while a stream is already live takes effect immediately or only on the next broadcast. Needs to be tested, not assumed. Was sitting as a routine open question; re-weighted after checking Castr's actual feature set (Sept 2026) — they treat "toggle a destination on/off while the stream is running" as baseline, table-stakes functionality, not an edge case. If our answer turns out to be "only takes effect on the next broadcast," that's a real gap against the obvious competitive bar, not just a nice-to-have to verify eventually. Test this as soon as `NginxProcessManager` exists, don't let it linger.
- **Whether `on_publish_done` fires reliably (and quickly) on an abrupt disconnect** — a clean RTMP unpublish should trigger it immediately, but a hard network drop from OBS may depend on nginx noticing the TCP connection died, which could lag behind an instantaneous event in the worst case. This is the one place the "push, not poll" claim needs real-world verification before it's treated as fully proven.
- Whether the two internal nginx-notify routes need any additional verification beyond binding to loopback (e.g. a shared secret nginx sends itself) — loopback-only should be sufficient inside a single container with no other process sharing the network namespace, but worth a second look once the container actually exists. Their exact paths in `openapi.yaml` (`/internal/nginx/on-publish`, `/internal/nginx/on-publish-done`) are provisional too — picked while writing the spec, not fixed by any earlier decision in this doc.
- JWT access token lifetime, and whether a refresh flow is needed for v1 or a short-lived token that just requires re-login is acceptable for an internal tool.
- ~~`bcrypt` vs `bcryptjs`~~ — resolved: neither, `Bun.password` (see Persistence & auth). Superseded by the Bun switch, not by picking one of the two original options.
- **Whether the native `mongodb` driver's optional compression addons (snappy, zstd) cause any trouble under `bun build --compile`.** They're meant to be optional/gracefully-skipped if absent, but that's a claim about Node, not verified against Bun's compile step specifically — needs a real build, not an assumption.
- **glibc vs. musl for the final runtime image.** Bun's compiled output has historically been more mature on glibc; Alpine (used everywhere else in this design so far, including the nginx stage) is musl-based. Either the sidecar's base image needs to be glibc-based (a heavier final image, working against the whole point of compiling to a small binary) or musl compatibility needs confirming against Bun's current release — not assumed either way.
- **Cross-compilation.** `bun build --compile` targets the platform it runs on by default; CI (likely `ubuntu-latest`, x64 glibc) and a developer's own machine (macOS/ARM, this session's own environment included) aren't the same target as the final Alpine/musl container. Bun does support cross-compile targets via `--target`, but which exact target string and whether it actually produces a working Alpine-compatible binary hasn't been tried.
- **Where `StreamStarted`'s `dataType` and `chunkSize` actually come from.** `chunkSize` may already be known before the stream starts — it's set by *us* in nginx.conf (`chunk_size`), not discovered — but RTMP negotiates chunk size per direction, so the value OBS actually sends could differ from what we configure for our own outbound chunks; needs checking which one the event should report. `dataType` (video/audio codec) isn't available at publish time at all as far as documented `on_publish` behavior goes — codec is only knowable once actual media data starts flowing, not from the publish handshake callback. Both need verification against real nginx-rtmp behavior before the event shape is final, not just asserted here.
- Whether "client events" (raw RTMP connect/disconnect) is the right read of what was meant, versus something else — flagged inline above, needs confirmation.
- **Idle threshold.** How many consecutive no-growth `StreamStatUpdated` ticks (and at what tick interval) should count as `StreamIdle` — too sensitive and a brief encoder hiccup falsely flags idle; too lax and a real stall takes too long to surface. This is a product/tuning decision, not something to hardcode a guessed number for here. The UI design brief now assumes roughly a 1s stat-update cadence on the dashboard — worth treating as an informing constraint on `StreamStatsSession`'s actual interval, not a coincidence to ignore, but still not a decision made here.
- **Bootstrap-registration race.** Two near-simultaneous unauthenticated `POST /auth/register` calls against an empty `users` collection could both pass an `isEmpty()` check before either write lands, producing two unauthenticated admin accounts instead of one. Low real-world likelihood for a single-operator tool deployed once, but the fix (a unique index that only one insert can satisfy, or a Mongo transaction) is cheap enough that it shouldn't just be assumed away.
- **User management beyond creation.** Registration covers creating accounts; nothing here covers listing, disabling, or changing another user's role after the fact. Worth deciding whether that's in scope for v1 or genuinely later.
- ~~Whether to write an `openapi.yaml`~~ — resolved: yes, it exists at the repo root, second source of truth to this doc. The project-specific Spectral rule (security-block-required, matching Stagebox's own pattern) is the remaining piece — not written yet.
- **Ingest-key rotation.** Explicitly out of scope for v1 (see Explicitly not doing), but a real operational need eventually — if the ingest key leaks, there's currently no UI path to generate a new one without going around the API by hand.
- **What `/health` should report while nginx is deliberately not running yet** (fresh install, no destination config set). `nginxReachable: false` is technically true but reads like a failure when it's actually the expected pre-setup state — worth a distinct status value (or at least a clear `reason` field) rather than making "not configured yet" look identical to "something's broken."
- **`SameSite=Strict` vs `Lax`.** `Strict` is the stronger default and matches "single-origin, no cross-site need," but it also means a link *into* the dashboard from another site (e.g. a bookmark opened via a redirect chain) drops the cookie on first navigation. Unlikely to matter for how this tool is actually used, but worth a conscious choice rather than an assumed one.
- **Should activating a different profile be blocked while someone is actually live?** Right now `ActiveProfileChanged` always cuts off whoever was streaming — that may be exactly the intended behavior (handing off the broadcast), or it may need a confirmation step / a hard block while `StreamState.getStatus() !== 'offline'` to prevent an accidental mid-stream cutoff. Not decided; currently designed as "always allowed, always disruptive."
- **Whether admin editing another user's destination keys should exist.** Currently out of scope (see Explicitly not doing) — admin can hand the broadcast to someone else but not fix their typo'd key for them. Worth revisiting if that turns out to matter in practice.
- **Whether `customIngestUrl` gets a UI control in v1**, or stays a schema field only settable by editing Mongo directly for now. The schema supports it (closing the Twitch-region gap found while designing this), but nothing above committed to actually building that part of the form.
- **Whether a failed Mongo write should retry.** Right now `UpstreamError` just surfaces as a 503 — no automatic retry anywhere. Reasonable for a single-operator tool where the human just tries again, but worth a conscious "no" rather than an assumed one, especially for the write that matters most: activating a profile.
- **Exact crash-loop threshold** ("3 crashes within 60s" for nginx, "3 consecutive failures" for `StreamStatsSession`'s timer) — reasonable-sounding numbers picked while writing this, not derived from anything. Fine to ship as a starting point, but they're guesses, not measurements.
