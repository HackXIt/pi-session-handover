import { describe, expect, it } from "vitest";
import {
	HANDOVER_PENDING_ENTRY,
	HANDOVER_RESOLVED_ENTRY,
	findPendingHandover,
	normalizeChecklist,
	shouldReviewHandover,
} from "../src/domain.js";

describe("normalizeChecklist", () => {
	it("keeps plain string completedSteps as done checklist items", () => {
		expect(normalizeChecklist(["Build", "Push"])).toEqual([
			{ name: "Build", status: "done" },
			{ name: "Push", status: "done" },
		]);
	});

	it("accepts structured checklist items", () => {
		expect(
			normalizeChecklist([
				{ id: "build", status: "done", notes: "npm test", evidence: ["npm test"] },
				{ name: "Deploy", status: "skipped", notes: "not required" },
			]),
		).toEqual([
			{ id: "build", name: "build", status: "done", notes: "npm test", evidence: ["npm test"] },
			{ name: "Deploy", status: "skipped", notes: "not required" },
		]);
	});

	it("rejects blocked items without notes", () => {
		expect(() => normalizeChecklist([{ name: "Push", status: "blocked" }])).toThrow(/must include notes/);
	});
});

describe("shouldReviewHandover", () => {
	it("forces review when any checklist item is blocked", () => {
		expect(shouldReviewHandover(false, [{ name: "Push", status: "blocked", notes: "remote down" }])).toBe(true);
	});

	it("uses config review when no checklist item is blocked", () => {
		expect(shouldReviewHandover(false, [{ name: "Build", status: "done" }])).toBe(false);
		expect(shouldReviewHandover(true, [{ name: "Build", status: "done" }])).toBe(true);
	});
});

describe("findPendingHandover", () => {
	const pending = {
		id: "abc",
		nextPrompt: "continue",
		checklist: [],
		reviewPromptBeforeStart: true,
		createdAt: "2026-06-04T00:00:00.000Z",
	};

	it("returns the latest unresolved pending handover", () => {
		expect(findPendingHandover([{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: pending }])).toEqual(pending);
	});

	it("ignores resolved pending handovers", () => {
		expect(
			findPendingHandover([
				{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: pending },
				{ type: "custom", customType: HANDOVER_RESOLVED_ENTRY, data: { id: "abc", reason: "cancelled" } },
			]),
		).toBeUndefined();
	});
});
