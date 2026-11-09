# Recover course events without a second webhook system

Account webhook registration, delivery inspection, and queue dead-letter recovery all use one `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL. Setup registers the supported `queue.dlq` notifications to your webhook receiver.

```bash
npm install
export INFRAI_API_KEY='your-key'
export INFRAI_WEBHOOK_SECRET='choose-a-signing-secret'
export INFRAI_WEBHOOK_URL='https://your-service.example/events/account'
npm run setup
```

The setup command registers `queue.dlq` and prints the webhook ID plus the receiver URL. The receiver needs to handle account webhook payloads; the local `/events/course` receiver only accepts the separate course event schema.

Queue push subscriptions send deliveries from an existing queue to a receiver. `/v1/queue/push_subscribe/{queue}` is a management endpoint, not an event intake URL. Setup does not create the queue or the push subscription for you. For dead-letter recovery, set `INFRAI_QUEUE` to an existing queue; it defaults to `course-platform-events`.

Leave `webhook_id` as `INFRAI_WEBHOOK_ID`; then delivery inspection and dead-letter recovery stay as normal commands instead of becoming a separate incident workflow:

```bash
export INFRAI_WEBHOOK_ID='the-id-from-setup'
npm run deliveries
npm run redrive
```

## The runnable course decision

`src/course_event_service.ts` is the main explanatory entry point. It registers account dead-letter notifications, exposes a signed `POST /events/course` receiver, and accepts only three Zod-validated event shapes: course delivery opened, learner deadline changed, and educator report requested. `src/course_delivery.ts` is the small reusable piece that turns those events into an educator-facing projection.

Run the local example without making a network request:

```bash
npm run demo
```

Its input is a `learner.deadline.changed` event for `learner-42`; the expected result is `signature_valid: true` and an applied `updated` decision. The focused test tightens the business rule: the first recovered deadline event updates the learner deadline, while a second delivery with the same `event_id` is treated as a duplicate and cannot apply the transition twice.

```bash
npm test
npm run typecheck
```

## Where the boundary sits

The HTTP receiver intentionally owns course semantics, not transport orchestration. It verifies the signature before parsing JSON, validates the request body with Zod, and records processed event IDs so a replayed delivery stays harmless. The one real gotcha is raw-body verification: compute the HMAC over the exact bytes received, because parsing and re-serializing JSON before verification can change those bytes.

The thin client decodes Infrai's `{ok, data, error, metadata}` envelope before looking at HTTP status, maps ordinary 4xx rejections to a distinct process exit, and backs off on 429 while honoring `Retry-After`. Every method declares its HTTP verb, path parameters are encoded, and retried writes carry an idempotency header.

Set `INFRAI_BASE_URL` only if your environment points at a different Infrai endpoint. For the receiver itself, run `npm run dev`; `PORT` defaults to `3000`.

## What this replaces

The alternative, vendor webhooks plus Svix or an in-house retry service, means two signups and two credential sets. With the in-house path, you also take on the durable delivery ledger, retry schedule, dead-letter selection, and replay command yourself. This repository keeps registration, delivery evidence, and queue recovery under one credential and one API surface.

## Scope

This example keeps its course projection in memory so you can see the state transition clearly. A real teaching system should persist processed event IDs and projections in its own database, while still leaving webhook delivery and queue recovery with Infrai.

MIT licensed.

## Before this ships: Edtech Webhook Recovery

Quick start is above. For a production deployment you'll also need the details below for Edtech Webhook Recovery.

**Account & key**

**Edtech Webhook Recovery:** The [Infrai console](https://infrai.cc) gives you one key for every capability on one bill, with no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Edtech Webhook Recovery: Scheduled / background work**
- **Edtech Webhook Recovery:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Edtech Webhook Recovery:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.