import type { HandoverConfig, HandoverPromptField, HandoverStep } from "./config.js";
import type { EditableHandoverConfig, EditableSettingsScope } from "./settings-config.js";

export type SettingsUiTab = EditableSettingsScope;

export type SettingsUiState = {
	activeTab: SettingsUiTab;
	selectedIndex: Record<SettingsUiTab, number>;
	editing?: { scope: SettingsUiTab; key: keyof HandoverConfig };
};

export type SettingsUiAction =
	| { type: "change-tab"; delta: number }
	| { type: "move-selection"; delta: number }
	| { type: "start-edit"; key: keyof HandoverConfig }
	| { type: "finish-edit" };

export type SettingsItemCounts = Record<SettingsUiTab, number>;

export type CommitScalarSettingEditResult = { ok: true } | { ok: false; message: string };
export type CommitStructuredListEditResult = { ok: true } | { ok: false; message: string };
export type CommitProjectRulesEditResult = { ok: true } | { ok: false; message: string };

export type StructuredListKey = "completionSteps" | "promptContextFields";
export type StructuredListItem = HandoverStep | HandoverPromptField;

export type StructuredListEditAction =
	| { type: "add"; item: StructuredListItem }
	| { type: "edit"; index: number; item: StructuredListItem }
	| { type: "delete"; index: number }
	| { type: "move"; index: number; delta: number };

export type CommitScalarSettingEditOptions = {
	scope: EditableSettingsScope;
	config: EditableHandoverConfig;
	key: keyof HandoverConfig;
	value: string | boolean;
	save: (scope: EditableSettingsScope, config: EditableHandoverConfig) => Promise<CommitScalarSettingEditResult>;
};

export type CommitStructuredListEditOptions = {
	scope: EditableSettingsScope;
	config: EditableHandoverConfig;
	key: StructuredListKey;
	items: StructuredListItem[];
	save: (scope: EditableSettingsScope, config: EditableHandoverConfig) => Promise<CommitStructuredListEditResult>;
};

export type CommitProjectRulesEditOptions = {
	rules: string;
	save: (rules: string) => Promise<CommitProjectRulesEditResult>;
};

const TABS: SettingsUiTab[] = ["global", "project"];

function clampIndex(index: number, count: number): number {
	if (count <= 0) return 0;
	return Math.max(0, Math.min(index, count - 1));
}

export function createSettingsUiState(): SettingsUiState {
	return { activeTab: "global", selectedIndex: { global: 0, project: 0 } };
}

export function reduceSettingsUiState(
	state: SettingsUiState,
	action: SettingsUiAction,
	counts: SettingsItemCounts,
): SettingsUiState {
	if (action.type === "change-tab") {
		const currentIndex = TABS.indexOf(state.activeTab);
		const activeTab = TABS[(currentIndex + action.delta + TABS.length) % TABS.length] ?? "global";
		return {
			...state,
			activeTab,
			selectedIndex: { ...state.selectedIndex, [activeTab]: clampIndex(state.selectedIndex[activeTab], counts[activeTab]) },
		};
	}

	if (action.type === "move-selection") {
		const activeTab = state.activeTab;
		return {
			...state,
			selectedIndex: {
				...state.selectedIndex,
				[activeTab]: clampIndex(state.selectedIndex[activeTab] + action.delta, counts[activeTab]),
			},
		};
	}

	if (action.type === "start-edit") {
		return { ...state, editing: { scope: state.activeTab, key: action.key } };
	}

	return { ...state, editing: undefined };
}

export async function commitScalarSettingEdit(options: CommitScalarSettingEditOptions): Promise<CommitScalarSettingEditResult> {
	const nextConfig = { ...options.config, [options.key]: options.value };
	const result = await options.save(options.scope, nextConfig);
	if (result.ok) Object.assign(options.config, nextConfig);
	return result;
}

function normalizeItemName(item: StructuredListItem): string {
	return typeof item.name === "string" ? item.name.trim() : "";
}

export function validateStructuredListItems(
	key: StructuredListKey,
	items: StructuredListItem[],
): CommitStructuredListEditResult {
	for (const [index, item] of items.entries()) {
		if (normalizeItemName(item)) continue;
		const label = key === "completionSteps" ? "Completion step" : "Prompt context field";
		return { ok: false, message: `${label} ${index + 1} needs a non-empty name.` };
	}
	return { ok: true };
}

export function applyStructuredListEdit(
	_key: StructuredListKey,
	items: StructuredListItem[],
	action: StructuredListEditAction,
): StructuredListItem[] {
	const nextItems = items.map((item) => ({ ...item }));
	if (action.type === "add") return [...nextItems, { ...action.item }];
	if (action.type === "edit") {
		if (action.index < 0 || action.index >= nextItems.length) return nextItems;
		nextItems[action.index] = { ...action.item };
		return nextItems;
	}
	if (action.type === "delete") return nextItems.filter((_, index) => index !== action.index);

	const from = action.index;
	const to = from + action.delta;
	if (from < 0 || from >= nextItems.length || to < 0 || to >= nextItems.length) return nextItems;
	const [item] = nextItems.splice(from, 1);
	if (item) nextItems.splice(to, 0, item);
	return nextItems;
}

export async function commitStructuredListEdit(
	options: CommitStructuredListEditOptions,
): Promise<CommitStructuredListEditResult> {
	const validation = validateStructuredListItems(options.key, options.items);
	if (!validation.ok) return validation;
	const nextConfig = { ...options.config, [options.key]: options.items };
	const result = await options.save(options.scope, nextConfig);
	if (result.ok) Object.assign(options.config, nextConfig);
	return result;
}

export async function commitProjectRulesEdit(options: CommitProjectRulesEditOptions): Promise<CommitProjectRulesEditResult> {
	return options.save(options.rules);
}
