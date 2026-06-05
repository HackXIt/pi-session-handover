import { AgentSession } from "@earendil-works/pi-coding-agent";

type SessionWithPrompt = {
	isStreaming: boolean;
	prompt: (text: string, options?: { source?: "extension" }) => Promise<void>;
	subscribe: (listener: (event: { type: string }) => void) => () => void;
	sendUserMessage: (content: unknown, options?: { deliverAs?: "steer" | "followUp" }) => Promise<void>;
};

const queuedSlashCommandPatch = Symbol.for("pi-agent-handoff.queued-slash-command-compat");

// Pi's extension-facing sendUserMessage intentionally bypasses slash-command expansion.
// handover_complete needs to enqueue /handover-continue from a tool context, where
// command-only ctx.newSession() is otherwise unavailable.
export function installQueuedSlashCommandCompat(prototype: SessionWithPrompt = AgentSession.prototype as unknown as SessionWithPrompt): void {
	const target = prototype as SessionWithPrompt & { [queuedSlashCommandPatch]?: true };
	if (target[queuedSlashCommandPatch]) return;

	const originalSendUserMessage = target.sendUserMessage;
	target.sendUserMessage = async function patchedSendUserMessage(
		this: SessionWithPrompt,
		content: unknown,
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		if (typeof content !== "string" || !content.startsWith("/handover-continue")) {
			return originalSendUserMessage.call(this, content, options);
		}

		if (this.isStreaming && options?.deliverAs === "followUp") {
			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const unsubscribe = this.subscribe((event) => {
					if (event.type !== "agent_end" || settled) return;
					settled = true;
					unsubscribe();
					queueMicrotask(() => {
						this.prompt(content, { source: "extension" }).then(resolve, reject);
					});
				});
			});
			return;
		}

		return this.prompt(content, { source: "extension" });
	};
	target[queuedSlashCommandPatch] = true;
}
