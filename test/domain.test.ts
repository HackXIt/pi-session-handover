import { describe, expect, it } from "vitest";
import {
	HANDOVER_AUTO_STATE_ENTRY,
	HANDOVER_PENDING_ENTRY,
	HANDOVER_RESOLVED_ENTRY,
	createHandoverMetadata,
	createNextAutoState,
	findAutoHandoverState,
	findPendingHandover,
	inferMaxDepthFromPlanText,
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

describe("createHandoverMetadata", () => {
	it("copies durable handover data without the next prompt or review policy", () => {
		const metadata = createHandoverMetadata(
			{
				id: "abc",
				nextPrompt: "continue",
				summary: "done",
				checklist: [{ name: "Build", status: "done" }],
				parentSession: "/tmp/parent.jsonl",
				reviewPromptBeforeStart: true,
				createdAt: "2026-06-04T00:00:00.000Z",
			},
			"2026-06-04T00:01:00.000Z",
		);

		expect(metadata).toEqual({
			id: "abc",
			summary: "done",
			checklist: [{ name: "Build", status: "done" }],
			parentSession: "/tmp/parent.jsonl",
			createdAt: "2026-06-04T00:00:00.000Z",
			receivedAt: "2026-06-04T00:01:00.000Z",
		});
		expect(metadata).not.toHaveProperty("nextPrompt");
		expect(metadata).not.toHaveProperty("reviewPromptBeforeStart");
	});
});

describe("auto handover helpers", () => {
	const auto = {
		chainId: "chain",
		depth: 1,
		maxDepth: 2,
		armed: true,
		createdAt: "2026-06-04T00:00:00.000Z",
		updatedAt: "2026-06-04T00:00:00.000Z",
	};

	it("finds the latest armed auto state", () => {
		expect(findAutoHandoverState([{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto }])).toEqual(auto);
		expect(findAutoHandoverState([{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: { ...auto, armed: false } }])).toBeUndefined();
	});

	it("increments auto depth until max depth", () => {
		expect(createNextAutoState(auto, "later")?.depth).toBe(2);
		expect(createNextAutoState({ ...auto, depth: 2 }, "later")).toBeUndefined();
	});

	it("infers max depth from checklist, numbered, and phase headings", () => {
		expect(inferMaxDepthFromPlanText("- [ ] one\n- [x] two\n## Phase three")).toBe(3);
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
