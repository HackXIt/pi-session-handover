import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, loadHandoverConfig, mergeConfig } from "../src/config.js";

it("keeps defaults without project config", async () => {
	const dir = await mkdtemp(join(tmpdir(), "handover-config-"));
	await expect(loadHandoverConfig(dir)).resolves.toEqual(defaultConfig);
});

it("merges json config and markdown project rules", async () => {
	const dir = await mkdtemp(join(tmpdir(), "handover-config-"));
	await mkdir(join(dir, ".pi"));
	await writeFile(
		join(dir, ".pi", "handover.json"),
		JSON.stringify({
			reviewPromptBeforeStart: false,
			taskInputMultiline: true,
			completionSteps: [{ name: "Perforce", description: "Submit the changelist." }],
		}),
	);
	await writeFile(join(dir, ".pi", "handover.md"), "Always mention the plan file.");

	const config = await loadHandoverConfig(dir);
	expect(config.reviewPromptBeforeStart).toBe(false);
	expect(config.taskInputMultiline).toBe(true);
	expect(config.completionSteps).toEqual([{ name: "Perforce", description: "Submit the changelist." }]);
	expect(config.projectRules).toBe("Always mention the plan file.");
});

it("ignores invalid completion steps", () => {
	const config = mergeConfig(defaultConfig, { completionSteps: [{ description: "missing name" }] });
	expect(config.completionSteps).toEqual(defaultConfig.completionSteps);
});
