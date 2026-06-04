import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type HandoverStep = {
	name: string;
	description: string;
};

export type HandoverConfig = {
	agentInstructions: string;
	nextPromptInstructions: string;
	taskInputPrompt: string;
	taskInputMultiline: boolean;
	taskInputRequired: boolean;
	reviewPromptBeforeStart: boolean;
	completionSteps: HandoverStep[];
	projectRules?: string;
};

const DEFAULT_STEPS: HandoverStep[] = [
	{ name: "Build", description: "Run the project's configured build, test, or verification command successfully." },
	{ name: "Save work", description: "Create the configured durable changelist or commit for this turn." },
	{ name: "Publish work", description: "Submit the changelist or push the commit when project rules require it." },
	{ name: "Turn summary", description: "Summarize what was completed, what was verified, and what remains for the next agent." },
];

export const defaultConfig: HandoverConfig = {
	agentInstructions:
		"Close the current turn according to the project's completion rules before handing over. Do not call the handover completion tool until the closure work is done or you have clearly documented why a required step is blocked.",
	nextPromptInstructions:
		"Write a self-contained first user prompt for a fresh agent session. Include the goal, relevant plan or issue references, changed files, verification status, remaining risks, and the exact next slice of work. Do not assume the new agent can see this conversation.",
	taskInputPrompt: "What should the next agent continue?",
	taskInputMultiline: false,
	taskInputRequired: true,
	reviewPromptBeforeStart: true,
	completionSteps: DEFAULT_STEPS,
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSteps(value: unknown): HandoverStep[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const steps = value
		.map((item) => {
			if (typeof item === "string") return { name: item, description: item };
			if (!isObject(item) || typeof item.name !== "string") return undefined;
			return { name: item.name, description: typeof item.description === "string" ? item.description : item.name };
		})
		.filter((step): step is HandoverStep => step !== undefined);
	return steps.length > 0 ? steps : undefined;
}

export function mergeConfig(base: HandoverConfig, override: unknown): HandoverConfig {
	if (!isObject(override)) return base;
	return {
		...base,
		agentInstructions: typeof override.agentInstructions === "string" ? override.agentInstructions : base.agentInstructions,
		nextPromptInstructions:
			typeof override.nextPromptInstructions === "string" ? override.nextPromptInstructions : base.nextPromptInstructions,
		taskInputPrompt: typeof override.taskInputPrompt === "string" ? override.taskInputPrompt : base.taskInputPrompt,
		taskInputMultiline:
			typeof override.taskInputMultiline === "boolean" ? override.taskInputMultiline : base.taskInputMultiline,
		taskInputRequired: typeof override.taskInputRequired === "boolean" ? override.taskInputRequired : base.taskInputRequired,
		reviewPromptBeforeStart:
			typeof override.reviewPromptBeforeStart === "boolean"
				? override.reviewPromptBeforeStart
				: base.reviewPromptBeforeStart,
		completionSteps: parseSteps(override.completionSteps) ?? base.completionSteps,
	};
}

export async function loadHandoverConfig(cwd: string): Promise<HandoverConfig> {
	let config = defaultConfig;
	try {
		const json = await readFile(join(cwd, ".pi", "handover.json"), "utf8");
		config = mergeConfig(config, JSON.parse(json));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	try {
		const projectRules = await readFile(join(cwd, ".pi", "handover.md"), "utf8");
		config = { ...config, projectRules };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return config;
}
