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
