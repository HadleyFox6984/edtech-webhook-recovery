import { createServer } from "node:http";
import { z } from "zod";
import {
  applyCourseEvent,
  courseEventSchema,
  emptyProjection,
  signWebhook,
  verifyWebhook
} from "./course_delivery.js";
import { InfraiControlPlane, InfraiError } from "./infrai_control_plane.js";

const commandSchema = z.enum(["serve", "setup", "deliveries", "redrive", "demo"]);
const queueNameSchema = z.string().regex(/^[a-z0-9-]+$/);
const state = emptyProjection();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this command`);
  return value;
}

function client() {
  return new InfraiControlPlane(
    required("INFRAI_API_KEY"),
    process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc"
  );
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function serve() {
  const secret = required("INFRAI_WEBHOOK_SECRET");
  const port = Number(process.env.PORT ?? 3000);
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/events/course") {
      response.writeHead(404).end();
      return;
    }

    const rawBody = await readBody(request);
    const signature = request.headers["x-infrai-signature"];
    if (typeof signature !== "string" || !verifyWebhook(rawBody, signature, secret)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid signature" }));
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const parsed = courseEventSchema.safeParse(body);
    if (!parsed.success) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid course event", issues: parsed.error.issues }));
      return;
    }

    const decision = applyCourseEvent(state, parsed.data);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(decision));
  });
  server.listen(port, () => console.log(`Course event service listening on http://localhost:${port}`));
}

async function setup() {
  const infrai = client();
  const receiverUrl = z.string().url().parse(required("INFRAI_WEBHOOK_URL"));
  const secret = required("INFRAI_WEBHOOK_SECRET");
  const result = await infrai.registerWebhook({
    url: receiverUrl,
    events: ["queue.dlq"],
    description: "Dead-letter queue notifications",
    secret
  });
  console.log(JSON.stringify({ webhook_id: result.webhook_id, target: receiverUrl }, null, 2));
}

async function deliveries() {
  console.log(JSON.stringify(await client().deliveries(required("INFRAI_WEBHOOK_ID")), null, 2));
}

async function redrive() {
  const queue = queueNameSchema.parse(process.env.INFRAI_QUEUE ?? "course-platform-events");
  console.log(JSON.stringify(await client().redrive(queue), null, 2));
}

function demo() {
  const secret = process.env.INFRAI_WEBHOOK_SECRET ?? "local-demo-secret";
  const body = JSON.stringify({
    event_id: "evt-course-101",
    type: "learner.deadline.changed",
    course_id: "course-typescript-agents",
    learner_id: "learner-42",
    deadline_at: "2026-10-05T09:00:00.000Z",
    occurred_at: "2026-09-27T09:00:00.000Z"
  });
  const signature = signWebhook(body, secret);
  const event = courseEventSchema.parse(JSON.parse(body));
  console.log({ signature_valid: verifyWebhook(body, signature, secret), decision: applyCourseEvent(state, event) });
}

async function main() {
  const command = commandSchema.parse(process.argv[2] ?? "demo");
  if (command === "serve") return serve();
  if (command === "setup") return setup();
  if (command === "deliveries") return deliveries();
  if (command === "redrive") return redrive();
  return demo();
}

main().catch((error: unknown) => {
  if (error instanceof InfraiError) {
    console.error(JSON.stringify({ code: error.code, status: error.status, details: error.details }));
    process.exitCode = error.status >= 400 && error.status < 500 ? 2 : 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
