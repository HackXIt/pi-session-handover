import type { HandoverConfig } from "./config.js";
import type { AutoHandoverState } from "./domain.js";

export type HandoverPromptContext = Record<string, string>;

export const AUTO_CONTINUATION_MARKER = "## Automatic handover continuation";

export function ensureAutoContinuationInstructions(nextPrompt: string, auto: AutoHandoverState): string {
	if (!auto.armed || nextPrompt.includes(AUTO_CONTINUATION_MARKER)) return nextPrompt;

	const separator = nextPrompt.endsWith("\n") ? "\n" : "\n\n";
	if (auto.depth >= auto.maxDepth) {
		return `${nextPrompt}${separator}${AUTO_CONTINUATION_MARKER}\n\nThe previous \`/handover auto\` chain ${auto.chainId} has reached its max depth (${auto.depth}/${auto.maxDepth}). Do not continue the automatic chain unless the user explicitly rearms \`/handover auto\`.`;
	}

	const nextDepth = auto.depth + 1;
	return `${nextPrompt}${separator}${AUTO_CONTINUATION_MARKER}\n\nThis session is part of \`/handover auto\` chain ${auto.chainId}. Auto depth after this handover is ${nextDepth}/${auto.maxDepth}.\n\nBefore ending this turn, call \`handover_complete\` as your final tool call if there is any remaining work for the chain. The next prompt you provide must be self-contained for a fresh pi session: include current state, changed files, validation, blockers, exact next slice, and this automatic handover continuation instruction. Stop instead of continuing if the work is complete, blocked, or the max depth has been reached.`;
}

export function buildAgentHandoverRequest(description: string, config: HandoverConfig, context: HandoverPromptContext = {}, auto?: AutoHandoverState): string {
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
	const autoBlock = auto?.armed
		? `\n\n## Automatic handover mode\n\nThis session is armed for automatic handover chain ${auto.chainId} at depth ${auto.depth}/${auto.maxDepth}. If there is another slice remaining after this turn, prepare the next handover prompt so the chain can continue. Do not exceed the max depth.`
		: "";

	return `Please write a prompt for a new agent session to continue ${description} and take over from here.${contextBlock}${autoBlock}

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
