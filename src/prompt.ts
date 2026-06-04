import type { HandoverConfig } from "./config.js";

export function buildAgentHandoverRequest(description: string, config: HandoverConfig): string {
	const steps = config.completionSteps
		.map((step, index) => `${index + 1}. ${step.name}: ${step.description}`)
		.join("\n");
	const projectRules = config.projectRules?.trim()
		? `\n\n## Project-defined handover rules\n\n${config.projectRules.trim()}`
		: "";

	return `Please write a prompt for a new agent session to continue ${description} and take over from here.

Before writing that prompt, close your current turn according to these rules:

${steps}

## Handover instructions

${config.agentInstructions}

## New-session prompt instructions

${config.nextPromptInstructions}

When the current turn is closed, call the handover_complete tool with:
- nextPrompt: the exact prompt to send as the first user message in the new pi session
- summary: a concise completion summary for this turn
- completedSteps: the closure steps you completed or explicitly marked blocked${projectRules}`;
}
