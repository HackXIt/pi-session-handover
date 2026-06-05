import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HANDOVER_SESSION_CONFIG_ENTRY, type HandoverConfig, type HandoverPromptField, type HandoverStep } from "./config.js";
import {
	getEditableSettingsTargetPaths,
	loadEditableSettingsConfig,
	saveEditableSettingsTarget,
	type EditableHandoverConfig,
	type EditableSettingsScope,
} from "./settings-config.js";
import { buildSettingsViewModel, type SettingsItem, type SettingsViewModel } from "./settings-view-model.js";
import {
	applyStructuredListEdit,
	commitProjectRulesEdit,
	commitScalarSettingEdit,
	commitStructuredListEdit,
	createSettingsUiState,
	reduceSettingsUiState,
	type CommitProjectRulesEditResult,
	type CommitScalarSettingEditResult,
	type SettingsUiState,
	type StructuredListItem,
	type StructuredListKey,
} from "./settings-ui-state.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
type CustomFactory = Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0];
type CustomTheme = Parameters<CustomFactory>[1];
type CustomKeybindings = Parameters<CustomFactory>[2];

type EntryLike = { type: string; customType?: string; data?: unknown };

type SettingsData = {
	globalConfig: EditableHandoverConfig;
	projectConfig: EditableHandoverConfig;
	sessionConfig: EditableHandoverConfig;
	projectRules?: string;
};

type SettingsOverlayMode =
	| { kind: "browse" }
	| {
			kind: "edit-text";
			scope: EditableSettingsScope;
			item: SettingsItem;
			draft: string;
			multiline: boolean;
			message?: string;
	  };

const KEY = {
	escape: "\u001b",
	enter: new Set(["\r", "\n"]),
	tab: "\t",
	shiftTab: "\u001b[Z",
	up: "\u001b[A",
	down: "\u001b[B",
	right: "\u001b[C",
	left: "\u001b[D",
};

function truncate(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function pad(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - text.length))}`;
}

function renderBox(theme: CustomTheme, width: number, title: string, body: string[]): string[] {
	const innerWidth = Math.max(20, width - 4);
	const border = (text: string) => theme.fg("borderAccent", text);
	const titleText = ` ${title} `;
	const titleWidth = Math.min(titleText.length, innerWidth);
	const left = Math.max(0, Math.floor((innerWidth - titleWidth) / 2));
	const right = Math.max(0, innerWidth - titleWidth - left);
	const lines = [
		border(`╭${"─".repeat(left)}`) + theme.fg("accent", theme.bold(truncate(titleText, titleWidth))) + border(`${"─".repeat(right)}╮`),
	];
	for (const line of body) {
		lines.push(border("│ ") + pad(truncate(line, innerWidth), innerWidth) + border(" │"));
	}
	lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
	return lines;
}

function isEditableConfig(value: unknown): value is EditableHandoverConfig {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSessionConfig(entries: EntryLike[] | undefined): EditableHandoverConfig {
	const data = entries?.filter((entry) => entry.type === "custom" && entry.customType === HANDOVER_SESSION_CONFIG_ENTRY).at(-1)?.data;
	return isEditableConfig(data) ? data : {};
}

function buildModels(data: SettingsData): Record<EditableSettingsScope, SettingsViewModel> {
	return {
		global: buildSettingsViewModel({
			target: "global",
			globalConfig: data.globalConfig,
			projectConfig: data.projectConfig,
			sessionConfig: data.sessionConfig,
			projectRules: data.projectRules,
		}),
		project: buildSettingsViewModel({
			target: "project",
			globalConfig: data.globalConfig,
			projectConfig: data.projectConfig,
			sessionConfig: data.sessionConfig,
			projectRules: data.projectRules,
		}),
	};
}

function getMutableConfig(data: SettingsData, scope: EditableSettingsScope): EditableHandoverConfig {
	return scope === "global" ? data.globalConfig : data.projectConfig;
}

function isJsonScalarItem(item: SettingsItem): item is SettingsItem & { key: keyof HandoverConfig } {
	return item.kind === "boolean" || item.kind === "string" || item.kind === "multiline";
}

function isStructuredListItem(item: SettingsItem): item is SettingsItem & { key: StructuredListKey } {
	return item.kind === "list" && (item.key === "completionSteps" || item.key === "promptContextFields");
}

function isHandoverStepArray(value: unknown): value is HandoverStep[] {
	return Array.isArray(value);
}

function isPromptFieldArray(value: unknown): value is HandoverPromptField[] {
	return Array.isArray(value);
}

function displayValue(item: SettingsItem): string {
	const badges = [
		item.configured ? "set" : item.source,
		...item.overriddenBy.map((source) => `overridden by ${source}`),
	];
	return `${item.summary}  [${badges.join(", ")}]`;
}

async function loadSettingsData(ctx: CommandContext): Promise<SettingsData | undefined> {
	const [globalResult, projectResult] = await Promise.all([
		loadEditableSettingsConfig("global", ctx.cwd),
		loadEditableSettingsConfig("project", ctx.cwd),
	]);
	if (!globalResult.ok) {
		ctx.ui.notify(`Cannot open settings: ${globalResult.error.path} contains invalid JSON (${globalResult.error.message})`, "error");
		return undefined;
	}
	if (!projectResult.ok) {
		ctx.ui.notify(`Cannot open settings: ${projectResult.error.path} contains invalid JSON (${projectResult.error.message})`, "error");
		return undefined;
	}
	return {
		globalConfig: globalResult.config,
		projectConfig: projectResult.config,
		projectRules: projectResult.projectRules,
		sessionConfig: getSessionConfig(ctx.sessionManager.getEntries()),
	};
}

async function saveScopeConfig(scope: EditableSettingsScope, cwd: string, config: EditableHandoverConfig): Promise<CommitScalarSettingEditResult> {
	const paths = getEditableSettingsTargetPaths(scope, cwd);
	const result = await saveEditableSettingsTarget({ ...paths, config });
	return result.ok ? { ok: true } : { ok: false, message: `${result.error.path} contains invalid JSON (${result.error.message})` };
}

async function saveProjectRules(ctx: CommandContext, data: SettingsData, rules: string): Promise<CommitProjectRulesEditResult> {
	const paths = getEditableSettingsTargetPaths("project", ctx.cwd);
	const result = await saveEditableSettingsTarget({ ...paths, config: data.projectConfig, projectRules: rules });
	if (!result.ok) return { ok: false, message: `${result.error.path} contains invalid JSON (${result.error.message})` };
	data.projectRules = rules;
	return { ok: true };
}

async function saveStructuredList(
	ctx: CommandContext,
	data: SettingsData,
	scope: EditableSettingsScope,
	key: StructuredListKey,
	items: StructuredListItem[],
): Promise<boolean> {
	const result = await commitStructuredListEdit({
		scope,
		config: getMutableConfig(data, scope),
		key,
		items,
		save: (targetScope, targetConfig) => saveScopeConfig(targetScope, ctx.cwd, targetConfig),
	});
	if (!result.ok) {
		ctx.ui.notify(`Settings not saved: ${result.message}`, "error");
		return false;
	}
	ctx.ui.notify(`Saved ${scope} structured list.`, "info");
	return true;
}

async function editProjectRules(ctx: CommandContext, data: SettingsData, item: SettingsItem): Promise<boolean> {
	const rules = await ctx.ui.editor(item.label, typeof item.value === "string" ? item.value : "");
	if (rules === undefined) return false;
	const result = await commitProjectRulesEdit({ rules, save: (nextRules) => saveProjectRules(ctx, data, nextRules) });
	if (!result.ok) {
		ctx.ui.notify(`Project rules not saved: ${result.message}`, "error");
		return false;
	}
	ctx.ui.notify("Saved project handover rules.", "info");
	return true;
}

async function editScalarItem(ctx: CommandContext, data: SettingsData, scope: EditableSettingsScope, item: SettingsItem): Promise<boolean> {
	if (!isJsonScalarItem(item)) return false;

	const config = getMutableConfig(data, scope);
	let value: string | boolean | undefined;
	if (item.kind === "boolean") {
		value = !Boolean(item.value);
	} else if (item.kind === "multiline") {
		value = await ctx.ui.editor(item.label, typeof item.value === "string" ? item.value : "");
	} else {
		value = await ctx.ui.input(item.label, typeof item.value === "string" ? item.value : "");
	}
	if (value === undefined) return false;

	const result = await commitScalarSettingEdit({
		scope,
		config,
		key: item.key,
		value,
		save: (targetScope, targetConfig) => saveScopeConfig(targetScope, ctx.cwd, targetConfig),
	});
	if (!result.ok) {
		ctx.ui.notify(`Settings not saved: ${result.message}`, "error");
		return false;
	}
	ctx.ui.notify(`Saved ${scope} setting: ${item.label}`, "info");
	return true;
}

async function promptBoolean(ctx: CommandContext, label: string, current: boolean): Promise<boolean | undefined> {
	const answer = await ctx.ui.input(`${label} (yes/no)`, current ? "yes" : "no");
	if (answer === undefined) return undefined;
	const normalized = answer.trim().toLowerCase();
	if (["y", "yes", "true", "1", "on"].includes(normalized)) return true;
	if (["n", "no", "false", "0", "off"].includes(normalized)) return false;
	ctx.ui.notify(`${label} must be yes or no.`, "error");
	return undefined;
}

async function buildCompletionStepForm(ctx: CommandContext, existing?: HandoverStep): Promise<HandoverStep | undefined> {
	const name = await ctx.ui.input("Step name", existing?.name ?? "");
	if (name === undefined) return undefined;
	if (!name.trim()) {
		ctx.ui.notify("Step name cannot be empty.", "error");
		return undefined;
	}
	const description = await ctx.ui.editor("Step description", existing?.description ?? "");
	if (description === undefined) return undefined;
	return { name: name.trim(), description };
}

async function buildPromptContextFieldForm(ctx: CommandContext, existing?: HandoverPromptField): Promise<HandoverPromptField | undefined> {
	const name = await ctx.ui.input("Field name", existing?.name ?? "");
	if (name === undefined) return undefined;
	if (!name.trim()) {
		ctx.ui.notify("Field name cannot be empty.", "error");
		return undefined;
	}
	if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name.trim())) {
		ctx.ui.notify("Field names are safest with letters, numbers, underscores, and dashes.", "info");
	}
	const label = await ctx.ui.input("Field label", existing?.label ?? name.trim());
	if (label === undefined) return undefined;
	const prompt = await ctx.ui.editor("Field prompt", existing?.prompt ?? (label || name.trim()));
	if (prompt === undefined) return undefined;
	const multiline = await promptBoolean(ctx, "Multiline field", existing?.multiline ?? false);
	if (multiline === undefined) return undefined;
	const required = await promptBoolean(ctx, "Required field", existing?.required ?? true);
	if (required === undefined) return undefined;
	const defaultValue = await ctx.ui.input("Default value (empty for none)", existing?.default ?? "");
	if (defaultValue === undefined) return undefined;
	const field: HandoverPromptField = {
		name: name.trim(),
		label: label.trim() || name.trim(),
		prompt: prompt.trim() || label.trim() || name.trim(),
		multiline,
		required,
	};
	if (defaultValue.trim()) field.default = defaultValue.trim();
	return field;
}

async function buildStructuredListItemForm(
	ctx: CommandContext,
	key: StructuredListKey,
	existing?: StructuredListItem,
): Promise<StructuredListItem | undefined> {
	return key === "completionSteps"
		? buildCompletionStepForm(ctx, existing as HandoverStep | undefined)
		: buildPromptContextFieldForm(ctx, existing as HandoverPromptField | undefined);
}

function summarizeStructuredListItem(key: StructuredListKey, item: StructuredListItem): string {
	if (key === "completionSteps") return `${item.name}: ${(item as HandoverStep).description || "No description"}`;
	const field = item as HandoverPromptField;
	const flags = [field.multiline ? "multiline" : "single-line", field.required ? "required" : "optional"];
	return `${field.name}: ${field.label} (${flags.join(", ")})`;
}

function renderStructuredListEditor(
	width: number,
	theme: CustomTheme,
	label: string,
	key: StructuredListKey,
	items: StructuredListItem[],
	selectedIndex: number,
): string[] {
	const bodyWidth = Math.max(20, width - 4);
	const lines = [theme.fg("accent", theme.bold(label)), ""];
	if (items.length === 0) lines.push("  No items configured.");
	items.forEach((item, index) => {
		const prefix = index === selectedIndex ? "> " : "  ";
		lines.push(truncate(`${prefix}${summarizeStructuredListItem(key, item)}`, bodyWidth));
	});
	lines.push("", "a add • e/Enter edit • d delete • +/- reorder • ↑↓ select • Esc back");
	return renderBox(theme, width, label, lines.map((line) => truncate(line, bodyWidth)));
}

async function openStructuredListEditor(
	ctx: CommandContext,
	data: SettingsData,
	scope: EditableSettingsScope,
	item: SettingsItem & { key: StructuredListKey },
): Promise<void> {
	const initialItems = item.key === "completionSteps" && isHandoverStepArray(item.value)
		? item.value
		: item.key === "promptContextFields" && isPromptFieldArray(item.value)
			? item.value
			: [];

	await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
		let items: StructuredListItem[] = initialItems.map((entry) => ({ ...entry }));
		let selectedIndex = 0;
		const clampSelection = () => {
			selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1)));
		};
		const saveItems = async (nextItems: StructuredListItem[]) => {
			if (!(await saveStructuredList(ctx, data, scope, item.key, nextItems))) return;
			items = nextItems.map((entry) => ({ ...entry }));
			clampSelection();
			tui.requestRender();
		};
		const editItem = async (index?: number) => {
			const existing = index === undefined ? undefined : items[index];
			const nextItem = await buildStructuredListItemForm(ctx, item.key, existing);
			if (!nextItem) return;
			const nextItems = applyStructuredListEdit(item.key, items, index === undefined ? { type: "add", item: nextItem } : { type: "edit", index, item: nextItem });
			await saveItems(nextItems);
		};
		return {
			focused: true,
			render(width: number) {
				return renderStructuredListEditor(width, theme, item.label, item.key, items, selectedIndex);
			},
			handleInput(dataKey: string) {
				if (keyMatches(keybindings, dataKey, "tui.select.cancel")) {
					done();
					return;
				}
				if (keyMatches(keybindings, dataKey, "tui.select.up") || keyMatches(keybindings, dataKey, "tui.select.down")) {
					selectedIndex += keyMatches(keybindings, dataKey, "tui.select.up") ? -1 : 1;
					clampSelection();
					tui.requestRender();
					return;
				}
				if (dataKey === "a") {
					void editItem();
					return;
				}
				if (dataKey === "e" || keyMatches(keybindings, dataKey, "tui.select.confirm") || KEY.enter.has(dataKey)) {
					if (items[selectedIndex]) void editItem(selectedIndex);
					return;
				}
				if (dataKey === "d") {
					void saveItems(applyStructuredListEdit(item.key, items, { type: "delete", index: selectedIndex }));
					return;
				}
				if (dataKey === "+" || dataKey === "=") {
					void saveItems(applyStructuredListEdit(item.key, items, { type: "move", index: selectedIndex, delta: 1 }));
					return;
				}
				if (dataKey === "-") {
					void saveItems(applyStructuredListEdit(item.key, items, { type: "move", index: selectedIndex, delta: -1 }));
					return;
				}
				tui.requestRender();
			},
			invalidate() {},
		};
	}, { overlay: true, overlayOptions: { width: "70%", maxHeight: "80%", minWidth: 60 } });
}

function renderSettings(
	width: number,
	theme: CustomTheme,
	state: SettingsUiState,
	models: Record<EditableSettingsScope, SettingsViewModel>,
	mode: SettingsOverlayMode,
): string[] {
	const bodyWidth = Math.max(20, width - 4);
	if (mode.kind === "edit-text") return renderTextEditor(width, theme, mode);

	const model = models[state.activeTab];
	const selectedIndex = state.selectedIndex[state.activeTab];
	const tab = (scope: EditableSettingsScope, label: string) => state.activeTab === scope ? theme.bg("selectedBg", ` ${label} `) : ` ${label} `;
	const lines = [`${tab("global", "Global")} ${tab("project", "Project")}`, ""];

	model.items.forEach((item, index) => {
		const selected = index === selectedIndex;
		const prefix = selected ? theme.fg("accent", "> ") : "  ";
		lines.push(truncate(`${prefix}${item.label}: ${displayValue(item)}`, bodyWidth));
	});

	const selected = model.items[selectedIndex];
	if (selected) {
		lines.push("", theme.fg("muted", truncate(selected.help, bodyWidth)));
	}
	lines.push("", theme.fg("dim", "Tab/←→ tabs • ↑↓ select • Enter edit/toggle/list • Esc close"));
	return renderBox(theme, width, "Handover settings", lines.map((line) => truncate(line, bodyWidth)));
}

function renderTextEditor(width: number, theme: CustomTheme, mode: Extract<SettingsOverlayMode, { kind: "edit-text" }>): string[] {
	const bodyWidth = Math.max(20, width - 4);
	const valueLines = mode.multiline ? mode.draft.split("\n") : [mode.draft];
	const preview = valueLines.length ? valueLines : [""];
	const body = [theme.fg("accent", mode.item.label), ""];
	const visibleLines = mode.multiline ? preview.slice(-10) : preview;
	for (const line of visibleLines) body.push(`  ${line || theme.fg("dim", "<empty>")}`);
	if (preview.length > visibleLines.length) body.splice(2, 0, theme.fg("dim", `  … ${preview.length - visibleLines.length} earlier lines`));
	if (mode.message) body.push("", theme.fg("warning", mode.message));
	body.push("", theme.fg("dim", mode.multiline ? "Type to edit • Shift+Enter newline • Enter save • Esc cancel" : "Type to edit • Enter save • Esc cancel"));
	return renderBox(theme, width, "Edit setting", body.map((line) => truncate(line, bodyWidth)));
}

function isPrintableInput(data: string): boolean {
	return data.length === 1 && data >= " " && data !== "\u007f";
}

function removeLastCharacter(value: string): string {
	return Array.from(value).slice(0, -1).join("");
}

function keyMatches(keybindings: CustomKeybindings, data: string, id: string): boolean {
	return keybindings.matches(data, id as never);
}

export async function openHandoverSettingsShell(ctx: CommandContext): Promise<void> {
	if (typeof ctx.ui.custom !== "function") {
		ctx.ui.notify("Settings UI is unavailable in this context. Run /handover settings from an interactive pi session.", "error");
		return;
	}

	const data = await loadSettingsData(ctx);
	if (!data) return;

	await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
		let state = createSettingsUiState();
		let models = buildModels(data);
		let mode: SettingsOverlayMode = { kind: "browse" };
		const refresh = () => {
			models = buildModels(data);
			tui.requestRender();
		};
		const counts = () => ({ global: models.global.items.length, project: models.project.items.length });
		const startTextEdit = (scope: EditableSettingsScope, item: SettingsItem) => {
			mode = {
				kind: "edit-text",
				scope,
				item,
				draft: typeof item.value === "string" ? item.value : "",
				multiline: item.kind === "multiline" || item.kind === "markdown",
			};
			if (item.key !== "projectRules") state = reduceSettingsUiState(state, { type: "start-edit", key: item.key as keyof HandoverConfig }, counts());
			tui.requestRender();
		};
		const saveTextEdit = async (editMode: Extract<SettingsOverlayMode, { kind: "edit-text" }>) => {
			const result = editMode.item.key === "projectRules"
				? await commitProjectRulesEdit({ rules: editMode.draft, save: (nextRules) => saveProjectRules(ctx, data, nextRules) })
				: await commitScalarSettingEdit({
					scope: editMode.scope,
					config: getMutableConfig(data, editMode.scope),
					key: editMode.item.key as keyof HandoverConfig,
					value: editMode.draft,
					save: (targetScope, targetConfig) => saveScopeConfig(targetScope, ctx.cwd, targetConfig),
				});
			if (!result.ok) {
				mode = { ...editMode, message: result.message };
				tui.requestRender();
				return;
			}
			ctx.ui.notify(editMode.item.key === "projectRules" ? "Saved project handover rules." : `Saved ${editMode.scope} setting: ${editMode.item.label}`, "info");
			mode = { kind: "browse" };
			state = reduceSettingsUiState(state, { type: "finish-edit" }, counts());
			refresh();
		};

		return {
			focused: true,
			render(width: number) {
				return renderSettings(width, theme, state, models, mode);
			},
			handleInput(dataKey: string) {
				if (mode.kind === "edit-text") {
					if (keyMatches(keybindings, dataKey, "tui.select.cancel")) {
						mode = { kind: "browse" };
						state = reduceSettingsUiState(state, { type: "finish-edit" }, counts());
						tui.requestRender();
						return;
					}
					if (mode.multiline && keyMatches(keybindings, dataKey, "tui.input.newLine")) {
						mode = { ...mode, draft: `${mode.draft}\n`, message: undefined };
						tui.requestRender();
						return;
					}
					if (keyMatches(keybindings, dataKey, "tui.input.submit") || KEY.enter.has(dataKey)) {
						void saveTextEdit(mode);
						return;
					}
					if (keyMatches(keybindings, dataKey, "tui.editor.deleteCharBackward") || dataKey === "\u007f") {
						mode = { ...mode, draft: removeLastCharacter(mode.draft), message: undefined };
						tui.requestRender();
						return;
					}
					if (isPrintableInput(dataKey)) {
						mode = { ...mode, draft: `${mode.draft}${dataKey}`, message: undefined };
						tui.requestRender();
					}
					return;
				}

				if (keyMatches(keybindings, dataKey, "tui.select.cancel")) {
					done();
					return;
				}
				if (keyMatches(keybindings, dataKey, "tui.input.tab") || keyMatches(keybindings, dataKey, "tui.editor.cursorRight")) {
					state = reduceSettingsUiState(state, { type: "change-tab", delta: 1 }, counts());
					refresh();
					return;
				}
				if (dataKey === KEY.shiftTab || keyMatches(keybindings, dataKey, "tui.editor.cursorLeft")) {
					state = reduceSettingsUiState(state, { type: "change-tab", delta: -1 }, counts());
					refresh();
					return;
				}
				if (keyMatches(keybindings, dataKey, "tui.select.up") || keyMatches(keybindings, dataKey, "tui.select.down")) {
					state = reduceSettingsUiState(state, { type: "move-selection", delta: keyMatches(keybindings, dataKey, "tui.select.up") ? -1 : 1 }, counts());
					refresh();
					return;
				}
				if (keyMatches(keybindings, dataKey, "tui.select.confirm") || KEY.enter.has(dataKey)) {
					const scope = state.activeTab;
					const item = models[scope].items[state.selectedIndex[scope]];
					if (!item) return;
					if (item.kind === "boolean") {
						void editScalarItem(ctx, data, scope, item).then(refresh);
						return;
					}
					if (item.kind === "string" || item.kind === "multiline" || (item.kind === "markdown" && item.key === "projectRules" && scope === "project")) {
						startTextEdit(scope, item);
						return;
					}
					if (isStructuredListItem(item)) {
						void openStructuredListEditor(ctx, data, scope, item).then(refresh);
					}
					return;
				}
				tui.requestRender();
			},
			invalidate() {},
		};
	}, { overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "85%", minWidth: 72, margin: 1 } });
}
