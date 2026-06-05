import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadHandoverConfig } from "./config.js";
import {
	HANDOVER_AUTO_STATE_ENTRY,
	HANDOVER_METADATA_ENTRY,
	HANDOVER_RESOLVED_ENTRY,
	createHandoverMetadata,
	createNextAutoState,
} from "./domain.js";
import { autoSummary, inferAutoDepth, parseAutoDepth } from "./auto.js";
import { buildAgentHandoverRequest } from "./prompt.js";
import { collectPromptContext } from "./prompt-context.js";
import type { HandoverRuntimeState } from "./pending-store.js";
import { pendingSummary, reviewPendingHandover } from "./review-ui.js";

export function registerHandoverCommands(pi: ExtensionAPI, state: HandoverRuntimeState, makeId: () => string): void {
	pi.registerCommand("handover", {
		description: "Close this turn and hand over to a fresh pi session",
		handler: async (args, ctx) => {
			const subcommand = args.trim();
			const [command, ...rest] = subcommand.split(/\s+/);
			const config = await loadHandoverConfig(ctx.cwd, { entries: ctx.sessionManager.getEntries() });
			if (command === "auto") {
				const autoArgs = rest.join(" ");
				const explicitDepth = parseAutoDepth(autoArgs);
				if (autoArgs.trim() && !explicitDepth) {
					ctx.ui.notify("Auto handover max depth must be a positive integer", "error");
					return;
				}
				const inferred = explicitDepth ? { maxDepth: explicitDepth } : await inferAutoDepth(ctx, config);
				if (!inferred) {
					ctx.ui.notify("Auto handover cancelled", "info");
					return;
				}
				const now = new Date().toISOString();
				const autoState = {
					chainId: makeId(),
					depth: 1,
					maxDepth: inferred.maxDepth,
					armed: true,
					createdAt: now,
					updatedAt: now,
					...(inferred.source ? { source: inferred.source } : {}),
				};
				state.setAuto(autoState);
				pi.appendEntry(HANDOVER_AUTO_STATE_ENTRY, autoState);
				ctx.ui.setStatus("session-handover", `handover auto ${autoState.depth}/${autoState.maxDepth}`);
				ctx.ui.notify(autoSummary(autoState), "info");
				return;
			}
			if (subcommand === "status") {
				const item = state.getPending(ctx);
				const auto = state.getAuto(ctx);
				if (!item && !auto) {
					ctx.ui.notify("No pending or armed handover", "info");
					return;
				}
				const summary = [item ? pendingSummary(item) : undefined, auto ? autoSummary(auto) : undefined].filter(Boolean).join(" ");
				const action = await ctx.ui.select(`${summary} What now?`, item ? ["Resume", "Cancel", "Dismiss"] : ["Cancel", "Dismiss"]);
				if (item && action === "Resume") pi.sendUserMessage(`/handover-continue ${item.id}`);
				if (action === "Cancel") {
					if (item) {
						state.deletePending(item.id);
						pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id: item.id, reason: "cancelled", at: new Date().toISOString() });
					}
					if (auto) {
						const cancelledAuto = { ...auto, armed: false, updatedAt: new Date().toISOString() };
						state.setAuto(cancelledAuto);
						pi.appendEntry(HANDOVER_AUTO_STATE_ENTRY, cancelledAuto);
						ctx.ui.setStatus("session-handover", undefined);
					}
					ctx.ui.notify("Handover state cancelled", "info");
				}
				return;
			}
			if (subcommand === "cancel") {
				const item = state.getPending(ctx);
				const auto = state.getAuto(ctx);
				if (!item && !auto) {
					ctx.ui.notify("No pending or armed handover", "info");
					return;
				}
				if (item) {
					state.deletePending(item.id);
					pi.appendEntry(HANDOVER_RESOLVED_ENTRY, { id: item.id, reason: "cancelled", at: new Date().toISOString() });
				}
				if (auto) {
					const cancelledAuto = { ...auto, armed: false, updatedAt: new Date().toISOString() };
					state.setAuto(cancelledAuto);
					pi.appendEntry(HANDOVER_AUTO_STATE_ENTRY, cancelledAuto);
					ctx.ui.setStatus("session-handover", undefined);
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

			const request = buildAgentHandoverRequest(description, config, context, state.getAuto(ctx));
			pi.sendUserMessage(request, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
		},
	});

	pi.registerCommand("handover-continue", {
		description: "Internal command used by session-handover to start the replacement session",
		handler: async (args, ctx) => {
			const id = args.trim();
			const item = state.getPending(ctx, id);
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

			const result = await ctx.newSession({
				parentSession: item.parentSession,
				setup: async (sessionManager) => {
					const now = new Date().toISOString();
					sessionManager.appendCustomEntry(HANDOVER_METADATA_ENTRY, createHandoverMetadata(item, now));
					sessionManager.appendCustomEntry(HANDOVER_RESOLVED_ENTRY, { id, reason: "resumed", at: now });
					const nextAuto = item.auto ? createNextAutoState(item.auto, now) : undefined;
					if (nextAuto) sessionManager.appendCustomEntry(HANDOVER_AUTO_STATE_ENTRY, nextAuto);
				},
				withSession: async (replacementCtx) => {
					void replacementCtx.sendUserMessage(nextPrompt).catch((error: unknown) => {
						const message = error instanceof Error ? error.message : String(error);
						replacementCtx.ui.notify(`Handover prompt failed: ${message}`, "error");
					});
				},
			});

			if (result.cancelled) ctx.ui.notify("New session cancelled", "info");
		},
	});
}
