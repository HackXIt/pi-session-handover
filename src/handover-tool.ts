import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { loadHandoverConfig } from "./config.js";
import { HANDOVER_PENDING_ENTRY, normalizeChecklist, shouldReviewHandover, type PendingHandover } from "./domain.js";
import type { HandoverRuntimeState } from "./pending-store.js";

const checklistItemSchema = Type.Union([
	Type.String(),
	Type.Object({
		id: Type.Optional(Type.String({ description: "Stable closure-step id." })),
		name: Type.Optional(Type.String({ description: "Human-readable closure-step name." })),
		status: Type.Union([Type.Literal("done"), Type.Literal("blocked"), Type.Literal("skipped")]),
		notes: Type.Optional(Type.String({ description: "Short closure note. Required when status is blocked." })),
		evidence: Type.Optional(Type.Unknown({ description: "Commands, commits, branches, validation output, or other proof." })),
	}),
]);

const handoverCompleteSchema = Type.Object({
	nextPrompt: Type.String({ description: "The exact first user message for the replacement pi session." }),
	summary: Type.Optional(Type.String({ description: "Concise summary of the completed current turn." })),
	completedSteps: Type.Optional(
		Type.Array(checklistItemSchema, {
			description: "Closure checklist items. Plain strings are accepted as compatibility and treated as done.",
		}),
	),
});

type HandoverCompleteInput = Static<typeof handoverCompleteSchema>;

export function registerHandoverTool(pi: ExtensionAPI, state: HandoverRuntimeState, makeId: () => string): void {
	pi.registerTool({
		name: "handover_complete",
		label: "Handover Complete",
		description:
			"Finish a /handover workflow by providing the prompt that should be sent as the first user message in a fresh pi session.",
		promptSnippet: "Finish a /handover workflow and start a fresh pi session with the next prompt",
		promptGuidelines: [
			"Use handover_complete only after the current turn's configured closure steps are complete or explicitly blocked.",
			"When using handover_complete, provide a self-contained nextPrompt for a fresh agent session.",
			"Provide structured completedSteps with status, notes, and optional evidence. Blocked steps require notes and force user review.",
		],
		parameters: handoverCompleteSchema,
		async execute(_toolCallId, params: HandoverCompleteInput, _signal, _onUpdate, ctx) {
			const config = await loadHandoverConfig(ctx.cwd, { entries: ctx.sessionManager.getEntries() });
			const checklist = normalizeChecklist(params.completedSteps ?? []);
			const id = makeId();
			const auto = state.getAuto(ctx);
			const item: PendingHandover = {
				id,
				nextPrompt: params.nextPrompt,
				summary: params.summary,
				checklist,
				parentSession: ctx.sessionManager.getSessionFile(),
				reviewPromptBeforeStart: auto
					? config.autoReviewPromptBeforeStart
					: shouldReviewHandover(config.reviewPromptBeforeStart, checklist),
				createdAt: new Date().toISOString(),
				...(auto ? { auto } : {}),
			};
			state.rememberPending(item);
			pi.appendEntry(HANDOVER_PENDING_ENTRY, item);

			pi.sendUserMessage(`/handover-continue ${id}`, { deliverAs: "followUp" });

			return {
				content: [
					{
						type: "text",
						text: "Handover prompt accepted. The extension queued creation of a fresh pi session after this turn goes idle.",
					},
				],
				details: { id, checklist, reviewPromptBeforeStart: item.reviewPromptBeforeStart },
				terminate: true,
			};
		},
	});
}
