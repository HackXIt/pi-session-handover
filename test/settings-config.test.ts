import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEditableSettingsConfig, loadEditableSettingsTarget, saveEditableSettingsTarget } from "../src/settings-config.js";

describe("editable settings target config IO", () => {
	it("reads missing global and project config files as empty editable config", async () => {
		const dir = await mkdtemp(join(tmpdir(), "handover-settings-config-"));
		const globalConfigPath = join(dir, "agent", "extensions", "pi-session-handover.json");

		await expect(loadEditableSettingsConfig("global", dir, { globalConfigPath })).resolves.toEqual({
			ok: true,
			config: {},
			projectRules: undefined,
		});
		await expect(loadEditableSettingsConfig("project", dir, { globalConfigPath })).resolves.toEqual({
			ok: true,
			config: {},
			projectRules: undefined,
		});
	});

	it("saves json by creating parent directories with pretty formatting and a trailing newline", async () => {
		const dir = await mkdtemp(join(tmpdir(), "handover-settings-config-"));
		const jsonPath = join(dir, "nested", ".pi", "handover.json");

		await expect(saveEditableSettingsTarget({ jsonPath, config: { taskInputPrompt: "Continue what?" } })).resolves.toEqual({
			ok: true,
		});

		await expect(readFile(jsonPath, "utf8")).resolves.toBe(`{\n  "taskInputPrompt": "Continue what?"\n}\n`);
	});

	it("preserves unknown json keys when updating known fields", async () => {
		const dir = await mkdtemp(join(tmpdir(), "handover-settings-config-"));
		const jsonPath = join(dir, "handover.json");
		await writeFile(jsonPath, JSON.stringify({ customSetting: { nested: true }, taskInputPrompt: "Old prompt" }));

		await expect(saveEditableSettingsTarget({ jsonPath, config: { taskInputPrompt: "New prompt" } })).resolves.toEqual({
			ok: true,
		});

		await expect(readFile(jsonPath, "utf8")).resolves.toBe(
			`{\n  "customSetting": {\n    "nested": true\n  },\n  "taskInputPrompt": "New prompt"\n}\n`,
		);
	});

	it("reports invalid json as recoverable and does not overwrite it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "handover-settings-config-"));
		const jsonPath = join(dir, "handover.json");
		await writeFile(jsonPath, `{ "taskInputPrompt": `);

		const loadResult = await loadEditableSettingsTarget({ jsonPath });
		expect(loadResult.ok).toBe(false);
		if (loadResult.ok) throw new Error("expected invalid json");
		expect(loadResult.error).toMatchObject({ kind: "invalid-json", path: jsonPath });

		const saveResult = await saveEditableSettingsTarget({ jsonPath, config: { taskInputPrompt: "New prompt" } });
		expect(saveResult.ok).toBe(false);
		await expect(readFile(jsonPath, "utf8")).resolves.toBe(`{ "taskInputPrompt": `);
	});

	it("reads and saves project markdown rules", async () => {
		const dir = await mkdtemp(join(tmpdir(), "handover-settings-config-"));
		const jsonPath = join(dir, ".pi", "handover.json");
		const markdownPath = join(dir, ".pi", "handover.md");

		await expect(
			saveEditableSettingsTarget({ jsonPath, markdownPath, config: {}, projectRules: "Always mention verification.\n" }),
		).resolves.toEqual({ ok: true });
		await expect(loadEditableSettingsTarget({ jsonPath, markdownPath })).resolves.toEqual({
			ok: true,
			config: {},
			projectRules: "Always mention verification.\n",
		});
	});
});
