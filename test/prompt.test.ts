import { expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { buildAgentHandoverRequest } from "../src/prompt.js";

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
