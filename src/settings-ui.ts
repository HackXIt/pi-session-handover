import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HANDOVER_SESSION_CONFIG_ENTRY, type HandoverConfig } from "./config.js";
import {
	getEditableSettingsTargetPaths,
	loadEditableSettingsConfig,
	saveEditableSettingsTarget,
	type EditableHandoverConfig,
	type EditableSettingsScope,
} from "./settings-config.js";
import { buildSettingsViewModel, type SettingsItem, type SettingsViewModel } from "./settings-view-model.js";
import {
	commitScalarSettingEdit,
	createSettingsUiState,
	reduceSettingsUiState,
	type CommitScalarSettingEditResult,
	type SettingsUiState,
} from "./settings-ui-state.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

type EntryLike = { type: string; customType?: string; data?: unknown };

type SettingsData = {
	globalConfig: EditableHandoverConfig;
	projectConfig: EditableHandoverConfig;
	sessionConfig: EditableHandoverConfig;
	projectRules?: string;
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

async function editScalarItem(ctx: CommandContext, data: SettingsData, scope: EditableSettingsScope, item: SettingsItem): Promise<boolean> {
	if (!isJsonScalarItem(item)) {
		ctx.ui.notify("Structured settings will be editable in a later settings slice.", "info");
		return false;
	}

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

function renderSettings(width: number, theme: Parameters<Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0]>[1], state: SettingsUiState, models: Record<EditableSettingsScope, SettingsViewModel>): string[] {
	const bodyWidth = Math.max(20, width - 2);
	const model = models[state.activeTab];
	const selectedIndex = state.selectedIndex[state.activeTab];
	const tab = (scope: EditableSettingsScope, label: string) => state.activeTab === scope ? theme.bg("selectedBg", ` ${label} `) : ` ${label} `;
	const lines = [
		theme.fg("accent", theme.bold("Handover settings")),
		`${tab("global", "Global")} ${tab("project", "Project")}`,
		"",
	];

	model.items.forEach((item, index) => {
		const selected = index === selectedIndex;
		const prefix = selected ? "> " : "  ";
		const marker = isJsonScalarItem(item) ? "" : " (later)";
		lines.push(truncate(`${prefix}${item.label}${marker}: ${displayValue(item)}`, bodyWidth));
	});

	const selected = model.items[selectedIndex];
	if (selected) {
		lines.push("", truncate(selected.help, bodyWidth));
	}
	lines.push("", "Tab/←→ tabs • ↑↓ select • Enter edit/toggle • Esc close");
	return lines.map((line) => truncate(line, bodyWidth));
}

export async function openHandoverSettingsShell(ctx: CommandContext): Promise<void> {
	if (typeof ctx.ui.custom !== "function") {
		ctx.ui.notify("Settings UI is unavailable in this context. Run /handover settings from an interactive pi session.", "error");
		return;
	}

	const data = await loadSettingsData(ctx);
	if (!data) return;

	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		let state = createSettingsUiState();
		let models = buildModels(data);
		const refresh = () => {
			models = buildModels(data);
			tui.requestRender();
		};
		const counts = () => ({ global: models.global.items.length, project: models.project.items.length });

		return {
			focused: true,
			render(width: number) {
				return renderSettings(width, theme, state, models);
			},
			handleInput(dataKey: string) {
				if (dataKey === KEY.escape) {
					done();
					return;
				}
				if (dataKey === KEY.tab || dataKey === KEY.right) {
					state = reduceSettingsUiState(state, { type: "change-tab", delta: 1 }, counts());
					refresh();
					return;
				}
				if (dataKey === KEY.shiftTab || dataKey === KEY.left) {
					state = reduceSettingsUiState(state, { type: "change-tab", delta: -1 }, counts());
					refresh();
					return;
				}
				if (dataKey === KEY.up || dataKey === KEY.down) {
					state = reduceSettingsUiState(state, { type: "move-selection", delta: dataKey === KEY.up ? -1 : 1 }, counts());
					refresh();
					return;
				}
				if (KEY.enter.has(dataKey)) {
					const scope = state.activeTab;
					const item = models[scope].items[state.selectedIndex[scope]];
					if (!item) return;
					if (isJsonScalarItem(item)) state = reduceSettingsUiState(state, { type: "start-edit", key: item.key }, counts());
					void editScalarItem(ctx, data, scope, item).then(() => {
						state = reduceSettingsUiState(state, { type: "finish-edit" }, counts());
						refresh();
					});
					return;
				}
				tui.requestRender();
			},
			invalidate() {},
		};
	}, { overlay: true, overlayOptions: { width: "70%", maxHeight: "80%", minWidth: 60 } });
}
