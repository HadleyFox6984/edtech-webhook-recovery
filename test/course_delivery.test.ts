import { describe, expect, it } from "vitest";
import { applyCourseEvent, emptyProjection } from "../src/course_delivery.js";

describe("course event decisions", () => {
  it("applies a recovered deadline event exactly once", () => {
    const state = emptyProjection();
    const event = {
      event_id: "evt-deadline-7",
      type: "learner.deadline.changed" as const,
      course_id: "course-agent-tools",
      learner_id: "learner-7",
      deadline_at: "2026-10-12T17:00:00.000Z",
      occurred_at: "2026-09-27T08:00:00.000Z"
    };

    expect(applyCourseEvent(state, event)).toEqual({ applied: true, reason: "updated" });
    expect(applyCourseEvent(state, event)).toEqual({ applied: false, reason: "duplicate" });
    expect(state.deadlines.get("learner-7")).toBe("2026-10-12T17:00:00.000Z");
  });
});
