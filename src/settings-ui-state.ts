import type { HandoverConfig } from "./config.js";
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

export type CommitScalarSettingEditOptions = {
	scope: EditableSettingsScope;
	config: EditableHandoverConfig;
	key: keyof HandoverConfig;
	value: string | boolean;
	save: (scope: EditableSettingsScope, config: EditableHandoverConfig) => Promise<CommitScalarSettingEditResult>;
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
