// RelayRouter (unit — a fake IngestEventReceiver, no HTTP server needed).
// Covers the loopback-only guard: the one thing this router adds on top of
// just forwarding to IngestEventReceiver, since the receiver's own tests
// already cover the authorization/event-emission logic.

import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "../../src/infra/errors.ts";
import type { IngestEventReceiver } from "../../src/modules/relay/ingest-event-receiver.ts";
import { RelayRouter } from "../../src/modules/relay/relay.router.ts";

function fakeReceiver(calls: Array<{ method: string; streamKey: string }>): IngestEventReceiver {
  return {
    handlePublish: async (streamKey: string) => {
      calls.push({ method: "handlePublish", streamKey });
    },
    handlePublishDone: async (streamKey: string) => {
      calls.push({ method: "handlePublishDone", streamKey });
    },
  } as unknown as IngestEventReceiver;
}

function publishRequest(streamKey: string): Request {
  const body = new URLSearchParams({ name: streamKey });
  return new Request("http://internal/internal/nginx/on-publish", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

describe("RelayRouter", () => {
  test("rejects a request from a non-loopback address", async () => {
    const router = new RelayRouter(fakeReceiver([]));
    const req = publishRequest("some-key");
    const url = new URL(req.url);

    await expect(router.handle(req, url, "203.0.113.5")).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("rejects a request with no resolvable client IP", async () => {
    const router = new RelayRouter(fakeReceiver([]));
    const req = publishRequest("some-key");
    const url = new URL(req.url);

    await expect(router.handle(req, url, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("accepts a request from 127.0.0.1 and forwards the stream key", async () => {
    const calls: Array<{ method: string; streamKey: string }> = [];
    const router = new RelayRouter(fakeReceiver(calls));
    const req = publishRequest("my-stream-key");
    const url = new URL(req.url);

    const response = await router.handle(req, url, "127.0.0.1");

    expect(response?.status).toBe(200);
    expect(calls).toEqual([{ method: "handlePublish", streamKey: "my-stream-key" }]);
  });

  test("accepts a request from ::1 and routes on-publish-done correctly", async () => {
    const calls: Array<{ method: string; streamKey: string }> = [];
    const router = new RelayRouter(fakeReceiver(calls));
    const body = new URLSearchParams({ name: "my-stream-key" });
    const req = new Request("http://internal/internal/nginx/on-publish-done", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const url = new URL(req.url);

    const response = await router.handle(req, url, "::1");

    expect(response?.status).toBe(200);
    expect(calls).toEqual([{ method: "handlePublishDone", streamKey: "my-stream-key" }]);
  });

  test("ignores a path it doesn't own", async () => {
    const router = new RelayRouter(fakeReceiver([]));
    const req = new Request("http://internal/unrelated", { method: "POST" });
    const url = new URL(req.url);

    const response = await router.handle(req, url, "127.0.0.1");
    expect(response).toBeUndefined();
  });
});
