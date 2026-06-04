import type { HandoverConfig } from "./config.js";

export type HandoverPromptContext = Record<string, string>;

export function buildAgentHandoverRequest(description: string, config: HandoverConfig, context: HandoverPromptContext = {}): string {
	const steps = config.completionSteps
		.map((step, index) => `${index + 1}. ${step.name}: ${step.description}`)
		.join("\n");
	const projectRules = config.projectRules?.trim()
		? `\n\n## Project-defined handover rules\n\n${config.projectRules.trim()}`
		: "";
	const contextBlock = Object.entries(context).length > 0
		? `\n\n## Handover context\n\n${Object.entries(context)
			.map(([name, value]) => `- ${name}: ${value}`)
			.join("\n")}`
		: "";

	return `Please write a prompt for a new agent session to continue ${description} and take over from here.${contextBlock}

Before writing that prompt, close your current turn according to these rules:

${steps}

## Handover instructions

${config.agentInstructions}

## New-session prompt instructions

${config.nextPromptInstructions}

When the current turn is closed, call the handover_complete tool with:
- nextPrompt: the exact prompt to send as the first user message in the new pi session
- summary: a concise completion summary for this turn
- completedSteps: structured closure checklist items; each item needs id or name, status (done, blocked, or skipped), notes, and optional evidence. Blocked items must explain the blocker in notes.${projectRules}`;
}
