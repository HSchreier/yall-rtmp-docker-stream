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

**Buffering & backpressure.** "A stalled or dead destination affects only its own connection" above is a real property, but it doesn't happen by magic — it's three specific nginx-rtmp-module directives, previously left unconfigured (silently inheriting whatever's compiled in). Verified against the module's own source, not assumed:

- **`out_queue`** (per push connection, default 256 messages) — how many outbound RTMP messages nginx queues for a destination before deciding it's too slow and dropping that one connection. At a rough 60 msgs/sec (30fps video, ~2 msgs/frame), the default is **~4 seconds of tolerance**. This is the actual mechanism behind "failure isolation" — a destination that exceeds its own queue gets dropped and reconnected (`push_reconnect`, below), the other two are never touched.
- **`out_cork`** (default `out_queue/8`) — batches flushes once this many messages are queued, trading a little latency for fewer syscalls under load. Scales with `out_queue`.
- **`relay_buffer`** (the outbound push TCP connection's own buffer, default 5000ms) — separate, time-based, specific to the relay connection itself rather than the message queue.
- **`wait_key`** (default **on**) — when a destination (re)connects, nginx-rtmp silently withholds non-keyframe video until the next keyframe, so it's never fed undecodable mid-GOP data. Real consequence, previously undocumented: after a destination hiccups, it can go dark for up to `push_reconnect`'s 3s wait **plus** time-to-next-keyframe (commonly ~2s at typical OBS settings) — **up to ~5 seconds of that one destination showing nothing**, while ingest and the other two destinations are unaffected. Worth knowing before it looks like a mystery bug the first time someone's Twitch feed freezes for a few seconds after a network blip. Keeping `wait_key on` — the alternative risks feeding a reconnected destination broken mid-frame data, strictly worse.

**Per-user buffer profile.** Since only one profile is ever active at a time (one `ingest` application, fully re-rendered per activation — see above), the three connection-side directives above can be parameterized *per active profile* without needing multiple simultaneous application blocks: `NginxConfigRenderer` just reads the active profile's `bufferProfile` field alongside its destination keys. Two static presets, not a live-adjusted value — a reactive buffer (grow/shrink based on observed jitter) was considered, matching the buffer-occupancy-driven pattern from adaptive-bitrate HTTP streaming literature (e.g. buffer-based rate adaptation using reservoir/cushion thresholds instead of throughput estimation), but doesn't actually fit here: that pattern needs a live control loop reacting to measured stream health, which needs `StreamStatsSession`/`StreamOrchestrator` (neither built yet) plus confirmation that `nginx -s reload` cleanly repoints an already-live push — the same `[Elevated priority]` open question already unresolved below. Flagged as a real future direction, not faked now with static presets pretending to be adaptive.

| Preset | `out_queue` | `out_cork` | `relay_buffer` | Tolerance | When |
|---|---|---|---|---|---|
| `mobile` (**default**) | 1024 | 128 | 10000ms | ~17s | Streamer's upload is a mobile/4G or otherwise variable connection — jitter and short bursts shouldn't drop a destination just because the reservoir emptied for a moment. Costs a little more end-to-end latency. |
| `stable` | 256 | 32 | 5000ms | ~4s | nginx-rtmp-module's own compiled-in defaults — wired/stable connection, lower latency preferred over extra jitter tolerance. |

Defaulting to `mobile` is a deliberate choice, not nginx's own default: a streamer who hasn't thought about their connection quality is more likely to be hurt by a destination getting dropped over a brief stall than by the extra ~13s of added tolerance (and modest latency cost) the wider preset costs them. `stable` is there to opt into once someone knows their connection doesn't need the cushion.

**Known nginx-rtmp-module compile risk — checked before writing the Dockerfile, not discovered by a failed build.** `nginx-rtmp-module` (last real release Dec 2024, `arut/nginx-rtmp-module` tag `v1.2.2`) has open GitHub issues (#1517, #1569, #1579) describing a build failure against recent nginx/GCC: an `implicit-fallthrough` warning in `ngx_rtmp_eval.c` gets promoted to a hard error, since nginx's own build system sets `-Werror` by default with modern compilers. Naively pinning current nginx stable (1.30.5) breaks the build. Fix: `./configure --with-cc-opt="-Wno-error=implicit-fallthrough"` — scoped to that one warning, not a blanket `-Werror` disable. **Verified, not just argued for**: `docker build` actually succeeds with this flag (confirmed before writing any of the below as settled).

**GCC compilation — what actually happens, and why it's a completely separate toolchain from Bun.** nginx and `nginx-rtmp-module` are C, not JavaScript/TypeScript — `bun build --compile` only bundles a Bun/JS/TS application plus the Bun runtime into one executable; it has no capability to compile C source at all, and isn't being asked to here. The `Dockerfile`'s first stage (`nginx-build`, `FROM debian:bookworm-slim`) is a real, separate GCC-based C toolchain build, unrelated to the second stage's Bun compile:

- **`build-essential`** — Debian's standard meta-package: GCC, G++, `make`, `libc6-dev`, `dpkg-dev`. This is the actual compiler; nothing Bun-related is present in this stage at all.
- **`libpcre3-dev`** — PCRE headers/static libs, needed because nginx core uses PCRE for regex (location/rewrite matching) even though this build doesn't define any `location` blocks using regex — it's a core nginx build dependency, not something enabled by an explicit flag.
- **`zlib1g-dev`** — gzip support, same situation: a core nginx build dependency, linked whether or not this config happens to use gzip.
- **`libssl-dev`** — included as a standard nginx build dependency. Worth flagging honestly rather than asserting a confident reason: `--with-http_ssl_module` was **not** passed to `./configure`, yet the built binary's own `nginx -V` output reports `built with OpenSSL 3.0.22` anyway — nginx's core apparently links OpenSSL for something even without the SSL module explicitly enabled (possibly a core crypto/digest utility, not confirmed against nginx's own `configure` script source). Observed, not fully explained; removing `libssl-dev` to see if the build still succeeds wasn't tried, so it stays.
- **`curl`**, **`git`**, **`ca-certificates`** — fetching nginx's source tarball and cloning the rtmp module's pinned tag over HTTPS.

**The actual compile**, after both sources are fetched into `/build`:
```
./configure \
  --prefix=/usr/local/nginx \
  --with-cc-opt="-Wno-error=implicit-fallthrough" \
  --add-module=/build/nginx-rtmp-module
make -j"$(nproc)"
make install
```
`--add-module` compiles `nginx-rtmp-module` **statically into the nginx binary itself** — not a dynamically-loaded `.so` (nginx does support `--add-dynamic-module`, deliberately not used here: one binary with the module baked in is simpler to verify and ship than a binary plus a separate module file that has to be loaded correctly at runtime). `make install` puts the result at `/usr/local/nginx/sbin/nginx`, which only the final runtime stage's `COPY --from=nginx-build` ever touches again — the entire `build-essential`/`-dev` toolchain stays behind in the discarded build stage, never reaching the shipped image (confirmed: the final image's installed packages are only the *runtime* `-dev`-less equivalents — `libpcre3`, `zlib1g`, `libssl3` — plus `curl`/`gettext-base` for the healthcheck and `NginxConfigRenderer`'s future `envsubst` call).

**Known minor inefficiency, not fixed**: the Dockerfile currently runs two separate `apt-get update && apt-get install` layers in the `nginx-build` stage — the compiler toolchain first, then `gettext-base` later for the build-time self-test. Combining them into one `RUN` would save a layer and a package-index refetch; left as two because the self-test was added after the initial compile step was already written and working, and splitting it out made the diff between "compile nginx" and "verify the config template" clearer while this was being built and debugged. Worth squashing before this image is actually optimized for size, not before.

**Build order — dependency-first, each step independently testable before the next depends on it:**

1. ✅ **`Dockerfile`** (repo root) — multi-stage: compile nginx + `nginx-rtmp-module` (pinned versions, the fix above), compile the Bun binary (`bun build --compile`, already proven to need the build-time asset-embedding approach — see Frontend & first install), minimal final runtime image. Verified by `docker build` succeeding, then a bare smoke test: `nginx -V` lists the rtmp module, the container binds `:1935`. Also includes a build-time self-test (renders the real template with dummy values, runs `nginx -t` against it) that caught a real directive-placement bug before it ever reached a running container — see RTMP relay above.
2. ✅ **`src/modules/relay/nginx-config-renderer.ts`** — a pure function (not a class — zero dependencies, zero state, see the file's own header comment for why that's a deliberate deviation from this codebase's usual singleton-class shape), string templating against `docker/nginx.conf.template`'s seven placeholders. Takes the template as an explicit parameter rather than hardcoding the real import inside the function, specifically so tests can exercise the "never touches nginx's own `$variable` syntax" guarantee against a synthetic template, not just assert a property of the real one that doesn't currently exercise the risk. Substitution is in-process (`String.replaceAll` against an explicit whitelist), not a shelled-out call to the real `envsubst` binary — `envsubst` isn't guaranteed present on every contributor's machine, and a few lines of TypeScript give the identical safety guarantee (same "zero dependencies" precedent as `scripts/check-spec-sync.ts`). No Docker needed to unit-test this; verified both as a normal `bun test` run and that the embedded template survives `bun build --compile` specifically (the exact risk category that broke the dashboard's static assets earlier — checked again here rather than assumed fixed everywhere now).
3. ✅ **`src/modules/relay/ingest-event-receiver.ts`** + `relay.router.ts` — the `on_publish`/`on_publish_done` handlers (`/internal/nginx/on-publish*`, already stubbed in `openapi.yaml`, loopback-only). Scope note: only `on_publish`/`on_publish_done` are wired — `docker/nginx.conf.template`'s `application ingest {}` block has no `on_connect`/`on_disconnect` directives yet, so `IngestClientConnected`/`IngestClientDisconnected` (Client events, above) have no producer yet either. Deliberately not expanded here; flagged as a gap, not silently folded into this step.
   - **Loopback check.** `HttpApi`'s main listener binds `0.0.0.0` (the dashboard needs LAN/internet reach), so the internal routes needed their own guard rather than relying on "nginx only ever posts to 127.0.0.1" alone. `Bun.serve`'s `fetch(req, server)` second parameter was threaded through `HttpApi#handle`/`#route` (previously only `fetch: (req) => ...`) specifically so `server.requestIP(req)?.address` could be resolved once per request and passed down; `ModuleRouter.handle()` grew a third `clientIp: string | null` parameter as a result — every existing router still satisfies the interface with its original two-arg signature (TypeScript's bivariant method-parameter checking), so nothing else needed touching. `RelayRouter` throws `ForbiddenError` (403, via `HttpApi`'s existing central error wrapper) for anything not `127.0.0.1`/`::1`, `clientIp === null` included — treated as untrusted, not waved through.
   - **Authorization.** `RelayStateRepository` is a singleton pointer (at most one active profile, ever), so "does the posted `name` form field match the active profile's `ingestStreamKey`" is the entire check — no per-request scan across all profiles for a matching key, just `getActiveUserId()` then one `DestinationProfileRepository.get()`.
   - **`StreamEnded.durationMs`/`totalBytesIn` — honest, not guessed.** `durationMs` is computed from a single in-memory start timestamp set by `handlePublish()` (not a map keyed by stream key — same "only one profile is ever active" reasoning as the authorization check). `totalBytesIn` is hardcoded `0`: nginx-rtmp's `on_publish_done` callback carries no byte-count field, and the module that would actually track it (`StreamStatsSession`, build order step 6) doesn't exist yet. Flagged in the code and here rather than fabricating a plausible-looking number — same discipline as the Dockerfile docs' `libssl-dev` note above.
   - Fully unit-testable without real nginx — it's HTTP plus a `DestinationProfileRepository`/`RelayStateRepository` lookup, same shape as every other router in this codebase; covered in `tests/unit/ingest-event-receiver.test.ts` and `tests/unit/relay-router.test.ts`. Also verified against the actual compiled binary (`bun build --compile`) and the full three-stage `docker build`, both green — this is also the first build where `NginxConfigRenderer` and this module are reachable from `bootstrap.ts`/`src/index.ts`, so the compiled-binary asset-embedding check is now a real consequence of a normal build, not a separate probe script.
4. ✅ **`src/modules/relay/nginx-process-manager.ts`** — spawn/supervise/crash-loop, the domain-singleton getter/private-setter shape already used by `MongoService`. Spawns nginx with `-g "daemon off;"` (the spawned process IS the master, giving a real signalable pid); a config change while already running sends `SIGHUP` for nginx's own graceful reload rather than killing/respawning. Crash-loop protection: the 3rd crash within a rolling 60s window gives up (calls an injected exit function, defaulting to `process.exit(1)`) instead of attempting a 4th restart. Constructor takes a deps object (`spawnFn`/`exitFn` both overridable, defaulting to the real `node:child_process.spawn`/`process.exit`) — same call as `HttpApi`'s own constructor, for the same reason (too many fields for positional args to read well) and specifically so unit tests can drive the crash-loop logic, including the give-up branch, with a fake child process and a fake exit function that just records the call instead of actually killing the test runner. 9 unit tests in `tests/unit/nginx-process-manager.test.ts` cover exactly that — core state-tracking logic, fully testable without a real nginx, per this step's own original scoping.
   - **A real crash bug, caught only by actually running the compiled image, not by `bun test` or `docker build`'s own self-test.** `docker/nginx.conf.template` originally had `error_log /dev/stderr warn;`. `NginxProcessManager` spawns nginx with `stdio: ["ignore", "pipe", "pipe"]` — a Node-created pipe, not an inherited fd — and nginx opening `/dev/stderr` resolves through `/proc/self/fd/2` to that pipe, which fails at `open()` with `ENXIO` ("No such device or address"), a known Linux quirk for reopening a pipe by its `/proc/self/fd` path. The Dockerfile's own build-time `nginx -t` self-test (step 1) never caught this: BuildKit's `RUN` steps give `-t` a real inherited stderr, not a pipe, so the failure mode only exists once something actually spawns nginx with piped stdio at runtime — which nothing did until this step. Caught by running the actual built image end-to-end (fresh container, real Mongo, registered a user through the real HTTP API, set a destination key, activated the profile, confirmed nginx crash-looped three times and the sidecar exited) — not by reasoning about it. Fixed by pointing `error_log` at a real file (`/usr/local/nginx/logs/error.log`, the directory nginx's own build already creates and owns) instead of `/dev/stderr`; early fatal startup errors — like this one — still reach the sidecar's logs regardless, since nginx writes those to its own process stderr before it's even parsed the `error_log` directive, which the piped `child.stderr` handler always captures. Re-verified after the fix with the same end-to-end flow: `/stat` (nginx-rtmp's own loopback-only status page) reports `nginx_rtmp_version 1.1.4` and the `ingest` application live, the rendered config has the correct `push` line and buffer-preset values, no crash.
   - **Also caught in the same end-to-end pass, unrelated to the crash above**: `nginx-config-renderer.ts` imports `docker/nginx.conf.template` as a build-time text asset, but the Dockerfile's `sidecar-build` stage never `COPY`'d the `docker/` directory into that stage — invisible as long as nothing reachable from `bootstrap.ts`/`src/index.ts` actually imported `nginx-config-renderer.ts` (true through step 3), and this is the first step where something does. Fixed with one more `COPY docker ./docker` in that stage, ahead of the `tsc`/`bun build` steps that need it.
   - Wired into `bootstrap.ts` as its own step, right after `relayState` is constructed — ahead of the service objects and routers, matching this file's own documented init order (nothing else needs it, but nothing it needs is missing yet either).
5. **`src/modules/relay/stream-state.ts`** — EventBus-driven, same shape as `MongoService`/`NginxProcessManager`. Fully unit-testable with a fake EventBus, same pattern as the existing `event-bus.test.ts`.
6. **`src/modules/relay/stream-orchestrator.ts`** + `stream-stats-session.ts` + `stream-idle-detector.ts` — unit-testable with fake injected submodule factories; the `.dispose()`-called-on-both-`StreamEnded`-and-`nginx.crashed` guarantee (and double-dispose not double-firing) gets direct coverage here, not incidental coverage via something else.
7. Wire all of the above into `bootstrap.ts`, in this same dependency order.
8. **Real end-to-end**: add the `relay` service to `docker-compose.yml`, push a synthetic `ffmpeg` test stream at a running container. This is where the still-open `[Elevated priority]` question — does `nginx -s reload` actually repoint an already-live publish's `push` targets? — finally gets answered empirically, which is also the gate on whether the reactive-buffer idea above is even worth revisiting later.

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
- `HttpApi` — built on `Bun.serve`, Bun's built-in HTTP server, exposing `/health`, `/stats` (public), the internal nginx-notify routes (loopback only), `/auth/login`, `/auth/register` (open only for bootstrap, admin-gated after), `/profile` GET/PUT (own profile — `user` or `admin`), `/profile/activate` POST (own profile → active — `user` or `admin`), `/users` GET / `/users/:userId` PATCH/DELETE / `/users/:userId/activate` POST (admin-only, except PATCH's self-service case — see Persistence & auth), `/events` (SSE, authenticated), and the static UI pages (`/`, `setup.html`, `login.html`, `dashboard.html`, `settings.html`, `app.js`/`template.js`/`app.css`, served from memory — see Frontend & first install). `/stats` reads `StreamState`'s getters directly; `/health` reads `HealthService`. Accepts auth via cookie or `Authorization: Bearer`. Owns the `Set` of open SSE connections and the single EventBus subscription that fans out to all of them — the only per-connection state it holds; everything else stays stateless across requests.
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

- `destination_profiles` — one document per user: `{ userId (unique), ingestStreamKey, mixcloud: { enabled, streamKey, customIngestUrl? }, youtube: { enabled, streamKey, customIngestUrl? }, twitch: { enabled, streamKey, customIngestUrl? }, bufferProfile: 'mobile' | 'stable', updatedAt, updatedBy }`. `customIngestUrl` is the fix for a real gap found while designing this: the default ingest URLs (`rtmp.mixcloud.com`, `a.rtmp.youtube.com`, `live.twitch.tv`) are hardcoded per platform, but Twitch specifically has multiple regional ingest servers and picking the closest one is a genuine, documented latency win — directly relevant given this whole project's stated goal. Rather than maintain a curated region list that can go stale, each destination just accepts an optional raw override URL, falling back to the documented default when unset. `enabled` is the other gap this closes: a destination with no key, or explicitly disabled, gets no `push` line at all instead of one pointed at nothing. `bufferProfile` defaults to `mobile` on first write — see RTMP relay §Per-user buffer profile — and is consumed by `NginxConfigRenderer` alongside the destination keys, not stored anywhere nginx-specific.
- `relay_state` — a single document: `{ activeUserId, activatedAt, activatedBy }`. The pointer `NginxConfigRenderer` actually reads.
- `users` — `email`, `passwordHash` (bcrypt), `role: 'user' | 'admin'`, `createdAt`, `registeredBy` (another user's id, or `null` for the one bootstrap account).

**Roles:**

- `user` — can read and write **their own** destination profile, activate **their own** profile (make themselves the current broadcaster), and edit their **own** account's email/password (`PATCH /users/:userId` where `userId` is their own — the "My account" tab in `settings.html`). Can never touch `role`, even on their own account.
- `admin` — everything `user` can do for their own profile and account, plus `POST /auth/register` (create other accounts, as either role), editing *any* account's email/role/password (`PATCH /users/:userId`), removing accounts (`DELETE /users/:userId`), and activating *any* user's profile (`/users/:userId/activate`) — useful when one person operates the tablet/relay but different people are the ones actually streaming.

**Registration flow (bootstrap-then-admin-gated — no public signup at any point):**

- `POST /auth/register` when the `users` collection is empty: allowed unauthenticated, exactly once in practice. The `role` field in the request body is **ignored** in this case — the account is forced to `admin` regardless of what's sent, since this is specifically the "create the first admin" path, not a general signup endpoint that happens to be open right now.
- `POST /auth/register` once the collection is non-empty: requires a valid **admin** JWT. The calling admin sets the new account's `role` explicitly (`user` or `admin`). A non-admin `user` token gets `403`, not `401` — it's a valid session, just the wrong role.
- Emits `UserRegistered { userId, email, role, registeredBy, at }` on success (`registeredBy: null` for the bootstrap account).

**Auth flow:**

- `POST /auth/login` — email + password against `UserRepository`; on success, issues a JWT (short-lived access token, signed with a secret from `ConfigService`'s bootstrap env vars — this one secret has to stay in `.env`, it's what bootstraps trust in the first place). JWT payload carries `role` so `HttpApi` can authorize without a Mongo lookup per request.
- Protected routes require `Authorization: Bearer <jwt>`, verified by `AuthService`: `/profile` GET/PUT and `/profile/activate` need role `user` or `admin`, scoped to the caller's own `userId`; `/users/:userId/activate` and `/auth/register` need role `admin` (except the one-time bootstrap case above). No server-side session store — the JWT itself is the full auth state.
- Passwords hashed with **`Bun.password`** (built into the Bun runtime — no `bcrypt`/`bcryptjs` npm dependency at all) before ever touching Mongo; plaintext never persisted or logged. This resolves what used to be an open question (native `bcrypt` vs. pure-JS `bcryptjs`) in the direction the compile-to-binary decision above already forces: a native-addon dependency like `bcrypt` doesn't bundle into a `bun build --compile` output the way pure JS does, and `Bun.password` sidesteps the question entirely by not being an external dependency in the first place. Minimum length: 12 characters — a `ValidationError`, checked before hashing, not after (per `docs/design-briefs/screens-and-journeys.md`).
- **Destination stream keys encrypted at rest** (`mixcloud`/`youtube`/`twitch`'s `streamKey`, AES-256-GCM — `src/infra/crypto.ts`), not stored as plaintext in `destination_profiles`. A dedicated `ENCRYPTION_KEY` bootstrap env var (64 hex chars / 32 bytes), separate from `JWT_SECRET` — signing and at-rest encryption are different cryptographic purposes, and one key covering both means a rotation need for either forces rotating both. `DestinationProfileRepository` is the only place that encrypts/decrypts; every caller above it (services, routers, the dashboard) works with plaintext. Key rotation itself is **not** handled — changing `ENCRYPTION_KEY` makes every previously-encrypted value undecryptable; that's a real open question, not solved here. `ingestStreamKey` (this app's own generated key, not a third-party credential) is deliberately left unencrypted, since a future nginx-notify webhook needs to look a user up *by* that value and GCM's random per-call IV rules out an equality query against ciphertext without decrypting every document first.

**Security invariants:**

- `updatedBy` on a profile write, `registeredBy` on a registration, and `activatedBy` on an activation, always come from the verified JWT's user id — never from the request body.
- **Ownership check on `/profile`:** a `user`-role request can only ever read/write/activate the profile matching its own JWT's `userId` — never a `userId` from the request body or params. `admin` is the only role that can act on a `userId` that isn't its own, and only for activation, not editing keys.
- The bootstrap unauthenticated path only ever forces role `admin`; it never trusts a client-supplied role. Once one user document exists, that path is closed — every subsequent registration requires an admin JWT, full stop.
- `/health` and `/stats` stay public/unauthenticated (they're already scrubbed of secrets); every other route that reads or changes state requires auth.
- The RTMP ingest path is untouched by any of this in terms of *mechanism* — OBS still authenticates purely via the stream-key-as-secret model — but *which* key is currently valid now depends on which profile is active. Auth here gates who can change a profile's keys, who can become the active broadcaster, and who can create accounts.
- **`PATCH`/`DELETE /users/:userId` (admin account management) can't leave zero admins.** `UsersService` counts admins before honoring a demotion (`role: "admin"` → `"user"`) or a deletion targeting an admin account, and rejects with `409` if the target is the *last* one — the same reasoning as the bootstrap-gate itself: an admin-less system has no way back in short of going around the API by hand. This is checked in the service, not the router, since it depends on data (`UserRepository.countByRole`) the router shouldn't need to know how to query.
- **`DELETE /users/:userId` can't delete the currently active broadcaster.** Checked against `relay_state.activeUserId` before the delete runs — removing the account nginx is (or will be, once it exists) actively configured to relay for out from under it is exactly the kind of state a "no unscoped side effects" design shouldn't allow silently. Rejected with `409`; the admin has to deactivate or activate someone else first.
- **`DELETE /users/:userId` cascades to `destination_profiles`.** A user's destination-profile document is deleted in the same operation — an orphaned profile document (holding a still-technically-valid `ingestStreamKey`) with no owning `users` document left is dangling data, not a record worth keeping. `relay_state` is never touched by a delete directly (the active-broadcaster check above means a delete can only ever proceed when `relay_state` doesn't point at the deleted user in the first place).
- **`PATCH /users/:userId` self-service can never touch `role`, even on the caller's own account.** `UsersService.updateUser()` allows a non-admin caller through only when `targetUserId === actingUser.userId` (same ownership pattern as `/profile`), but separately rejects *any* `role` field in the patch body unless the caller is already an admin — checked before the self/other distinction even matters. Letting a `user`-role account set `role: "admin"` on itself, gated only by "it's your own account," would be a privilege-escalation path disguised as a convenience feature.

### Frontend & first install

**What it is:** a handful of server-rendered HTML pages, served by `HttpApi` itself — no bundler, no framework, no separate build pipeline or container. This is a single-operator tool with four screens (`setup`, `login`, `dashboard`, `settings`); a full SPA would be a footprint mismatch with everything else in this design. Static files (`setup.html`, `login.html`, `dashboard.html`, `settings.html`, `app.js`/`template.js`/`app.css`, the Modernist stylesheet, plus the `mark-32.png`/`mark-180.png` favicon and apple-touch-icon from `assets/brand/` — see `docs/design-briefs/screens-and-journeys.md` §Visual identity) live in the same image, **imported as text at build time** (`with { type: "text" }`, not read from disk in `init()`) and served from memory — not just an optimization: `Bun.file(new URL(path, import.meta.url))` does not get embedded by `bun build --compile`, confirmed by actually running the compiled binary from a directory with no source tree present (`ENOENT ... /$bunfs/root/...`) before switching to build-time imports. A real bug that would have silently broken every Docker deployment, caught before the Dockerfile existed rather than inside it. See `src/http-api.ts` / `src/types/text-assets.d.ts`.

**`dashboard.html` vs. `settings.html` — operational view vs. configuration.** Originally one page did both; split once the admin user-management panel, the destination/buffer-profile form, and (new) self-service account editing made a single page too crowded to call a "dashboard." `dashboard.html` stays read-only/operational: broadcast status, active profile, the OBS ingest URL, a live read of `/profile` for the connection-info table. `settings.html` owns every mutation: three tabs (segmented control, same `.seg`/`.seg-opt` pattern as elsewhere) — **Streaming** (destination keys + buffer profile, both roles), **My account** (own email/password, both roles — see Persistence & auth, self-service below), **Users** (admin only — register/edit/remove/activate, hidden entirely for `user` role, not just visually de-emphasized).

**Auth for the browser: cookie, alongside the existing Bearer header.** `POST /auth/login` now sets an `HttpOnly; Secure; SameSite=Strict` cookie carrying the JWT, *in addition to* returning it in the JSON body — a full-page navigation can't attach an `Authorization` header, so cookie-based auth is what makes server-rendered pages work at all. `HttpApi`'s auth check accepts either the cookie or the Bearer header — the cookie for the UI, the header still available for scripts/curl. `HttpOnly` means page JS can't read the token even if something else on the page were compromised; `SameSite=Strict` is the CSRF mitigation — a cross-site request simply never carries the cookie, so there's no need for a separate CSRF token scheme on top of it, given this UI is single-origin by construction (the same process that serves the pages serves the API).

**Bootstrap wizard — reuses the same routes and events already designed, doesn't add new ones:**

1. `docker compose up`. The sidecar starts, connects to Mongo, starts `HttpApi` immediately — but **`NginxProcessManager` does not start nginx yet** if `RelayStateRepository` has no active profile. This is a real gap the original design didn't cover: `ConfigService`'s "fail fast if config is missing" logic was written when destination keys were env vars, always present by the time the container could even start. Now that they live in Mongo and are per-user, "nobody's active yet" is the normal state on a fresh install, not an error — nginx simply stays down until someone is, and the UI is the only thing up at that point.
2. `GET /` checks, in order: `UserRepository.isEmpty()` → serve `setup.html`. Not empty, no valid cookie/header → serve `login.html`. Authenticated → serve `dashboard.html`.
3. `setup.html` — email + password form, posts to `POST /auth/register` (the bootstrap case, forced `admin` role, already designed above). Sets the cookie (auto-login, since register alone doesn't), redirects to `dashboard.html`.
4. First-run: `dashboard.html` shows "no profile yet" and points at `settings.html` → **Streaming** tab — the three destination stream keys, each independently enabled/disabled, each with an optional custom ingest URL, plus the buffer profile. The ingest key is **not** typed in by the admin — the server generates it (crypto-random, on first write) and displays it on `dashboard.html` once a profile exists. Activation is a separate explicit action (the "Activate my profile" button on `dashboard.html`), not automatic on first save — matches the same button every subsequent activation uses, rather than a special-cased first-time auto-activate.
5. `dashboard.html` from then on: the OBS ingest URL front and center, live status via SSE (below), an activate button (self-service for `user`; any-profile for `admin` — that one lives in `settings.html` → Users, not here). Editing destination keys, the buffer profile, your own account, or (admin) other accounts all happen in `settings.html`.

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
- `NginxConfigRenderer`'s `envsubst` step — regression test, not a nice-to-have: assert that rendering never touches nginx's own `$name` variable in the template, only the seven explicit placeholder names (`HTTP_PORT`, `MIXCLOUD_PUSH_LINE`, `YOUTUBE_PUSH_LINE`, `TWITCH_PUSH_LINE`, `OUT_QUEUE`, `OUT_CORK`, `RELAY_BUFFER_MS` — see `docker/nginx.conf.template`). This was a real bug class caught by hand while designing the entrypoint script; it's exactly the kind of thing that silently breaks again after a refactor if nothing asserts it.
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

Three-pronged security suite: secret scanning, SAST, and API spec validation. Rules grounded in this project's actual invariants rather than generic best practices.

**1. Secret scan (gitleaks, full history, blocking).** Already covered above: it's the last line of defense, not the plan — the structural defense (secrets in Mongo, `.env` gitignored, no real third-party keys in CI) is what actually matters. Runs both as a local pre-commit hook (so a secret never leaves the machine) and as the first CI job on every PR/push.

**2. SAST (Semgrep, custom rules for this project's own invariants).** `.semgrep/security.yml` exists and is real — validated with `docker run semgrep/semgrep` (no network access to PyPI in this environment, Docker was the working path), both that it parses (an early draft didn't — an unquoted pattern containing a colon broke the YAML, fixed) and that it actually fires: a throwaway file with every violation type deliberately introduced was caught by all four rules before this was trusted. Generic OWASP scanning is noise for a codebase this small and specific; the value is in encoding the exact mistakes this design has already identified as dangerous. Two severity levels: `ERROR` blocks the PR, `WARNING` is advisory-only.

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

Two-tier branch flow: `feature` branches merge to `staging` (integration branch, always green), then `staging` merges to `main` (production). One deployable, so no separate deployable-branch tier.

> Note: an earlier version of this doc argued explicitly *against* a staging tier ("no intermediate staging tier, since there's only one thing here to integrate") — reversed. A single deployable was never really the reason to skip it; `staging` earns its place as the place PRs land and CI runs before anything reaches `main`, independent of how many deployables there are.

**On every PR (into `staging`):**

**Real, in `.github/workflows/`, both validated before being trusted (`actionlint` for schema, then watched actually run on GitHub) rather than just written and hoped:**

1. **Security suite** (`security.yml`) — gitleaks, Semgrep (`.semgrep/security.yml`), Spectral (`openapi.yaml` against `.spectral.yaml`). Runs first, before anything else touches the code.
2. **Spec sync** (`ci.yml`) — `bun scripts/check-spec-sync.ts`. Zero dependencies: diffs `openapi.yaml`'s paths against this doc's own HTTP payload table, with an explicit allowlist for the known, intentional asymmetries (static HTML pages aren't in `openapi.yaml`; the internal nginx-notify routes aren't in this table). Verified by deliberately breaking it once before trusting it.
3. **Lint** — Biome (`bunx @biomejs/biome check src/ scripts/ tests/`).
4. **Typecheck** — `bunx tsc --noEmit`.
5. **Unit tests** — `bun test tests/unit/` — no external services.
6. **Integration tests** — `bun test tests/integration/`, against a real Mongo *service container* in the CI job (not a manually-started local one) — the actual heartbeat-event connection tracking, the fixed-`_id` upsert behavior, the per-destination event emission, all proven in CI the same way they were proven locally.
7. **Compile** — `bun build ./src/index.ts --compile --outfile dist/sidecar`.

**Both workflows trigger on PRs and on push to `staging`/`main`/`feature/**`** — same checks run on every branch, no separate pipelines or doc-only fast paths.

**Still not real, deliberately, not by oversight:**

8. **Docker build** — planned as an unconditional job in `ci.yml` once the `Dockerfile` exists (RTMP relay §Build order, step 1): `docker build .`, fast, catches a broken build (e.g. the known `nginx-rtmp-module` compile risk above) immediately on every PR, same as every other required check.
9. **The docker-compose + synthetic-ffmpeg-stream integration suite** (relaying an actual test stream and asserting the push fan-out, RTMP relay §Build order step 8) — **not** added to the existing required checks. Deliberately a separate workflow, path-filtered to only run when `Dockerfile`/`src/modules/relay/**`/nginx config files change: it needs a full nginx compile plus `ffmpeg`, meaningfully slower than everything else in `ci.yml`, and gating an unrelated docs/frontend PR on it would be exactly the kind of cost/signal mismatch this project has avoided everywhere else (see `check-spec-sync.ts`'s own "zero dependencies" reasoning).
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
| `UserUpdated` | `{ userId, changedFields: Array<'email' \| 'role' \| 'password'>, updatedBy, at }` — admin edited another account. Never carries the new values themselves (same discipline as `DestinationCredentialsUpdated` not carrying the key) — a listener that needs them re-reads via `UserRepository`. |
| `UserRemoved` | `{ userId, removedBy, at }` — emitted after both the `users` and (if any) `destination_profiles` documents are gone. |

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
| `GET /profile` (own profile, `user` or `admin`) | — | `{ ingestStreamKey, mixcloud, youtube, twitch, bufferProfile, updatedAt, updatedBy }` — same shape as the `destination_profiles` document, scoped to the caller's own `userId` (never in the URL or body); includes `ingestStreamKey` since the UI needs to display the OBS ingest URL — it was never meant to be secret *from its owner*, only from the public |
| `PUT /profile` (own profile) | `{ mixcloud?, youtube?, twitch?, bufferProfile? }` (partial update per destination, plus the buffer preset; `ingestStreamKey` is server-generated on first write, not client-settable) | the updated document, same shape as GET |
| `POST /profile/activate` (own profile, `user` or `admin`) | — | `{ activeUserId, activatedAt }` |
| `GET /users` (`admin` only) | — | `{ users: [{ userId, email, role, hasProfile, isActive }] }` — `passwordHash` deliberately excluded, same discipline as the `_id`-leak fix on `DestinationProfileRepository.get()`. Replaces the earlier "paste a userId to activate" workaround with a real table in the dashboard. |
| `POST /users/:userId/activate` (`admin` only) | — | `{ activeUserId, activatedAt }` — same response shape, different `userId` source (path param, admin-only) |
| `PATCH /users/:userId` (self, or `admin` for anyone) | `{ email?, role?, password? }` — at least one field | the updated `{ userId, email, role, hasProfile, isActive }` (same shape as a `GET /users` row). Self-service path for "My account" — any authenticated user can edit their own `email`/`password` this way. Editing someone else, or including `role` at all (even on your own account), requires `admin` — `403` otherwise. Rejected with `409` if it would demote the last remaining admin to `user`, or if `email` collides with a different existing account. |
| `DELETE /users/:userId` (`admin` only) | — | `{ userId, deleted: true }`. Cascades: the account's `destination_profiles` document is deleted with it. Rejected with `409` if the target is the last remaining admin, or is the currently active broadcaster (`relay_state.activeUserId`) — deactivate, or activate someone else, first. |
| `GET /health` (public) | — | `{ ingestStatus: 'offline' \| 'live' \| 'idle', nginxReachable: boolean, mongoReachable: boolean, at }` |
| `GET /stats` (public) | — | `{ ingestStatus, bytesIn, bitrateKbps, since, at }` — fields only exist while `ingestStatus !== 'offline'`; shape when offline not decided (omit the fields entirely vs. null them out) |
| `GET /events` (`user` or `admin`, cookie) | — | SSE stream of `StreamState` changes plus `nginx.crashed`/Mongo-connectivity changes — one formatted event per `StreamStarted`/`StreamEnded`/`StreamIdle`/`StreamResumed`/`StreamStatUpdated`/`nginx.crashed`/Mongo disconnect, so the dashboard can show a banner instead of only surfacing problems on the next failed request |
| `GET /`, `/setup.html`, `/login.html`, `/dashboard.html`, `/settings.html` | — | static HTML. `/`, `/setup.html`, `/login.html` are routed server-side per the Frontend & first install logic above (which page depends on `UserRepository.isEmpty()` and auth state, not the URL alone); `/dashboard.html`/`/settings.html` are served unconditionally and gate themselves client-side via `Yallcast.requireAuth()` |

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
- **Reactive buffer profile.** The `mobile`/`stable` buffer presets (RTMP relay §Per-user buffer profile) are static, chosen once when the user picks them. A live, self-adjusting buffer — widening `out_queue`/`relay_buffer` when observed jitter is high, tightening it back down when the connection's been stable for a while, the same buffer-occupancy-driven spirit as reservoir/cushion rate adaptation in adaptive-bitrate HTTP streaming — was considered and deliberately not built: it needs a live control loop reading real stream health (`StreamStatsSession`/`StreamOrchestrator`, neither built yet) and depends on the `nginx -s reload` question directly above being answered "yes, repoints an already-live publish," since a reactive loop that can't actually change anything mid-stream isn't reactive. Revisit once both prerequisites exist, not before.
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
- ~~Whether to write an `openapi.yaml`~~ — resolved: yes, it exists at the repo root, second source of truth to this doc. Spectral linting is in place to enforce security requirements on the API spec.
- **Ingest-key rotation.** Explicitly out of scope for v1 (see Explicitly not doing), but a real operational need eventually — if the ingest key leaks, there's currently no UI path to generate a new one without going around the API by hand.
- **`ENCRYPTION_KEY` rotation.** Not handled — changing it makes every previously-encrypted destination stream key undecryptable (a `GET /profile` for an affected account would start throwing instead of returning stale data, which is at least loud rather than silently wrong, but still not a real answer). A real fix needs either a decrypt-with-old/re-encrypt-with-new migration path or versioned keys (an id alongside each ciphertext saying which key encrypted it); neither is built.
- **What `/health` should report while nginx is deliberately not running yet** (fresh install, no destination config set). `nginxReachable: false` is technically true but reads like a failure when it's actually the expected pre-setup state — worth a distinct status value (or at least a clear `reason` field) rather than making "not configured yet" look identical to "something's broken."
- **`SameSite=Strict` vs `Lax`.** `Strict` is the stronger default and matches "single-origin, no cross-site need," but it also means a link *into* the dashboard from another site (e.g. a bookmark opened via a redirect chain) drops the cookie on first navigation. Unlikely to matter for how this tool is actually used, but worth a conscious choice rather than an assumed one.
- **Should activating a different profile be blocked while someone is actually live?** Right now `ActiveProfileChanged` always cuts off whoever was streaming — that may be exactly the intended behavior (handing off the broadcast), or it may need a confirmation step / a hard block while `StreamState.getStatus() !== 'offline'` to prevent an accidental mid-stream cutoff. Not decided; currently designed as "always allowed, always disruptive."
- **Whether admin editing another user's destination keys should exist.** Currently out of scope (see Explicitly not doing) — admin can hand the broadcast to someone else but not fix their typo'd key for them. Worth revisiting if that turns out to matter in practice.
- **Whether `customIngestUrl` gets a UI control in v1**, or stays a schema field only settable by editing Mongo directly for now. The schema supports it (closing the Twitch-region gap found while designing this), but nothing above committed to actually building that part of the form.
- **Whether a failed Mongo write should retry.** Right now `UpstreamError` just surfaces as a 503 — no automatic retry anywhere. Reasonable for a single-operator tool where the human just tries again, but worth a conscious "no" rather than an assumed one, especially for the write that matters most: activating a profile.
- **Exact crash-loop threshold** ("3 crashes within 60s" for nginx, "3 consecutive failures" for `StreamStatsSession`'s timer) — reasonable-sounding numbers picked while writing this, not derived from anything. Fine to ship as a starting point, but they're guesses, not measurements.
