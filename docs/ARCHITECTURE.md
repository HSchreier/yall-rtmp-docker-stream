# Architecture decision log

Short-form record of the decisions made and when. Full reasoning lives in [TECHNICAL.md](TECHNICAL.md); interface contracts in [../openapi.yaml](../openapi.yaml); UI in [design-briefs/screens-and-journeys.md](design-briefs/screens-and-journeys.md).

This file was stale for a while — it still had the pre-reset open questions (ffmpeg vs. nginx-rtmp, static config vs. REST API) long after TECHNICAL.md had resolved and gone past them. Rewritten to match reality.

| Date | Decision |
|---|---|
| 2026-09-29 | Relay engine: nginx-rtmp-module, not ffmpeg `tee` — avoids head-of-line blocking across three simultaneous destination pushes. |
| 2026-09-29 | No transcode — pure stream copy to all destinations. |
| 2026-09-29 | Control/health sidecar: originally Node.js, switched to **Bun** mid-design specifically for `bun build --compile` — a standalone binary in the final image, no separate runtime + `node_modules` layer. |
| 2026-09-29 | Fully event-driven — zero unscoped timers. The one exception (`StreamStatsSession`) is bounded to a single active broadcast's lifetime, not global. |
| 2026-09-29 | MongoDB + real user accounts (not a single shared token) for destination config, once static env-var config turned out not to fit the actual need. |
| 2026-09-29 | Per-user destination profiles, one active at a time — not a single shared config, not concurrent multi-user streaming. |
| 2026-09-29 | Registration: bootstrap-then-admin-gated, no public signup ever. |
| 2026-09-29 | `openapi.yaml` added as second source of truth, enforced against TECHNICAL.md by `scripts/check-spec-sync.ts`. |
| 2026-09-29 | Git flow: reversed an earlier "no staging tier" call — added `staging` between feature branches and `main` after all. See TECHNICAL.md §CI/CD pipeline. |

## Verified vs. not yet verified

- ✅ Mixcloud Live RTMP ingest is active (`rtmp://rtmp.mixcloud.com/broadcast`), confirmed Sept 2026.
- ✅ nginx-rtmp's `push_reconnect` exists and does what's needed, per the module's own issue tracker.
- ✅ EventBus listener isolation (one throwing doesn't stop siblings or crash the process) — proven by test, not just designed.
- ✅ MongoService's connection-state tracking — proven against a live container on both the connect and disconnect paths.
- ✅ `bun build --compile` produces a working binary that boots and connects to Mongo — proven, not assumed.
- ⬜ Compiled-binary cross-compilation for the target Alpine/musl container — the binary built so far is macOS x86_64; untested against the actual deployment target.
- ⬜ Whether the `mongodb` driver's optional native compression addons cause trouble under `bun build --compile`.
- ⬜ `nginx -s reload` picking up new push targets for an already-active publish, and whether `on_publish_done` fires reliably on an abrupt disconnect — both need a real nginx-rtmp instance, not written yet.
- ⬜ Actual latency measurement vs. the reference project that originally motivated this — not measured, only reasoned about.
