import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const courseEventSchema = z.discriminatedUnion("type", [
  z.object({
    event_id: z.string().min(1),
    type: z.literal("course.delivery.opened"),
    course_id: z.string().min(1),
    learner_id: z.string().min(1),
    occurred_at: z.string().datetime()
  }),
  z.object({
    event_id: z.string().min(1),
    type: z.literal("learner.deadline.changed"),
    course_id: z.string().min(1),
    learner_id: z.string().min(1),
    deadline_at: z.string().datetime(),
    occurred_at: z.string().datetime()
  }),
  z.object({
    event_id: z.string().min(1),
    type: z.literal("educator.report.requested"),
    course_id: z.string().min(1),
    educator_id: z.string().min(1),
    occurred_at: z.string().datetime()
  })
]);

export type CourseEvent = z.infer<typeof courseEventSchema>;

export type CourseProjection = {
  openedLearners: Set<string>;
  deadlines: Map<string, string>;
  reportsRequested: number;
  processedEventIds: Set<string>;
};

export function emptyProjection(): CourseProjection {
  return {
    openedLearners: new Set(),
    deadlines: new Map(),
    reportsRequested: 0,
    processedEventIds: new Set()
  };
}

export function applyCourseEvent(state: CourseProjection, event: CourseEvent) {
  if (state.processedEventIds.has(event.event_id)) {
    return { applied: false, reason: "duplicate" as const };
  }

  state.processedEventIds.add(event.event_id);
  if (event.type === "course.delivery.opened") {
    state.openedLearners.add(event.learner_id);
  } else if (event.type === "learner.deadline.changed") {
    state.deadlines.set(event.learner_id, event.deadline_at);
  } else {
    state.reportsRequested += 1;
  }
  return { applied: true, reason: "updated" as const };
}

export function signWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signWebhook(rawBody, secret), "hex");
  const supplied = Buffer.from(signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
