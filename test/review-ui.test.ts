import { describe, expect, it } from "vitest";
import type { PendingHandover } from "../src/domain.js";
import { buildReviewHeaderLines, buildReviewIntroLines } from "../src/review-ui.js";

function pending(overrides: Partial<PendingHandover> = {}): PendingHandover {
	return {
		id: "pending-1",
		nextPrompt: "continue the work",
		summary: "Completed a useful slice.",
		checklist: [
			{ name: "Red test", status: "done", evidence: "very long command output that should not dominate the editor preview" },
			{ name: "Implementation", status: "done", evidence: "more long command output" },
		],
		reviewPromptBeforeStart: true,
		createdAt: "2026-06-05T00:00:00.000Z",
		...overrides,
	};
}

describe("handover review header", () => {
	it("keeps completed checklist evidence out of the prompt editing preview", () => {
		const lines = buildReviewHeaderLines(pending(), 80);

		expect(lines).toContain("Checklist: all 2 item(s) done.");
		expect(lines.join("\n")).not.toContain("very long command output");
		expect(lines.join("\n")).not.toContain("evidence=");
	});

	it("surfaces blocked or skipped checklist items without crowding the editor", () => {
		const lines = buildReviewHeaderLines(
			pending({
				checklist: [
					{ name: "Verify", status: "blocked", notes: "CI unavailable", evidence: "full logs omitted" },
					{ name: "Publish", status: "skipped" },
					{ name: "Summarize", status: "done" },
				],
			}),
			80,
		);

		expect(lines).toContain("Checklist: 1 done, 1 blocked, 1 skipped.");
		expect(lines).toContain("! Verify — CI unavailable");
		expect(lines).toContain("- Publish");
		expect(lines.join("\n")).not.toContain("full logs omitted");
	});

	it("uses plain header chrome so it does not stack borders above the editor", () => {
		const lines = buildReviewIntroLines(pending(), 80);

		expect(lines[0]).toBe("Handover review");
		expect(lines.join("\n")).not.toMatch(/[╭╮╰╯│─]/);
	});
});
