# Handover — Ya'll Cast RTMP relay build (2026-10-01)

Scope for the next session: **continue the RTMP relay build order**, steps 5–8. Steps 1–4 are done, tested, pushed. This file is self-contained — `docs/TECHNICAL.md` has the full design, but you don't need to read all of it before starting; the pointers below tell you exactly which sections matter for what's left.

Branch: `feature/rtmp-relay-dockerfile`, pushed, [PR #5](https://github.com/HSchreier/yall-rtmp-docker-stream/pull/5) open against `main`, mergeable, not yet reviewed/merged. Confirm with `git log --oneline -5` before starting — should show `2380fb3` (NginxProcessManager) as the tip, or later if something landed since.

---

## What this project is

Containerized RTMP relay: one OBS ingest → nginx-rtmp-module fans it out live to Mixcloud Live, YouTube, and Twitch. A Bun/TypeScript sidecar in the same container manages auth, per-user destination profiles, renders nginx's config, and supervises the nginx child process. `docs/TECHNICAL.md` is the single source of truth for design; `openapi.yaml` for the HTTP contract. Both stay in sync — `scripts/check-spec-sync.ts` (`bun run check:spec-sync`) enforces it and is part of every verification pass.

## State: build order steps 1–4 done

`docs/TECHNICAL.md`, §RTMP relay → "Build order" has the authoritative, up-to-date list (✅ marks what's done, with the actual design decisions and any bugs found written inline — read that section, not this summary, for details):

1. ✅ `Dockerfile` — three-stage build (nginx+rtmp-module compile, Bun sidecar compile, minimal runtime). Build-time self-test (`nginx -t` against the real template) catches broken config/module issues during `docker build` itself.
2. ✅ `NginxConfigRenderer` (`src/modules/relay/nginx-config-renderer.ts`) — pure function, renders `docker/nginx.conf.template`'s seven placeholders from a `DestinationProfileDoc`.
3. ✅ `IngestEventReceiver` + `RelayRouter` (`src/modules/relay/`) — handles nginx-rtmp's `on_publish`/`on_publish_done` callbacks, loopback-only (`Bun.serve`'s `server.requestIP()`, threaded through `HttpApi`/`ModuleRouter`).
4. ✅ `NginxProcessManager` (`src/modules/relay/nginx-process-manager.ts`) — spawns/supervises/crash-loops the real nginx child process.

**Two real bugs were found and fixed in step 4, only by actually running the built Docker image end-to-end** (register a user via the real HTTP API → set a destination key → activate the profile → confirm nginx actually comes up), not by `bun test` or `docker build`'s own self-test alone:
- `docker/nginx.conf.template`'s `error_log /dev/stderr` crash-looped nginx every time it was spawned with piped stdio (ENXIO reopening a pipe via `/proc/self/fd/2`) — fixed by pointing `error_log` at a real file.
- The Dockerfile's `sidecar-build` stage never `COPY`'d `docker/` into its build context — invisible until step 4 made `nginx-config-renderer.ts` (which imports the template) actually reachable from `bootstrap.ts`.

Full write-up of both, including exactly how they were diagnosed, is in `docs/TECHNICAL.md`'s step 4 entry and in commit `2380fb3`'s message. **Lesson for the rest of this build order: `bun test` and a successful `docker build` are necessary but not sufficient — steps 5 onward should keep getting a real end-to-end container run (not just unit tests) before being marked done**, the same way step 4 did.

## What's left (steps 5–8, `docs/TECHNICAL.md` §RTMP relay → "Build order")

5. **`src/modules/relay/stream-state.ts`** — the domain singleton for "what is happening with the stream right now" (`getStatus()`, `getStreamKey()`, `getBytesIn()`, `getBitrateKbps()`, `getStartedAt()`, `getLastEventAt()`; private setters, driven only by its own `EventBus` subscriptions to `StreamStarted`/`StreamEnded`/`StreamIdle`/`StreamResumed`/`StreamStatUpdated`). Same getter/private-setter shape as `MongoService`/`NginxProcessManager` — read those two for the pattern before writing this. Fully unit-testable with a fake `EventBus`, same as `tests/unit/event-bus.test.ts`.
6. **`src/modules/relay/stream-orchestrator.ts`** + `stream-stats-session.ts` + `stream-idle-detector.ts` — `StreamOrchestrator` owns the broadcast lifecycle via **injected submodule factories** (not hardcoded submodule construction — see `docs/TECHNICAL.md` §Sidecar software design, "Modules", the `StreamOrchestrator`/`StreamStatsSession`/`StreamIdleDetector` entries, for the exact contract: `start(streamKey)`/`dispose()`, and the "`dispose()` on both `StreamEnded` and `nginx.crashed`, not double-firing" guarantee that needs direct test coverage). `StreamStatsSession` is the one submodule with an actual timer (`setInterval`, cleared in `dispose()`) — its callback needs its own local try/catch per the Error handling section's rule 2 (same category as `NginxProcessManager`'s child_process listeners — an emitter/timer we didn't write isn't covered by `EventBus`'s own isolation).
7. **Wire into `bootstrap.ts`** — mostly incremental at this point (`NginxProcessManager`, `IngestEventReceiver`/`RelayRouter` already wired); add `StreamState` and `StreamOrchestrator` construction + `init()` in the order `docs/TECHNICAL.md` §Sidecar software design, "Construction is not the same as starting" specifies (`StreamState.init()`/`StreamOrchestrator.init()`/`AuditLogger.init()` are step 4 in that numbered list — `AuditLogger` doesn't exist yet either, flagged as a gap in `bootstrap.ts`'s own header comment, not silently skipped).
8. **Real end-to-end**: add a `relay` service to `docker-compose.yml` (doesn't exist yet — current file only has `mongo`), push a synthetic `ffmpeg` test stream at a running container. **This is where the still-open question gets answered empirically**: does `nginx -s reload`/`SIGHUP` (what `NginxProcessManager.reload()` sends on a config change) actually cleanly repoint an already-live `push` target without interrupting the broadcast, or does it drop the connection? Nothing before this step can answer that — `NginxProcessManager`'s own tests only prove the signal gets sent, not what nginx does with an active stream when it arrives.

## Resume steps

1. `cd /Users/helle/Workspace/dev1/yall-rtmp-docker-stream && git log --oneline -5` — confirm branch state matches above.
2. `docker compose up -d` — starts Mongo on host port **27117** (not the default 27017 — `.env`'s `MONGO_URI` already points at it correctly). `docker compose ps` to confirm it's up before running integration tests.
3. `bun install` if `node_modules` is stale, then the full verification sweep to confirm you're starting from green: `bun run lint`, `bunx tsc --noEmit`, `bun test` (unit + integration together, needs Mongo up), `bun run check:spec-sync`, `bun run build`.
4. Read `docs/TECHNICAL.md` §RTMP relay (the whole section — not long) before touching step 5; the per-user buffer profile and event taxonomy subsections are both directly relevant to `StreamState`/`StreamOrchestrator`.
5. Build step 5 (`StreamState`) first — step 6 depends on nothing from step 5 being *wired*, but both share the same `EventBus` event taxonomy, so reading `StreamState`'s subscriptions first makes `StreamOrchestrator`'s submodule-factory design easier to follow.
6. **Before marking any step done, verify it end-to-end in a real running container**, not just `bun test` — see the "two real bugs" note above for why this matters specifically for this project (nginx-involving code has failure modes invisible to unit tests and even to `docker build`'s own self-test).
7. Keep `docs/TECHNICAL.md`'s build-order checklist and `openapi.yaml` in sync as you go; `bun run check:spec-sync` is a fast, cheap check — run it often, not just at the end.
8. Commit to `feature/rtmp-relay-dockerfile` (same branch, same PR #5) following the existing commit pattern — see `git log` on this branch for the style (one commit per build-order step, detailed body explaining design decisions and any bugs found, not just what changed).

**Why this file exists:** this session completed steps 3–4 of an 8-step build order that spans multiple sessions; the next session needs enough context to continue cold without re-deriving the whole design from `docs/TECHNICAL.md` (which is thorough but long) or re-discovering the "verify in a real container, not just tests" lesson step 4 already paid for.
