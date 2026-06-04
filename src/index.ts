import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ExtensionEditorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { loadHandoverConfig } from "./config.js";
import {
	HANDOVER_AUTO_STATE_ENTRY,
	HANDOVER_METADATA_ENTRY,
	HANDOVER_PENDING_ENTRY,
	HANDOVER_RESOLVED_ENTRY,
	createHandoverMetadata,
	createNextAutoState,
	findAutoHandoverState,
	findPendingHandover,
	inferMaxDepthFromPlanText,
	normalizeChecklist,
	shouldReviewHandover,
	type AutoHandoverState,
	type PendingHandover,
} from "./domain.js";
import { buildAgentHandoverRequest, type HandoverPromptContext } from "./prompt.js";

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

function autoSummary(auto: AutoHandoverState): string {
	return `Auto handover armed (${auto.depth}/${auto.maxDepth})${auto.source ? ` from ${auto.source}` : ""}.`;
}

function parseAutoDepth(args: string): number | undefined {
	const value = args.trim();
	if (!value) return undefined;
	const depth = Number(value);
	return Number.isInteger(depth) && depth > 0 ? depth : undefined;
}

async function inferAutoDepth(
	ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
	config: { promptContextFields: Array<{ name: string; prompt: string }> },
): Promise<{ maxDepth: number; source?: string } | undefined> {
	const sourceField = config.promptContextFields.find((field) => /plan|task|issue|source/i.test(field.name));
	if (sourceField) {
		const source = await ctx.ui.input(sourceField.prompt, "docs/PLAN.md");
		if (source === undefined) return undefined;
		const trimmed = source.trim();
		if (trimmed) {
			try {
				const path = isAbsolute(trimmed) ? trimmed : join(ctx.cwd, trimmed);
				const inferred = inferMaxDepthFromPlanText(await readFile(path, "utf8"));
				if (inferred) return { maxDepth: inferred, source: trimmed };
			} catch {
				// Fall back to asking explicitly below.
			}
		}
	}
	const input = await ctx.ui.input("Maximum automatic handover chain depth?", "5");
	if (input === undefined) return undefined;
	const maxDepth = parseAutoDepth(input);
	if (!maxDepth) {
		ctx.ui.notify("Auto handover max depth must be a positive integer", "error");
		return undefined;
	}
	return { maxDepth };
}

async function collectPromptContext(
	ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
	config: { promptContextFields: Array<{ name: string; prompt: string; multiline: boolean }> },
): Promise<HandoverPromptContext | undefined> {
	const context: HandoverPromptContext = {};
	for (const field of config.promptContextFields) {
		const value = field.multiline ? await ctx.ui.editor(field.prompt, "") : await ctx.ui.input(field.prompt, "");
		if (value === undefined) return undefined;
		const trimmed = value.trim();
		if (!trimmed) {
			ctx.ui.notify(`Handover field ${field.name} is required`, "error");
			return undefined;
		}
		context[field.name] = trimmed;
	}
	return context;
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
	let autoState: AutoHandoverState | undefined;

	function rememberFromEntries(ctx: { sessionManager: { getEntries(): Array<{ type: string; customType?: string; data?: unknown }> } }) {
		const entries = ctx.sessionManager.getEntries();
		const item = findPendingHandover(entries);
		if (item) pending.set(item.id, item);
		autoState = findAutoHandoverState(entries);
		return item;
	}

	function getPending(ctx: { sessionManager: { getEntries(): Array<{ type: string; customType?: string; data?: unknown }> } }, id?: string) {
		const fromEntries = rememberFromEntries(ctx);
		return id ? pending.get(id) : fromEntries ?? Array.from(pending.values()).at(-1);
	}

	function getAuto(ctx: { sessionManager: { getEntries(): Array<{ type: string; customType?: string; data?: unknown }> } }) {
		rememberFromEntries(ctx);
		return autoState;
	}

	pi.on("session_start", async (_event, ctx) => {
		const item = rememberFromEntries(ctx);
		if (item) ctx.ui.notify(`${pendingSummary(item)} Run /handover status to resume or cancel.`, "warning");
		if (autoState) ctx.ui.setStatus("pi-agent-handoff", `handover auto ${autoState.depth}/${autoState.maxDepth}`);
	});

	pi.registerCommand("handover", {
		description: "Close this turn and hand over to a fresh pi session",
		handler: async (args, ctx) => {
			const subcommand = args.trim();
			const config = await loadHandoverConfig(ctx.cwd, { entries: ctx.sessionManager.getEntries() });
			if (subcommand.startsWith("auto")) {
				const explicitDepth = parseAutoDepth(subcommand.slice("auto".length));
				const inferred = explicitDepth ? { maxDepth: explicitDepth } : await inferAutoDepth(ctx, config);
				if (!inferred) {
					ctx.ui.notify("Auto handover cancelled", "info");
					return;
				}
				const now = new Date().toISOString();
				autoState = {
					chainId: makeId(),
					depth: 1,
					maxDepth: inferred.maxDepth,
					armed: true,
					createdAt: now,
					updatedAt: now,
					...(inferred.source ? { source: inferred.source } : {}),
				};
				pi.appendEntry(HANDOVER_AUTO_STATE_ENTRY, autoState);
				ctx.ui.setStatus("pi-agent-handoff", `handover auto ${autoState.depth}/${autoState.maxDepth}`);
				ctx.ui.notify(autoSummary(autoState), "info");
				return;
			}
			if (subcommand === "status") {
				const item = getPending(ctx);
				const auto = getAuto(ctx);
				if (!item && !auto) {
					ctx.ui.notify("No pending or armed handover", "info");
					return;
				}
				const summary = [item ? pendingSummary(item) : undefined, auto ? autoSummary(auto) : undefined].filter(Boolean).join(" ");
				const action = await ctx.ui.select(`${summary} What now?`, item ? ["Resume", "Cancel", "Dismiss"] : ["Cancel", "Dismiss"]);
				if (item && action === "Resume") pi.sendUserMessage(`/handover-continue ${item.id}`);
				if (action === "Cancel") {
					if (item) {
						pending.delete(item.id);
						pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id: item.id, reason: "cancelled", at: new Date().toISOString() });
					}
					if (auto) {
						autoState = { ...auto, armed: false, updatedAt: new Date().toISOString() };
						pi.appendEntry(HANDOVER_AUTO_STATE_ENTRY, autoState);
						ctx.ui.setStatus("pi-agent-handoff", undefined);
					}
					ctx.ui.notify("Handover state cancelled", "info");
				}
				return;
			}
			if (subcommand === "cancel") {
				const item = getPending(ctx);
				const auto = getAuto(ctx);
				if (!item && !auto) {
					ctx.ui.notify("No pending or armed handover", "info");
					return;
				}
				if (item) {
					pending.delete(item.id);
					pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id: item.id, reason: "cancelled", at: new Date().toISOString() });
				}
				if (auto) {
					autoState = { ...auto, armed: false, updatedAt: new Date().toISOString() };
					pi.appendEntry(HANDOVER_AUTO_STATE_ENTRY, autoState);
					ctx.ui.setStatus("pi-agent-handoff", undefined);
				}
				ctx.ui.notify("Handover state cancelled", "info");
				return;
			}

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

			const context = await collectPromptContext(ctx, config);
			if (context === undefined) {
				ctx.ui.notify("Handover cancelled", "info");
				return;
			}

			const request = buildAgentHandoverRequest(description, config, context, getAuto(ctx));
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
					const now = new Date().toISOString();
					sessionManager.appendCustomEntry(HANDOVER_METADATA_ENTRY, createHandoverMetadata(item, now));
					const nextAuto = item.auto ? createNextAutoState(item.auto, now) : undefined;
					if (nextAuto) sessionManager.appendCustomEntry(HANDOVER_AUTO_STATE_ENTRY, nextAuto);
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
			const config = await loadHandoverConfig(ctx.cwd, { entries: ctx.sessionManager.getEntries() });
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
				...(getAuto(ctx) ? { auto: getAuto(ctx) } : {}),
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
