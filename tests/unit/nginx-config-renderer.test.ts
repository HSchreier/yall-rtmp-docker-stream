// NginxConfigRenderer (unit — pure function, no Docker/Mongo needed).
// Covers: all seven placeholders actually get substituted, a
// disabled/unconfigured destination renders no push line (not one
// pointed at nothing), both buffer presets map to the right directive
// values, and the regression test this module's own design doc promises:
// rendering never touches nginx's own single-dollar $variable syntax.

import { describe, expect, test } from "bun:test";
import type { DestinationProfileDoc } from "../../src/modules/profiles/profiles.repository.ts";
import {
  DEFAULT_TEMPLATE,
  renderNginxConfig,
} from "../../src/modules/relay/nginx-config-renderer.ts";

function makeProfile(overrides: Partial<DestinationProfileDoc> = {}): DestinationProfileDoc {
  return {
    userId: "u1",
    ingestStreamKey: "abc123",
    mixcloud: { enabled: false },
    youtube: { enabled: false },
    twitch: { enabled: false },
    bufferProfile: "mobile",
    updatedAt: new Date(),
    updatedBy: "u1",
    ...overrides,
  };
}

describe("renderNginxConfig", () => {
  test("no placeholder tokens remain in the rendered output", () => {
    const rendered = renderNginxConfig(DEFAULT_TEMPLATE, makeProfile(), 8080);
    expect(rendered).not.toMatch(/\$\{[A-Z_]+\}/);
  });

  test("HTTP_PORT is substituted into the on_publish callback URLs", () => {
    const rendered = renderNginxConfig(DEFAULT_TEMPLATE, makeProfile(), 9090);
    expect(rendered).toContain("http://127.0.0.1:9090/internal/nginx/on-publish");
    expect(rendered).toContain("http://127.0.0.1:9090/internal/nginx/on-publish-done");
  });

  test("a disabled destination renders no push line at all", () => {
    const rendered = renderNginxConfig(
      DEFAULT_TEMPLATE,
      makeProfile({ mixcloud: { enabled: false, streamKey: "leftover-key" } }),
      8080,
    );
    expect(rendered).not.toContain("leftover-key");
  });

  test("an enabled destination with no streamKey also renders no push line", () => {
    const rendered = renderNginxConfig(
      DEFAULT_TEMPLATE,
      makeProfile({ mixcloud: { enabled: true } }),
      8080,
    );
    expect(rendered).not.toMatch(/push rtmp:\/\/rtmp\.mixcloud\.com\/broadcast\/;/);
  });

  test("an enabled destination with a key renders its push line, default URL", () => {
    const rendered = renderNginxConfig(
      DEFAULT_TEMPLATE,
      makeProfile({ twitch: { enabled: true, streamKey: "my-twitch-key" } }),
      8080,
    );
    expect(rendered).toContain("push rtmp://live.twitch.tv/app/my-twitch-key;");
  });

  test("a custom ingest URL overrides the platform default", () => {
    const rendered = renderNginxConfig(
      DEFAULT_TEMPLATE,
      makeProfile({
        twitch: {
          enabled: true,
          streamKey: "my-key",
          customIngestUrl: "rtmp://region.contribute.live-video.net/app",
        },
      }),
      8080,
    );
    expect(rendered).toContain("push rtmp://region.contribute.live-video.net/app/my-key;");
    expect(rendered).not.toContain("live.twitch.tv");
  });

  test("'mobile' buffer profile renders the wider preset", () => {
    const rendered = renderNginxConfig(
      DEFAULT_TEMPLATE,
      makeProfile({ bufferProfile: "mobile" }),
      8080,
    );
    expect(rendered).toContain("out_queue 1024;");
    expect(rendered).toContain("out_cork 128;");
    expect(rendered).toContain("relay_buffer 10000;");
  });

  test("'stable' buffer profile renders nginx-rtmp-module's own tighter defaults", () => {
    const rendered = renderNginxConfig(
      DEFAULT_TEMPLATE,
      makeProfile({ bufferProfile: "stable" }),
      8080,
    );
    expect(rendered).toContain("out_queue 256;");
    expect(rendered).toContain("out_cork 32;");
    expect(rendered).toContain("relay_buffer 5000;");
  });

  test("regression: rendering never touches nginx's own single-dollar $variable syntax", () => {
    // A synthetic template exercising exactly the risk the real one
    // currently doesn't: a placeholder sitting right next to nginx's own
    // $variable syntax. Proves the substitution is scoped to the seven
    // exact ${NAME} tokens, not a blanket "replace anything starting with
    // $" that would also eat $remote_addr if nginx's bare-dollar variables
    // ever get added to the real template later.
    const syntheticTemplate = [
      `log_format custom '$remote_addr - \${HTTP_PORT}';`,
      `push \${MIXCLOUD_PUSH_LINE} for $upstream_addr;`,
    ].join("\n");

    const rendered = renderNginxConfig(syntheticTemplate, makeProfile(), 8080);

    expect(rendered).toContain("$remote_addr");
    expect(rendered).toContain("$upstream_addr");
    expect(rendered).toContain("8080");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting this literal text is gone, not interpolating it.
    expect(rendered).not.toContain("${HTTP_PORT}");
  });
});
