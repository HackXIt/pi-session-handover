import { describe, expect, it } from "vitest";
import { HANDOVER_AUTO_STATE_ENTRY, HANDOVER_PENDING_ENTRY, HANDOVER_RESOLVED_ENTRY, type PendingHandover } from "../src/domain.js";
import { HandoverRuntimeState } from "../src/pending-store.js";

const pending = (id: string): PendingHandover => ({
	id,
	nextPrompt: `continue ${id}`,
	checklist: [],
	reviewPromptBeforeStart: false,
	createdAt: "2026-06-05T00:00:00.000Z",
});

const auto = {
	chainId: "chain",
	depth: 1,
	maxDepth: 3,
	armed: true,
	createdAt: "2026-06-05T00:00:00.000Z",
	updatedAt: "2026-06-05T00:00:00.000Z",
};

function ctx(entries: Array<{ type: string; customType?: string; data?: unknown }>) {
	return { sessionManager: { getEntries: () => entries } };
}

describe("HandoverRuntimeState", () => {
	it("rebuilds pending cache from the current session entries", () => {
		const state = new HandoverRuntimeState();
		const first = pending("first");
		const second = pending("second");

		expect(state.getPending(ctx([{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: first }]), "first")).toEqual(first);
		expect(state.getPending(ctx([{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: second }]), "first")).toBeUndefined();
	});

	it("returns the latest unresolved pending entry and ignores resolved entries", () => {
		const state = new HandoverRuntimeState();
		const first = pending("first");
		const second = pending("second");

		expect(
			state.getPending(ctx([
				{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: first },
				{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: second },
				{ type: "custom", customType: HANDOVER_RESOLVED_ENTRY, data: { id: "second" } },
			])),
		).toEqual(first);
	});

	it("tracks only armed auto state from the current session", () => {
		const state = new HandoverRuntimeState();

		expect(state.getAuto(ctx([{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto }]))).toEqual(auto);
		expect(state.getAuto(ctx([{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: { ...auto, armed: false } }]))).toBeUndefined();
	});
});
