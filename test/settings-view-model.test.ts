import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { buildSettingsViewModel } from "../src/settings-view-model.js";

describe("settings view model", () => {
	it("marks global items overridden when project config has a higher-precedence value", () => {
		const model = buildSettingsViewModel({
			target: "global",
			globalConfig: { taskInputPrompt: "Global prompt" },
			projectConfig: { taskInputPrompt: "Project prompt" },
		});

		expect(model.items.find((item) => item.key === "taskInputPrompt")).toMatchObject({
			value: "Global prompt",
			effectiveValue: "Project prompt",
			configured: true,
			overriddenBy: ["project"],
		});
	});

	it("marks project items overridden when session config has a higher-precedence value", () => {
		const model = buildSettingsViewModel({
			target: "project",
			projectConfig: { reviewPromptBeforeStart: true },
			sessionConfig: { reviewPromptBeforeStart: false },
		});

		expect(model.items.find((item) => item.key === "reviewPromptBeforeStart")).toMatchObject({
			value: true,
			effectiveValue: false,
			configured: true,
			overriddenBy: ["session"],
		});
	});

	it("distinguishes defaults from explicitly configured values", () => {
		const model = buildSettingsViewModel({
			target: "global",
			globalConfig: { taskInputRequired: defaultConfig.taskInputRequired },
		});

		expect(model.items.find((item) => item.key === "taskInputRequired")).toMatchObject({
			value: defaultConfig.taskInputRequired,
			configured: true,
			source: "configured",
		});
		expect(model.items.find((item) => item.key === "taskInputMultiline")).toMatchObject({
			value: defaultConfig.taskInputMultiline,
			configured: false,
			source: "default",
		});
	});

	it("renders useful summaries for structured list settings", () => {
		const model = buildSettingsViewModel({
			target: "project",
			projectConfig: {
				completionSteps: [
					{ name: "Verify", description: "Run checks." },
					{ name: "Commit", description: "Commit work." },
				],
				promptContextFields: [
					{ name: "plan", label: "Plan", prompt: "Which plan?", multiline: false, required: true },
					{ name: "risk", label: "Risk", prompt: "Known risk?", multiline: true, required: false },
				],
			},
		});

		expect(model.items.find((item) => item.key === "completionSteps")).toMatchObject({
			summary: "2 steps: Verify, Commit",
		});
		expect(model.items.find((item) => item.key === "promptContextFields")).toMatchObject({
			summary: "2 fields: plan, risk",
		});
	});

	it("represents all current config fields and project markdown rules on the project tab", () => {
		const model = buildSettingsViewModel({ target: "project", projectRules: "Project rules." });

		expect(model.items.map((item) => item.key)).toEqual([
			"taskInputPrompt",
			"taskInputMultiline",
			"taskInputRequired",
			"reviewPromptBeforeStart",
			"autoReviewPromptBeforeStart",
			"agentInstructions",
			"nextPromptInstructions",
			"promptContextFields",
			"completionSteps",
			"projectRules",
		]);
		expect(model.items.find((item) => item.key === "projectRules")).toMatchObject({
			kind: "markdown",
			value: "Project rules.",
		});
	});

	it("omits project markdown rules from the global tab", () => {
		const model = buildSettingsViewModel({ target: "global", projectRules: "Project rules." });

		expect(model.items.map((item) => item.key)).toEqual([
			"taskInputPrompt",
			"taskInputMultiline",
			"taskInputRequired",
			"reviewPromptBeforeStart",
			"autoReviewPromptBeforeStart",
			"agentInstructions",
			"nextPromptInstructions",
			"promptContextFields",
			"completionSteps",
		]);
	});
});
