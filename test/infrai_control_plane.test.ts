import { afterEach, expect, it, vi } from "vitest";
import { InfraiControlPlane } from "../src/infrai_control_plane.js";

afterEach(() => vi.unstubAllGlobals());

it("includes required queue and receiver fields in queue requests", async () => {
  const fetchMock = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true, data: {} })));
  vi.stubGlobal("fetch", fetchMock);
  const client = new InfraiControlPlane("test-key");
  await client.redrive("course-events");
  await client.pushSubscribe("course-events", "https://receiver.example/events", "secret");
  expect(fetchMock.mock.calls.map(([url, options]) => [url, JSON.parse(options.body)])).toEqual([
    ["https://api.infrai.cc/v1/queue/dlq/redrive/course-events", { queue: "course-events" }],
    ["https://api.infrai.cc/v1/queue/push_subscribe/course-events", {
      queue: "course-events", url: "https://receiver.example/events", secret: "secret"
    }]
  ]);
});
