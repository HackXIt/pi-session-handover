import { ExtensionEditorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { loadHandoverConfig } from "./config.js";
import {
	HANDOVER_METADATA_ENTRY,
	HANDOVER_PENDING_ENTRY,
	HANDOVER_RESOLVED_ENTRY,
	createHandoverMetadata,
	findPendingHandover,
	normalizeChecklist,
	shouldReviewHandover,
	type PendingHandover,
} from "./domain.js";
import { buildAgentHandoverRequest } from "./prompt.js";

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

function makeId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function checklistLine(item: PendingHandover["checklist"][number]): string {
	const status = item.status === "done" ? "✓" : item.status === "blocked" ? "!" : "-";
	const evidence = item.evidence === undefined ? "" : ` evidence=${JSON.stringify(item.evidence)}`;
	return `${status} ${item.name}${item.notes ? ` — ${item.notes}` : ""}${evidence}`;
}

function pendingSummary(item: PendingHandover): string {
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	return `Pending handover ${item.id}: ${item.checklist.length} checklist item(s), ${blocked} blocked.`;
}

async function reviewPendingHandover(ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1], item: PendingHandover): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const editor = new ExtensionEditorComponent(
			tui,
			keybindings,
			"Edit next-session prompt",
			item.nextPrompt,
			(value) => done(value),
			() => done(undefined),
		);
		return {
			get focused() {
				return editor.focused;
			},
			set focused(value: boolean) {
				editor.focused = value;
			},
			render(width: number) {
				const bodyWidth = Math.max(20, width - 4);
				const header = [
					theme.fg("accent", theme.bold("Handover review")),
					pendingSummary(item),
					"",
					theme.fg("accent", "Summary"),
					...(item.summary ? item.summary.split("\n") : ["(none)"]),
					"",
					theme.fg("accent", "Checklist"),
					...(item.checklist.length > 0 ? item.checklist.map(checklistLine) : ["(none supplied)"]),
					"",
					theme.fg("accent", "Next-session prompt"),
				];
				return [...header.map((line) => truncate(line, bodyWidth)), ...editor.render(width)];
			},
			handleInput(data: string) {
				editor.handleInput(data);
				tui.requestRender();
			},
			invalidate() {
				editor.invalidate();
			},
		};
	}, { overlay: true, overlayOptions: { width: "80%", maxHeight: "90%", minWidth: 60 } });
}

export default function (pi: ExtensionAPI) {
	const pending = new Map<string, PendingHandover>();

	function rememberFromEntries(ctx: { sessionManager: { getEntries(): Array<{ type: string; customType?: string; data?: unknown }> } }) {
		const item = findPendingHandover(ctx.sessionManager.getEntries());
		if (item) pending.set(item.id, item);
		return item;
	}

	function getPending(ctx: { sessionManager: { getEntries(): Array<{ type: string; customType?: string; data?: unknown }> } }, id?: string) {
		const fromEntries = rememberFromEntries(ctx);
		return id ? pending.get(id) : fromEntries ?? Array.from(pending.values()).at(-1);
	}

	pi.on("session_start", async (_event, ctx) => {
		const item = rememberFromEntries(ctx);
		if (item) ctx.ui.notify(`${pendingSummary(item)} Run /handover status to resume or cancel.`, "warning");
	});

	pi.registerCommand("handover", {
		description: "Close this turn and hand over to a fresh pi session",
		handler: async (args, ctx) => {
			const subcommand = args.trim();
			if (subcommand === "status") {
				const item = getPending(ctx);
				if (!item) {
					ctx.ui.notify("No pending handover", "info");
					return;
				}
				const action = await ctx.ui.select(`${pendingSummary(item)} What now?`, ["Resume", "Cancel", "Dismiss"]);
				if (action === "Resume") pi.sendUserMessage(`/handover-continue ${item.id}`);
				if (action === "Cancel") {
					pending.delete(item.id);
					pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id: item.id, reason: "cancelled", at: new Date().toISOString() });
					ctx.ui.notify("Pending handover cancelled", "info");
				}
				return;
			}
			if (subcommand === "cancel") {
				const item = getPending(ctx);
				if (!item) {
					ctx.ui.notify("No pending handover", "info");
					return;
				}
				pending.delete(item.id);
				pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id: item.id, reason: "cancelled", at: new Date().toISOString() });
				ctx.ui.notify("Pending handover cancelled", "info");
				return;
			}

			const config = await loadHandoverConfig(ctx.cwd);
			let description = subcommand;

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
			const item = getPending(ctx, id);
			if (!item) {
				ctx.ui.notify("No pending handover prompt found", "error");
				return;
			}

			let nextPrompt = item.nextPrompt;
			if (item.reviewPromptBeforeStart) {
				const reviewed = await reviewPendingHandover(ctx, item);
				if (reviewed === undefined) {
					ctx.ui.notify("Handover cancelled", "info");
					return;
				}
				nextPrompt = reviewed;
			}

			pending.delete(id);
			pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id, reason: "resumed", at: new Date().toISOString() });

			const result = await ctx.newSession({
				parentSession: item.parentSession,
				setup: async (sessionManager) => {
					sessionManager.appendCustomEntry(HANDOVER_METADATA_ENTRY, createHandoverMetadata(item, new Date().toISOString()));
				},
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
			"Provide structured completedSteps with status, notes, and optional evidence. Blocked steps require notes and force user review.",
		],
		parameters: handoverCompleteSchema,
		async execute(_toolCallId, params: HandoverCompleteInput, _signal, _onUpdate, ctx) {
			const config = await loadHandoverConfig(ctx.cwd);
			const checklist = normalizeChecklist(params.completedSteps ?? []);
			const id = makeId();
			const item: PendingHandover = {
				id,
				nextPrompt: params.nextPrompt,
				summary: params.summary,
				checklist,
				parentSession: ctx.sessionManager.getSessionFile(),
				reviewPromptBeforeStart: shouldReviewHandover(config.reviewPromptBeforeStart, checklist),
				createdAt: new Date().toISOString(),
			};
			pending.set(id, item);
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
