import { defaultConfig, mergeConfig, type HandoverConfig, type HandoverPromptField, type HandoverStep } from "./config.js";
import type { EditableHandoverConfig, EditableSettingsScope } from "./settings-config.js";

export type SettingsItemKind = "boolean" | "string" | "multiline" | "list" | "markdown";
export type OverrideSource = "project" | "session";

export type SettingsItem = {
	key: keyof HandoverConfig | "projectRules";
	label: string;
	help: string;
	kind: SettingsItemKind;
	value: unknown;
	effectiveValue: unknown;
	configured: boolean;
	source: "configured" | "inherited" | "default";
	overriddenBy: OverrideSource[];
	summary: string;
};

export type SettingsViewModel = {
	target: EditableSettingsScope;
	items: SettingsItem[];
};

export type BuildSettingsViewModelOptions = {
	target: EditableSettingsScope;
	globalConfig?: EditableHandoverConfig;
	projectConfig?: EditableHandoverConfig;
	sessionConfig?: EditableHandoverConfig;
	projectRules?: string;
};

type JsonSettingDefinition = {
	key: keyof HandoverConfig;
	label: string;
	help: string;
	kind: SettingsItemKind;
};

const JSON_SETTINGS: JsonSettingDefinition[] = [
	{ key: "taskInputPrompt", label: "Task input prompt", help: "Prompt shown when /handover needs a task description.", kind: "string" },
	{ key: "taskInputMultiline", label: "Multiline task input", help: "Use a multiline editor for the handover task description.", kind: "boolean" },
	{ key: "taskInputRequired", label: "Require task input", help: "Require a task description when /handover is called without arguments.", kind: "boolean" },
	{ key: "reviewPromptBeforeStart", label: "Review prompt before start", help: "Review manual handover prompts before opening the replacement session.", kind: "boolean" },
	{ key: "autoReviewPromptBeforeStart", label: "Review auto prompts before start", help: "Review automatic handover prompts before opening the replacement session.", kind: "boolean" },
	{ key: "agentInstructions", label: "Agent instructions", help: "Instructions the current agent follows before completing handover.", kind: "multiline" },
	{ key: "nextPromptInstructions", label: "Next prompt instructions", help: "Instructions for writing the first prompt in the replacement session.", kind: "multiline" },
	{ key: "promptContextFields", label: "Prompt context fields", help: "Additional fields collected before building the handover request.", kind: "list" },
	{ key: "completionSteps", label: "Completion steps", help: "Checklist steps the agent must complete or explicitly block before handover.", kind: "list" },
];

function hasOwnConfigValue(config: EditableHandoverConfig | undefined, key: keyof HandoverConfig): boolean {
	return config !== undefined && Object.prototype.hasOwnProperty.call(config, key);
}

function getConfigValue(config: EditableHandoverConfig | undefined, key: keyof HandoverConfig): unknown {
	return config?.[key];
}

function summarizeSteps(value: HandoverStep[]): string {
	if (value.length === 0) return "No steps";
	return `${value.length} ${value.length === 1 ? "step" : "steps"}: ${value.map((step) => step.name).join(", ")}`;
}

function summarizeFields(value: HandoverPromptField[]): string {
	if (value.length === 0) return "No fields";
	return `${value.length} ${value.length === 1 ? "field" : "fields"}: ${value.map((field) => field.name).join(", ")}`;
}

function summarize(key: keyof HandoverConfig | "projectRules", value: unknown): string {
	if (key === "completionSteps" && Array.isArray(value)) return summarizeSteps(value as HandoverStep[]);
	if (key === "promptContextFields" && Array.isArray(value)) return summarizeFields(value as HandoverPromptField[]);
	if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
	if (typeof value === "string") return value || "Empty";
	if (value === undefined) return "Not set";
	return String(value);
}

function buildJsonItem(definition: JsonSettingDefinition, options: BuildSettingsViewModelOptions, effective: HandoverConfig): SettingsItem {
	const globalConfig = options.globalConfig ?? {};
	const projectConfig = options.projectConfig ?? {};
	const sessionConfig = options.sessionConfig ?? {};
	const targetConfig = options.target === "global" ? globalConfig : projectConfig;
	const configured = hasOwnConfigValue(targetConfig, definition.key);
	const inheritedConfig = options.target === "project" && hasOwnConfigValue(globalConfig, definition.key);
	const inheritedValue = mergeConfig(defaultConfig, globalConfig)[definition.key];
	const value = configured ? getConfigValue(targetConfig, definition.key) : inheritedValue;
	const overriddenBy: OverrideSource[] = [];
	if (options.target === "global" && hasOwnConfigValue(projectConfig, definition.key)) overriddenBy.push("project");
	if (hasOwnConfigValue(sessionConfig, definition.key)) overriddenBy.push("session");

	return {
		...definition,
		value,
		effectiveValue: effective[definition.key],
		configured,
		source: configured ? "configured" : inheritedConfig ? "inherited" : "default",
		overriddenBy,
		summary: summarize(definition.key, value),
	};
}

function buildProjectRulesItem(projectRules: string | undefined): SettingsItem {
	return {
		key: "projectRules",
		label: "Project handover rules",
		help: "Markdown rules loaded from .pi/handover.md.",
		kind: "markdown",
		value: projectRules,
		effectiveValue: projectRules,
		configured: projectRules !== undefined,
		source: projectRules !== undefined ? "configured" : "default",
		overriddenBy: [],
		summary: projectRules?.trim() ? `${projectRules.trim().split(/\s+/).length} words` : "No project rules",
	};
}

export function buildSettingsViewModel(options: BuildSettingsViewModelOptions): SettingsViewModel {
	const globalConfig = options.globalConfig ?? {};
	const projectConfig = options.projectConfig ?? {};
	const sessionConfig = options.sessionConfig ?? {};
	const effective = mergeConfig(mergeConfig(mergeConfig(defaultConfig, globalConfig), projectConfig), sessionConfig);

	const items = JSON_SETTINGS.map((definition) => buildJsonItem(definition, options, effective));
	if (options.target === "project") items.push(buildProjectRulesItem(options.projectRules));

	return { target: options.target, items };
}
