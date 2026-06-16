import { expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { AUTO_CONTINUATION_MARKER, buildAgentHandoverRequest, ensureAutoContinuationInstructions } from "../src/prompt.js";

it("builds the exact continuation request with closure rules", () => {
	const prompt = buildAgentHandoverRequest("phase 2 of docs/PLAN.md", {
		...defaultConfig,
		projectRules: "Push to origin before handover.",
	});
	expect(prompt).toContain("Please write a prompt for a new agent session to continue phase 2 of docs/PLAN.md and take over from here.");
	expect(prompt).toContain("1. Build:");
	expect(prompt).toContain("handover_complete");
	expect(prompt).toContain("structured closure checklist items");
	expect(prompt).toContain("status (done, blocked, or skipped)");
	expect(prompt).toContain("Push to origin before handover.");
});

it("includes collected wizard context in the continuation request", () => {
	const prompt = buildAgentHandoverRequest("phase 2", defaultConfig, {
		plan: "docs/PLAN.md",
		risk: "migration not verified",
	});

	expect(prompt).toContain("## Handover context");
	expect(prompt).toContain("- plan: docs/PLAN.md");
	expect(prompt).toContain("- risk: migration not verified");
});

it("includes automatic handover chain instructions", () => {
	const prompt = buildAgentHandoverRequest("phase 2", defaultConfig, {}, {
		chainId: "chain",
		depth: 2,
		maxDepth: 5,
		armed: true,
		createdAt: "now",
		updatedAt: "now",
	});

	expect(prompt).toContain("## Automatic handover mode");
	expect(prompt).toContain("depth 2/5");
});

it("appends automatic continuation instructions to a next-session prompt", () => {
	const prompt = ensureAutoContinuationInstructions("Continue the plan work from here.", {
		chainId: "chain",
		depth: 4,
		maxDepth: 10,
		armed: true,
		createdAt: "now",
		updatedAt: "now",
	});

	expect(prompt).toContain("Continue the plan work from here.");
	expect(prompt).toContain(AUTO_CONTINUATION_MARKER);
	expect(prompt).toContain("chain chain");
	expect(prompt).toContain("5/10");
	expect(prompt).toContain("handover_complete");
	expect(prompt).toContain("self-contained");
});

it("does not duplicate automatic continuation instructions", () => {
	const original = `Continue.\n\n${AUTO_CONTINUATION_MARKER}\n\nExisting canonical block.`;
	const prompt = ensureAutoContinuationInstructions(original, {
		chainId: "chain",
		depth: 1,
		maxDepth: 3,
		armed: true,
		createdAt: "now",
		updatedAt: "now",
	});

	expect(prompt).toBe(original);
	expect(prompt.match(new RegExp(AUTO_CONTINUATION_MARKER, "g"))?.length).toBe(1);
});

it("appends an explicit stop note at automatic handover max depth", () => {
	const prompt = ensureAutoContinuationInstructions("Final follow-up.", {
		chainId: "chain",
		depth: 3,
		maxDepth: 3,
		armed: true,
		createdAt: "now",
		updatedAt: "now",
	});

	expect(prompt).toContain(AUTO_CONTINUATION_MARKER);
	expect(prompt).toContain("has reached its max depth (3/3)");
	expect(prompt).toContain("Do not continue the automatic chain");
	expect(prompt).not.toContain("Before ending this turn, call `handover_complete`");
});
