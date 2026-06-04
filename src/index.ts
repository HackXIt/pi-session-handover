import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { loadHandoverConfig } from "./config.js";
import { buildAgentHandoverRequest } from "./prompt.js";

const handoverCompleteSchema = Type.Object({
	nextPrompt: Type.String({ description: "The exact first user message for the replacement pi session." }),
	summary: Type.Optional(Type.String({ description: "Concise summary of the completed current turn." })),
	completedSteps: Type.Optional(
		Type.Array(Type.String(), {
			description: "Closure steps completed or explicitly marked blocked before handover.",
		}),
	),
});

type HandoverCompleteInput = Static<typeof handoverCompleteSchema>;

type PendingHandover = {
	nextPrompt: string;
	summary?: string;
	completedSteps: string[];
	parentSession?: string;
	reviewPromptBeforeStart: boolean;
};

function makeId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function (pi: ExtensionAPI) {
	const pending = new Map<string, PendingHandover>();

	pi.registerCommand("handover", {
		description: "Close this turn and hand over to a fresh pi session",
		handler: async (args, ctx) => {
			const config = await loadHandoverConfig(ctx.cwd);
			let description = args.trim();

			if (!description && config.taskInputRequired) {
				const input = config.taskInputMultiline
					? await ctx.ui.editor(config.taskInputPrompt, "")
					: await ctx.ui.input(config.taskInputPrompt, "continue the current plan slice");
				if (input === undefined) {
					ctx.ui.notify("Handover cancelled", "info");
					return;
				}
				description = input.trim();
			}

			if (!description) {
				ctx.ui.notify("Usage: /handover <what the next agent should continue>", "error");
				return;
			}

			const request = buildAgentHandoverRequest(description, config);
			pi.sendUserMessage(request, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
		},
	});

	pi.registerCommand("handover-continue", {
		description: "Internal command used by pi-agent-handoff to start the replacement session",
		handler: async (args, ctx) => {
			const id = args.trim();
			const item = pending.get(id);
			if (!item) {
				ctx.ui.notify("No pending handover prompt found", "error");
				return;
			}
			pending.delete(id);

			let nextPrompt = item.nextPrompt;
			if (item.reviewPromptBeforeStart) {
				const edited = await ctx.ui.editor("Review handover prompt for the new session", nextPrompt);
				if (edited === undefined) {
					ctx.ui.notify("Handover cancelled", "info");
					return;
				}
				nextPrompt = edited;
			}

			const result = await ctx.newSession({
				parentSession: item.parentSession,
				withSession: async (replacementCtx) => {
					await replacementCtx.sendUserMessage(nextPrompt);
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
			}
		},
	});

	pi.registerTool({
		name: "handover_complete",
		label: "Handover Complete",
		description:
			"Finish a /handover workflow by providing the prompt that should be sent as the first user message in a fresh pi session.",
		promptSnippet: "Finish a /handover workflow and start a fresh pi session with the next prompt",
		promptGuidelines: [
			"Use handover_complete only after the current turn's configured closure steps are complete or explicitly blocked.",
			"When using handover_complete, provide a self-contained nextPrompt for a fresh agent session.",
		],
		parameters: handoverCompleteSchema,
		async execute(_toolCallId, params: HandoverCompleteInput, _signal, _onUpdate, ctx) {
			const config = await loadHandoverConfig(ctx.cwd);
			const id = makeId();
			pending.set(id, {
				nextPrompt: params.nextPrompt,
				summary: params.summary,
				completedSteps: params.completedSteps ?? [],
				parentSession: ctx.sessionManager.getSessionFile(),
				reviewPromptBeforeStart: config.reviewPromptBeforeStart,
			});

			pi.sendUserMessage(`/handover-continue ${id}`, { deliverAs: "followUp" });

			return {
				content: [
					{
						type: "text",
						text: "Handover prompt accepted. The extension queued creation of a fresh pi session after this turn goes idle.",
					},
				],
				details: { id, completedSteps: params.completedSteps ?? [] },
				terminate: true,
			};
		},
	});
}
