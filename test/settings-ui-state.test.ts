import { describe, expect, it, vi } from "vitest";
import { createSettingsUiState, commitScalarSettingEdit, reduceSettingsUiState } from "../src/settings-ui-state.js";

const counts = { global: 3, project: 2 };

describe("settings UI state", () => {
	it("changes tabs with focus preserved and clamps movement per tab", () => {
		let state = createSettingsUiState();

		state = reduceSettingsUiState(state, { type: "move-selection", delta: 1 }, counts);
		state = reduceSettingsUiState(state, { type: "move-selection", delta: 1 }, counts);
		expect(state.selectedIndex.global).toBe(2);

		state = reduceSettingsUiState(state, { type: "change-tab", delta: 1 }, counts);
		expect(state.activeTab).toBe("project");
		expect(state.selectedIndex.project).toBe(0);

		state = reduceSettingsUiState(state, { type: "move-selection", delta: 5 }, counts);
		expect(state.selectedIndex.project).toBe(1);

		state = reduceSettingsUiState(state, { type: "change-tab", delta: -1 }, counts);
		expect(state.activeTab).toBe("global");
		expect(state.selectedIndex.global).toBe(2);
	});

	it("tracks edit lifecycle for selected scalar rows", () => {
		let state = createSettingsUiState();

		state = reduceSettingsUiState(state, { type: "start-edit", key: "taskInputPrompt" }, counts);
		expect(state.editing).toEqual({ scope: "global", key: "taskInputPrompt" });

		state = reduceSettingsUiState(state, { type: "finish-edit" }, counts);
		expect(state.editing).toBeUndefined();
	});

	it("persists boolean edits immediately through the provided save callback", async () => {
		const save = vi.fn(async () => ({ ok: true as const }));
		const config = { taskInputRequired: true, unknown: "kept" };

		const result = await commitScalarSettingEdit({
			scope: "global",
			config,
			key: "taskInputRequired",
			value: false,
			save,
		});

		expect(result).toEqual({ ok: true });
		expect(config).toEqual({ taskInputRequired: false, unknown: "kept" });
		expect(save).toHaveBeenCalledWith("global", { taskInputRequired: false, unknown: "kept" });
	});

	it("persists confirmed string edits immediately through the provided save callback", async () => {
		const save = vi.fn(async () => ({ ok: true as const }));
		const config = {};

		await expect(
			commitScalarSettingEdit({ scope: "project", config, key: "taskInputPrompt", value: "Continue next slice?", save }),
		).resolves.toEqual({ ok: true });

		expect(config).toEqual({ taskInputPrompt: "Continue next slice?" });
		expect(save).toHaveBeenCalledWith("project", { taskInputPrompt: "Continue next slice?" });
	});
});
