import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	HANDOVER_SESSION_CONFIG_ENTRY,
	defaultConfig,
	getGlobalHandoverConfigPath,
	loadHandoverConfig,
	mergeConfig,
} from "../src/config.js";

it("keeps defaults without project config", async () => {
	const dir = await mkdtemp(join(tmpdir(), "handover-config-"));
	await expect(loadHandoverConfig(dir, { globalConfigPath: join(dir, "missing-global.json") })).resolves.toEqual(defaultConfig);
});

it("merges json config and markdown project rules", async () => {
	const dir = await mkdtemp(join(tmpdir(), "handover-config-"));
	await mkdir(join(dir, ".pi"));
	await writeFile(
		join(dir, ".pi", "handover.json"),
		JSON.stringify({
			reviewPromptBeforeStart: false,
			autoReviewPromptBeforeStart: true,
			taskInputMultiline: true,
			completionSteps: [{ name: "Perforce", description: "Submit the changelist." }],
		}),
	);
	await writeFile(join(dir, ".pi", "handover.md"), "Always mention the plan file.");

	const config = await loadHandoverConfig(dir, { globalConfigPath: join(dir, "missing-global.json") });
	expect(config.reviewPromptBeforeStart).toBe(false);
	expect(config.autoReviewPromptBeforeStart).toBe(true);
	expect(config.taskInputMultiline).toBe(true);
	expect(config.completionSteps).toEqual([{ name: "Perforce", description: "Submit the changelist." }]);
	expect(config.projectRules).toBe("Always mention the plan file.");
});

it("ignores invalid completion steps", () => {
	const config = mergeConfig(defaultConfig, { completionSteps: [{ description: "missing name" }] });
	expect(config.completionSteps).toEqual(defaultConfig.completionSteps);
});

it("merges prompt context fields for wizard mode", () => {
	const config = mergeConfig(defaultConfig, {
		promptContextFields: [
			{ name: "plan", label: "Plan file", prompt: "Which plan file?", multiline: false },
			{ name: "risks" },
			{ name: "notes", required: false, default: "none" },
			{ label: "invalid" },
		],
	});

	expect(config.promptContextFields).toEqual([
		{ name: "plan", label: "Plan file", prompt: "Which plan file?", multiline: false, required: true },
		{ name: "risks", label: "risks", prompt: "risks", multiline: false, required: true },
		{ name: "notes", label: "notes", prompt: "notes", multiline: false, required: false, default: "none" },
	]);
});

it("layers built-ins, legacy global config, mistaken global config, global config, project config, markdown rules, and session overrides", async () => {
	const dir = await mkdtemp(join(tmpdir(), "handover-config-"));
	const legacyGlobalPath = join(dir, "legacy-global.json");
	const mistakenGlobalPath = join(dir, "mistaken-global.json");
	const globalPath = join(dir, "global.json");
	await writeFile(legacyGlobalPath, JSON.stringify({ reviewPromptBeforeStart: false, taskInputPrompt: "Legacy global task?" }));
	await writeFile(mistakenGlobalPath, JSON.stringify({ taskInputPrompt: "Mistaken global task?", taskInputMultiline: true }));
	await writeFile(globalPath, JSON.stringify({ taskInputPrompt: "Global task?" }));
	await mkdir(join(dir, ".pi"));
	await writeFile(join(dir, ".pi", "handover.json"), JSON.stringify({ taskInputPrompt: "Project task?", taskInputMultiline: true }));
	await writeFile(join(dir, ".pi", "handover.md"), "Project rules win.");

	const config = await loadHandoverConfig(dir, {
		legacyGlobalConfigPath: legacyGlobalPath,
		mistakenGlobalConfigPath: mistakenGlobalPath,
		globalConfigPath: globalPath,
		entries: [
			{
				type: "custom",
				customType: HANDOVER_SESSION_CONFIG_ENTRY,
				data: { taskInputMultiline: false, nextPromptInstructions: "Session prompt instructions." },
			},
		],
	});

	expect(config.reviewPromptBeforeStart).toBe(false);
	expect(config.taskInputPrompt).toBe("Project task?");
	expect(config.taskInputMultiline).toBe(false);
	expect(config.nextPromptInstructions).toBe("Session prompt instructions.");
	expect(config.projectRules).toBe("Project rules win.");
});

it("uses the pi-session-handover global config path", () => {
	expect(getGlobalHandoverConfigPath()).toMatch(/pi-session-handover\.json$/);
});
