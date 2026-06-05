import { describe, expect, it, vi } from "vitest";
import { installQueuedSlashCommandCompat } from "../src/sdk-compat.js";

function createPrototype() {
	const listeners: Array<(event: { type: string }) => void> = [];
	const originalCalls: unknown[] = [];
	const promptCalls: unknown[] = [];
	const prototype = {
		isStreaming: false,
		async sendUserMessage(content: unknown, options?: unknown) {
			originalCalls.push({ content, options });
		},
		async prompt(text: string, options?: unknown) {
			promptCalls.push({ text, options });
		},
		subscribe(listener: (event: { type: string }) => void) {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		emit(event: { type: string }) {
			for (const listener of [...listeners]) listener(event);
		},
	};
	return { prototype, originalCalls, promptCalls, listeners };
}

describe("queued handover continuation SDK compatibility", () => {
	it("leaves normal extension-sent user messages on the SDK path", async () => {
		const { prototype, originalCalls, promptCalls } = createPrototype();
		installQueuedSlashCommandCompat(prototype);

		await prototype.sendUserMessage("hello", { deliverAs: "followUp" });

		expect(originalCalls).toEqual([{ content: "hello", options: { deliverAs: "followUp" } }]);
		expect(promptCalls).toEqual([]);
	});

	it("leaves unrelated slash messages on the SDK path", async () => {
		const { prototype, originalCalls, promptCalls } = createPrototype();
		installQueuedSlashCommandCompat(prototype);

		await prototype.sendUserMessage("/unrelated-command", { deliverAs: "followUp" });

		expect(originalCalls).toEqual([{ content: "/unrelated-command", options: { deliverAs: "followUp" } }]);
		expect(promptCalls).toEqual([]);
	});

	it("runs handover continuation commands through prompt handling when idle", async () => {
		const { prototype, originalCalls, promptCalls } = createPrototype();
		installQueuedSlashCommandCompat(prototype);

		await prototype.sendUserMessage("/handover-continue pending-1");

		expect(originalCalls).toEqual([]);
		expect(promptCalls).toEqual([{ text: "/handover-continue pending-1", options: { source: "extension" } }]);
	});

	it("defers follow-up handover continuation commands until the active agent run ends", async () => {
		const { prototype, originalCalls, promptCalls, listeners } = createPrototype();
		prototype.isStreaming = true;
		installQueuedSlashCommandCompat(prototype);

		const send = prototype.sendUserMessage("/handover-continue pending-1", { deliverAs: "followUp" });
		await vi.waitFor(() => expect(listeners).toHaveLength(1));
		expect(promptCalls).toEqual([]);

		prototype.isStreaming = false;
		prototype.emit({ type: "agent_end" });
		await send;

		expect(originalCalls).toEqual([]);
		expect(promptCalls).toEqual([{ text: "/handover-continue pending-1", options: { source: "extension" } }]);
		expect(listeners).toHaveLength(0);
	});
});
