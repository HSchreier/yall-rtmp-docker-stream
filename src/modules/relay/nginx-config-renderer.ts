// NginxConfigRenderer — docs/TECHNICAL.md §RTMP relay, Build order step 2.
// A pure function, not a class/singleton like most other modules here —
// deliberate: zero constructor dependencies, zero internal state, one
// input shape to one output string. Wrapping that in a class with a
// constructor and one method would be the premature abstraction this
// project's own conventions explicitly avoid elsewhere.
//
// `docker/nginx.conf.template` is imported as text at *build* time (`with
// { type: "text" }`), not read from disk at render time — same lesson as
// http-api.ts's static assets: `Bun.file(new URL(...))` doesn't survive
// `bun build --compile`, confirmed earlier this session with a real
// ENOENT from the compiled binary. No reason to risk that bug twice.
//
// Substitution is done in-process here, NOT by shelling out to the real
// `envsubst` binary, even though earlier design notes in this doc said
// "envsubst step" and the Dockerfile's own build-time self-test does call
// the real binary. Deliberate deviation, not an oversight: `envsubst`
// isn't guaranteed present on every contributor's machine (it's a GNU
// gettext utility — not installed by default on macOS without Homebrew),
// and this project already has a "zero dependencies where a few lines of
// TypeScript suffice" precedent (scripts/check-spec-sync.ts's own stated
// reasoning). A plain `replaceAll` against an explicit whitelist of exact
// `${NAME}` tokens gives the identical safety guarantee the regression
// test below exists to prove — nginx's own single-dollar `$variable`
// syntax (e.g. `$remote_addr`) is never touched, because it's never
// matched by any of the seven exact patterns this function looks for. The
// Dockerfile's self-test, using the real `envsubst` binary, still proves
// the *template itself* is valid nginx syntax once filled — a separate,
// one-time build-time concern from how the sidecar fills it at runtime.

import nginxConfTemplate from "../../../docker/nginx.conf.template" with { type: "text" };
import type {
  BufferProfile,
  DestinationEntry,
  DestinationProfileDoc,
} from "../profiles/profiles.repository.ts";

const DEFAULT_DESTINATION_URLS: Record<"mixcloud" | "youtube" | "twitch", string> = {
  mixcloud: "rtmp://rtmp.mixcloud.com/broadcast",
  youtube: "rtmp://a.rtmp.youtube.com/live2",
  twitch: "rtmp://live.twitch.tv/app",
};

// docs/TECHNICAL.md §Per-user buffer profile — same two presets, same
// numbers, kept here as the single place that maps a profile name to the
// three nginx-rtmp-module directive values it actually becomes.
const BUFFER_PRESETS: Record<
  BufferProfile,
  { outQueue: number; outCork: number; relayBufferMs: number }
> = {
  mobile: { outQueue: 1024, outCork: 128, relayBufferMs: 10000 },
  stable: { outQueue: 256, outCork: 32, relayBufferMs: 5000 },
};

const PLACEHOLDER_NAMES = [
  "HTTP_PORT",
  "MIXCLOUD_PUSH_LINE",
  "YOUTUBE_PUSH_LINE",
  "TWITCH_PUSH_LINE",
  "OUT_QUEUE",
  "OUT_CORK",
  "RELAY_BUFFER_MS",
] as const;

function renderPushLine(
  destination: "mixcloud" | "youtube" | "twitch",
  entry: DestinationEntry | undefined,
): string {
  // No push line at all for a disabled/unconfigured destination — never
  // one pointed at an empty key. Same discipline as the dashboard's own
  // endpoint display (src/static/dashboard.html's renderEndpoints()).
  if (!entry?.enabled || !entry.streamKey) return "";
  const base = entry.customIngestUrl || DEFAULT_DESTINATION_URLS[destination];
  return `push ${base}/${entry.streamKey};`;
}

// Template is an explicit parameter, not hardcoded to the real
// nginx.conf.template import inside this function — on purpose, even
// though every real caller passes DEFAULT_TEMPLATE below. Letting tests
// pass a small synthetic template is what makes the "never touches
// nginx's own $variable syntax" regression test below actually mean
// something, rather than just asserting a property of today's 70-line
// production template that happens not to exercise the risk at all.
export function renderNginxConfig(
  template: string,
  profile: DestinationProfileDoc | null,
  httpPort: number,
): string {
  const preset = profile ? BUFFER_PRESETS[profile.bufferProfile] : BUFFER_PRESETS.mobile;

  const values: Record<(typeof PLACEHOLDER_NAMES)[number], string> = {
    HTTP_PORT: String(httpPort),
    MIXCLOUD_PUSH_LINE: profile ? renderPushLine("mixcloud", profile.mixcloud) : "",
    YOUTUBE_PUSH_LINE: profile ? renderPushLine("youtube", profile.youtube) : "",
    TWITCH_PUSH_LINE: profile ? renderPushLine("twitch", profile.twitch) : "",
    OUT_QUEUE: String(preset.outQueue),
    OUT_CORK: String(preset.outCork),
    RELAY_BUFFER_MS: String(preset.relayBufferMs),
  };

  let rendered = template;
  for (const name of PLACEHOLDER_NAMES) {
    rendered = rendered.replaceAll(`\${${name}}`, values[name]);
  }
  return rendered;
}

// The real template, embedded at build time — see the file header for why
// `with { type: "text" }` and not a runtime fs read. Callers (bootstrap.ts,
// eventually NginxProcessManager) use this constant; tests use their own.
export const DEFAULT_TEMPLATE: string = nginxConfTemplate;
