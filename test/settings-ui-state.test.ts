import { describe, expect, it, vi } from "vitest";
import {
	applyStructuredListEdit,
	commitProjectRulesEdit,
	commitScalarSettingEdit,
	commitStructuredListEdit,
	createSettingsUiState,
	reduceSettingsUiState,
	validateStructuredListItems,
} from "../src/settings-ui-state.js";

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

	it("persists confirmed project rules markdown immediately through the provided save callback", async () => {
		const save = vi.fn(async () => ({ ok: true as const }));

		await expect(commitProjectRulesEdit({ rules: "# Handover rules\nVerify before handover.\n", save })).resolves.toEqual({
			ok: true,
		});

		expect(save).toHaveBeenCalledWith("# Handover rules\nVerify before handover.\n");
	});

	it("keeps existing project rules in memory when markdown save fails", async () => {
		const save = vi.fn(async () => ({ ok: false as const, message: "cannot write .pi/handover.md" }));

		await expect(commitProjectRulesEdit({ rules: "", save })).resolves.toEqual({
			ok: false,
			message: "cannot write .pi/handover.md",
		});
	});

	it("applies completion step add, edit, delete, and reorder operations", () => {
		let items = applyStructuredListEdit("completionSteps", [], {
			type: "add",
			item: { name: "Verify", description: "Run checks." },
		});
		items = applyStructuredListEdit("completionSteps", items, {
			type: "add",
			item: { name: "Commit", description: "Commit work." },
		});
		items = applyStructuredListEdit("completionSteps", items, {
			type: "edit",
			index: 0,
			item: { name: "Validate", description: "Run npm run ci." },
		});
		items = applyStructuredListEdit("completionSteps", items, { type: "move", index: 1, delta: -1 });
		items = applyStructuredListEdit("completionSteps", items, { type: "delete", index: 1 });

		expect(items).toEqual([{ name: "Commit", description: "Commit work." }]);
	});

	it("applies prompt context field add, edit, delete, and reorder operations", () => {
		let items = applyStructuredListEdit("promptContextFields", [], {
			type: "add",
			item: { name: "plan", label: "Plan", prompt: "Which plan?", multiline: false, required: true },
		});
		items = applyStructuredListEdit("promptContextFields", items, {
			type: "add",
			item: { name: "risk", label: "Risk", prompt: "Known risks?", multiline: true, required: false, default: "None" },
		});
		items = applyStructuredListEdit("promptContextFields", items, {
			type: "edit",
			index: 0,
			item: { name: "goal", label: "Goal", prompt: "What goal?", multiline: false, required: true },
		});
		items = applyStructuredListEdit("promptContextFields", items, { type: "move", index: 1, delta: -1 });
		items = applyStructuredListEdit("promptContextFields", items, { type: "delete", index: 1 });

		expect(items).toEqual([
			{ name: "risk", label: "Risk", prompt: "Known risks?", multiline: true, required: false, default: "None" },
		]);
	});

	it("blocks structured list saves when an item has an empty name", async () => {
		const save = vi.fn(async () => ({ ok: true as const }));
		const config = { completionSteps: [{ name: "Verify", description: "Run checks." }] };

		const result = await commitStructuredListEdit({
			scope: "global",
			config,
			key: "completionSteps",
			items: [{ name: " ", description: "Missing name." }],
			save,
		});

		expect(result).toEqual({ ok: false, message: "Completion step 1 needs a non-empty name." });
		expect(config).toEqual({ completionSteps: [{ name: "Verify", description: "Run checks." }] });
		expect(save).not.toHaveBeenCalled();
	});

	it("round-trips existing valid structured arrays through the save callback", async () => {
		const save = vi.fn(async () => ({ ok: true as const }));
		const config = {
			unknown: "kept",
			promptContextFields: [{ name: "plan", label: "Plan", prompt: "Which plan?", multiline: false, required: true }],
		};
		const items = applyStructuredListEdit("promptContextFields", config.promptContextFields, {
			type: "add",
			item: { name: "risk", label: "Risk", prompt: "Known risk?", multiline: true, required: false },
		});

		await expect(
			commitStructuredListEdit({ scope: "project", config, key: "promptContextFields", items, save }),
		).resolves.toEqual({ ok: true });

		expect(config).toEqual({ unknown: "kept", promptContextFields: items });
		expect(save).toHaveBeenCalledWith("project", { unknown: "kept", promptContextFields: items });
	});

	it("allows safe-looking prompt field names without requiring them", () => {
		expect(
			validateStructuredListItems("promptContextFields", [
				{ name: "plan_id", label: "Plan", prompt: "Which plan?", multiline: false, required: true },
			]),
		).toEqual({ ok: true });
		expect(
			validateStructuredListItems("promptContextFields", [
				{ name: "release train", label: "Release", prompt: "Which release?", multiline: false, required: true },
			]),
		).toEqual({ ok: true });
	});
});
