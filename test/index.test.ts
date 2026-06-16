import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import registerHandoverExtension from "../src/index.js";
import {
	HANDOVER_AUTO_STATE_ENTRY,
	HANDOVER_METADATA_ENTRY,
	HANDOVER_PENDING_ENTRY,
	HANDOVER_RESOLVED_ENTRY,
	type PendingHandover,
} from "../src/domain.js";
import { AUTO_CONTINUATION_MARKER } from "../src/prompt.js";

type Entry = { type: string; customType?: string; data?: unknown };

type FakeContext = ReturnType<typeof createContext>;

async function createCwd(config: Record<string, unknown> = {}) {
	const dir = await mkdtemp(join(tmpdir(), "handover-index-"));
	await mkdir(join(dir, ".pi"));
	await writeFile(
		join(dir, ".pi", "handover.json"),
		JSON.stringify({ taskInputRequired: false, reviewPromptBeforeStart: false, promptContextFields: [], ...config }),
	);
	return dir;
}

function pendingItem(id = "pending-1"): PendingHandover {
	return {
		id,
		nextPrompt: "continue from pending",
		summary: "previous turn summary",
		checklist: [{ name: "Build", status: "done" }],
		reviewPromptBeforeStart: false,
		createdAt: "2026-06-05T00:00:00.000Z",
	};
}

function createContext(cwd: string, entries: Entry[] = []) {
	const sentUserMessages: Array<{ message: string; options?: unknown }> = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const statuses: Array<{ key: string; value: string | undefined }> = [];
	const selects: string[] = [];
	const replacementMessages: string[] = [];
	let idle = true;
	let stale = false;
	const assertFresh = () => {
		if (stale) throw new Error("stale extension context used after session replacement");
	};
	const ctx = {
		cwd,
		assertFresh,
		sentUserMessages,
		notifications,
		statuses,
		selects,
		replacementMessages,
		setIdle: (value: boolean) => {
			idle = value;
		},
		selectResult: "Dismiss" as string | undefined,
		newSessionResult: { cancelled: false } as { cancelled: boolean },
		sessionManager: {
			getEntries: () => entries,
			getSessionFile: () => join(cwd, "session.jsonl"),
		},
		ui: {
			notify: vi.fn((message: string, level?: string) => {
				assertFresh();
				notifications.push({ message, level });
			}),
			setStatus: vi.fn((key: string, value: string | undefined) => {
				assertFresh();
				statuses.push({ key, value });
			}),
			select: vi.fn(async (_prompt: string, _options: string[]): Promise<string | undefined> => {
				assertFresh();
				selects.push(_prompt);
				return ctx.selectResult;
			}),
			input: vi.fn(async (_prompt?: string, _placeholder?: string): Promise<string | undefined> => {
				assertFresh();
				return undefined;
			}),
			editor: vi.fn(async (_prompt?: string, _value?: string): Promise<string | undefined> => {
				assertFresh();
				return undefined;
			}),
			custom: vi.fn(() => {
				assertFresh();
			}),
		},
		isIdle: () => idle,
		newSession: vi.fn(async (options: { setup?: (sessionManager: { appendCustomEntry: (customType: string, data: unknown) => void }) => Promise<void> | void; withSession?: (replacementCtx: { sendUserMessage: (message: string) => Promise<void> }) => Promise<void> | void }) => {
			assertFresh();
			if (!ctx.newSessionResult.cancelled) {
				await options.setup?.({ appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
				stale = true;
				await options.withSession?.({ sendUserMessage: async (message) => { replacementMessages.push(message); } });
			}
			return ctx.newSessionResult;
		}),
	};
	return ctx;
}

function createPi(ctx: FakeContext) {
	const commands = new Map<string, (args: string, ctx: FakeContext) => Promise<void>>();
	const commandDescriptions = new Map<string, string>();
	const commandCompletions = new Map<string, (prefix: string) => Array<{ value: string; label?: string; description?: string }> | null>();
	let tool: { execute: (...args: any[]) => Promise<unknown> } | undefined;
	const pi = {
		commands,
		commandDescriptions,
		commandCompletions,
		get tool() {
			return tool;
		},
		on: vi.fn(),
		registerCommand: vi.fn((name: string, config: { description?: string; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label?: string; description?: string }> | null; handler: (args: string, ctx: FakeContext) => Promise<void> }) => {
			commands.set(name, config.handler);
			if (config.description) commandDescriptions.set(name, config.description);
			if (config.getArgumentCompletions) commandCompletions.set(name, config.getArgumentCompletions);
		}),
		registerTool: vi.fn((registered: { execute: (...args: any[]) => Promise<unknown> }) => {
			tool = registered;
		}),
		appendEntry: vi.fn((customType: string, data: unknown) => {
			ctx.assertFresh();
			ctx.sessionManager.getEntries().push({ type: "custom", customType, data });
		}),
		sendUserMessage: vi.fn((message: string, options?: unknown) => {
			ctx.assertFresh();
			ctx.sentUserMessages.push({ message, options });
		}),
	};
	registerHandoverExtension(pi as any);
	return pi;
}

describe("handover extension flows", () => {
	it("sends a handover request for a normal description", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		ctx.setIdle(false);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("finish phase 2", ctx);

		expect(ctx.sentUserMessages).toHaveLength(1);
		expect(ctx.sentUserMessages[0]?.message).toContain("continue finish phase 2");
		expect(ctx.sentUserMessages[0]?.message).toContain("handover_complete");
		expect(ctx.sentUserMessages[0]?.options).toEqual({ deliverAs: "followUp" });
	});

	it("opens a multiline editor for a handover description when no argument is supplied", async () => {
		const cwd = await createCwd({ taskInputRequired: true, taskInputPrompt: "Continue what?" });
		const ctx = createContext(cwd);
		ctx.ui.editor.mockResolvedValue("phase 3");
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("", ctx);

		expect(ctx.ui.editor).toHaveBeenCalledWith("Continue what?", "");
		expect(ctx.ui.input).not.toHaveBeenCalled();
		expect(ctx.sentUserMessages[0]?.message).toContain("continue phase 3");
	});

	it("keeps single-line no-argument handover input when configured", async () => {
		const cwd = await createCwd({ taskInputRequired: true, taskInputPrompt: "Continue what?", taskInputMultiline: false });
		const ctx = createContext(cwd);
		ctx.ui.input.mockResolvedValue("phase 3");
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("", ctx);

		expect(ctx.ui.input).toHaveBeenCalledWith("Continue what?", "continue the current plan slice");
		expect(ctx.ui.editor).not.toHaveBeenCalled();
		expect(ctx.sentUserMessages[0]?.message).toContain("continue phase 3");
	});

	it("shows usage when no description is available", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("", ctx);

		expect(ctx.notifications.at(-1)).toEqual({
			message: "Usage: /handover <what the next agent should continue>",
			level: "error",
		});
		expect(ctx.sentUserMessages).toEqual([]);
	});

	it("opens the settings UI shell from /handover settings", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("settings", ctx);

		expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
		expect(ctx.sentUserMessages).toEqual([]);
		expect(ctx.ui.input).not.toHaveBeenCalled();
		expect(pi.commandDescriptions.get("handover")).toContain("settings");
	});

	it("offers argument completions for /handover subcommands", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);
		const complete = pi.commandCompletions.get("handover");

		expect(complete?.("")?.map((item) => item.value)).toEqual(["auto", "status", "cancel", "settings"]);
		expect(complete?.("s")?.map((item) => item.value)).toEqual(["status", "settings"]);
		expect(complete?.("auto ")?.map((item) => item.value)).toEqual(["auto 2", "auto 3", "auto 5", "auto 8"]);
		expect(complete?.("finish docs")).toBeNull();
	});

	it("reports an actionable settings error when custom UI is unavailable", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		(ctx.ui as { custom?: unknown }).custom = undefined;
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("settings", ctx);

		expect(ctx.notifications.at(-1)).toEqual({
			message: "Settings UI is unavailable in this context. Run /handover settings from an interactive pi session.",
			level: "error",
		});
		expect(ctx.sentUserMessages).toEqual([]);
	});

	it("arms automatic handover mode and persists session metadata", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("auto 4", ctx);

		const autoEntry = ctx.sessionManager.getEntries().find((entry) => entry.customType === HANDOVER_AUTO_STATE_ENTRY);
		expect(autoEntry?.data).toMatchObject({ depth: 1, maxDepth: 4, armed: true });
		expect(ctx.statuses.at(-1)).toEqual({ key: "pi-session-handover", value: "handover auto 1/4" });
		expect(ctx.notifications.at(-1)?.message).toContain("Auto handover armed (1/4)");
	});

	it("reports invalid explicit auto depth without prompting for inferred depth", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("auto later", ctx);

		expect(ctx.notifications.at(-1)).toEqual({ message: "Auto handover max depth must be a positive integer", level: "error" });
		expect(ctx.ui.input).not.toHaveBeenCalled();
		expect(ctx.sessionManager.getEntries()).toEqual([]);
	});

	it("infers auto depth from a configured plan context file", async () => {
		const cwd = await createCwd({ promptContextFields: [{ name: "plan", prompt: "Plan file?" }] });
		await writeFile(join(cwd, "PLAN.md"), "- [ ] one\n- [ ] two\n- [ ] three\n");
		const ctx = createContext(cwd);
		ctx.ui.input.mockResolvedValue("PLAN.md");
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("auto", ctx);

		expect(ctx.ui.input).toHaveBeenCalledTimes(1);
		expect(ctx.sessionManager.getEntries().find((entry) => entry.customType === HANDOVER_AUTO_STATE_ENTRY)?.data).toMatchObject({
			maxDepth: 3,
			source: "PLAN.md",
		});
	});

	it("does not expose stale pending handover state after switching to a session without pending entries", async () => {
		const cwd = await createCwd();
		const firstCtx = createContext(cwd);
		const pi = createPi(firstCtx);
		await pi.tool!.execute("call", { nextPrompt: "continue from first session" }, undefined, undefined, firstCtx);

		const secondCtx = createContext(cwd);
		secondCtx.ui.select.mockImplementation(async () => {
			throw new Error("status should not prompt when no current-session handover exists");
		});

		await pi.commands.get("handover")!("status", secondCtx);

		expect(secondCtx.notifications.at(-1)).toEqual({ message: "No pending or armed handover", level: "info" });
		expect(secondCtx.sentUserMessages).toEqual([]);
	});

	it("keeps a pending handover recoverable when creating the replacement session is cancelled", async () => {
		const cwd = await createCwd();
		const item = pendingItem();
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: item }];
		const ctx = createContext(cwd, entries);
		ctx.newSessionResult = { cancelled: true };
		const pi = createPi(ctx);

		await pi.commands.get("handover-continue")!(item.id, ctx);

		expect(entries.some((entry) => entry.customType === HANDOVER_RESOLVED_ENTRY)).toBe(false);
		ctx.selectResult = "Resume";
		await pi.commands.get("handover")!("status", ctx);
		expect(ctx.sentUserMessages.at(-1)?.message).toBe(`/handover-continue ${item.id}`);
	});

	it("treats descriptions beginning with automatic as normal handover descriptions", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("automatic cleanup", ctx);

		expect(ctx.sentUserMessages).toHaveLength(1);
		expect(ctx.sentUserMessages[0]?.message).toContain("continue automatic cleanup");
		expect(ctx.ui.input).not.toHaveBeenCalledWith("Maximum automatic handover chain depth?", "5");
	});

	it("prompts for every configured handover context field", async () => {
		const cwd = await createCwd({
			promptContextFields: [
				{ name: "plan", prompt: "Plan file?" },
				{ name: "risk", prompt: "Known risk?", multiline: true },
			],
		});
		const ctx = createContext(cwd);
		ctx.ui.input.mockResolvedValue("docs/PLAN.md");
		ctx.ui.editor.mockResolvedValue("migration not verified");
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("phase 2", ctx);

		expect(ctx.ui.input).toHaveBeenCalledWith("Plan file?", "");
		expect(ctx.ui.editor).toHaveBeenCalledWith("Known risk?", "");
		expect(ctx.sentUserMessages[0]?.message).toContain("- plan: docs/PLAN.md");
		expect(ctx.sentUserMessages[0]?.message).toContain("- risk: migration not verified");
	});

	it("cancels handover when a configured context field is blank", async () => {
		const cwd = await createCwd({ promptContextFields: [{ name: "plan", prompt: "Plan file?" }] });
		const ctx = createContext(cwd);
		ctx.ui.input.mockResolvedValue("   ");
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("phase 2", ctx);

		expect(ctx.notifications).toContainEqual({ message: "Handover field plan is required", level: "error" });
		expect(ctx.notifications.at(-1)).toEqual({ message: "Handover cancelled", level: "info" });
		expect(ctx.sentUserMessages).toEqual([]);
	});

	it("clears stale auto footer status on session start when the new session has no auto state", async () => {
		const cwd = await createCwd();
		const firstCtx = createContext(cwd);
		const pi = createPi(firstCtx);
		firstCtx.ui.input.mockResolvedValue("5");
		await pi.commands.get("handover")!("auto 3", firstCtx);

		const secondCtx = createContext(cwd);
		const sessionStartHandler = pi.on.mock.calls.find(([event]) => event === "session_start")?.[1];
		expect(sessionStartHandler).toBeDefined();
		await sessionStartHandler?.({}, secondCtx);

		expect(secondCtx.statuses.at(-1)).toEqual({ key: "pi-session-handover", value: undefined });
	});

	it("cancels current-session pending and automatic state", async () => {
		const cwd = await createCwd();
		const item = pendingItem();
		const auto = {
			chainId: "chain",
			depth: 1,
			maxDepth: 3,
			armed: true,
			createdAt: "2026-06-05T00:00:00.000Z",
			updatedAt: "2026-06-05T00:00:00.000Z",
		};
		const entries: Entry[] = [
			{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: item },
			{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto },
		];
		const ctx = createContext(cwd, entries);
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("cancel", ctx);

		expect(entries.find((entry) => entry.customType === HANDOVER_RESOLVED_ENTRY)?.data).toMatchObject({ id: item.id, reason: "cancelled" });
		expect(entries.at(-1)?.customType).toBe(HANDOVER_AUTO_STATE_ENTRY);
		expect(entries.at(-1)?.data).toMatchObject({ chainId: "chain", armed: false });
		expect(ctx.statuses.at(-1)).toEqual({ key: "pi-session-handover", value: undefined });
		expect(ctx.notifications.at(-1)).toEqual({ message: "Handover state cancelled", level: "info" });
	});

	it("allows status to cancel armed auto mode when no pending handover exists", async () => {
		const cwd = await createCwd();
		const auto = {
			chainId: "chain",
			depth: 2,
			maxDepth: 4,
			armed: true,
			createdAt: "2026-06-05T00:00:00.000Z",
			updatedAt: "2026-06-05T00:00:00.000Z",
		};
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto }];
		const ctx = createContext(cwd, entries);
		ctx.selectResult = "Cancel";
		const pi = createPi(ctx);

		await pi.commands.get("handover")!("status", ctx);

		expect(ctx.ui.select).toHaveBeenCalledWith(expect.stringContaining("Auto handover armed (2/4)"), ["Cancel", "Dismiss"]);
		expect(entries.at(-1)?.customType).toBe(HANDOVER_AUTO_STATE_ENTRY);
		expect(entries.at(-1)?.data).toMatchObject({ chainId: "chain", armed: false });
		expect(ctx.statuses.at(-1)).toEqual({ key: "pi-session-handover", value: undefined });
	});

	it("handover_complete persists pending state and queues continuation", async () => {
		const cwd = await createCwd();
		const ctx = createContext(cwd);
		const pi = createPi(ctx);

		const result = await pi.tool!.execute(
			"call",
			{ nextPrompt: "continue next slice", summary: "done", completedSteps: ["Build"] },
			undefined,
			undefined,
			ctx,
		);

		const pendingEntry = ctx.sessionManager.getEntries().find((entry) => entry.customType === HANDOVER_PENDING_ENTRY);
		expect(pendingEntry?.data).toMatchObject({ nextPrompt: "continue next slice", summary: "done", reviewPromptBeforeStart: false });
		expect(ctx.sentUserMessages.at(-1)?.message).toBe(`/handover-continue ${(pendingEntry?.data as PendingHandover).id}`);
		expect(result).toMatchObject({ terminate: true, details: { checklist: [{ name: "Build", status: "done" }] } });
	});

	it("handover_complete in auto mode persists an augmented prompt and skips prompt review by default", async () => {
		const cwd = await createCwd({ reviewPromptBeforeStart: true });
		const auto = {
			chainId: "chain",
			depth: 1,
			maxDepth: 3,
			armed: true,
			createdAt: "2026-06-05T00:00:00.000Z",
			updatedAt: "2026-06-05T00:00:00.000Z",
		};
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto }];
		const ctx = createContext(cwd, entries);
		const pi = createPi(ctx);

		await pi.tool!.execute(
			"call",
			{
				nextPrompt: "continue automatically",
				completedSteps: [{ name: "Build", status: "blocked", notes: "CI unavailable" }],
			},
			undefined,
			undefined,
			ctx,
		);

		const pendingEntry = ctx.sessionManager.getEntries().find((entry) => entry.customType === HANDOVER_PENDING_ENTRY);
		const pending = pendingEntry?.data as PendingHandover | undefined;
		expect(pending).toMatchObject({
			reviewPromptBeforeStart: false,
			auto: { chainId: "chain" },
		});
		expect(pending?.nextPrompt).toContain("continue automatically");
		expect(pending?.nextPrompt).toContain(AUTO_CONTINUATION_MARKER);
		expect(pending?.nextPrompt).toContain("handover_complete");
	});

	it("handover_complete can be configured to review prompts in auto mode", async () => {
		const cwd = await createCwd({ autoReviewPromptBeforeStart: true });
		const auto = {
			chainId: "chain",
			depth: 1,
			maxDepth: 3,
			armed: true,
			createdAt: "2026-06-05T00:00:00.000Z",
			updatedAt: "2026-06-05T00:00:00.000Z",
		};
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto }];
		const ctx = createContext(cwd, entries);
		const pi = createPi(ctx);

		await pi.tool!.execute("call", { nextPrompt: "review automatically" }, undefined, undefined, ctx);

		const pendingEntry = ctx.sessionManager.getEntries().find((entry) => entry.customType === HANDOVER_PENDING_ENTRY);
		expect(pendingEntry?.data).toMatchObject({ reviewPromptBeforeStart: true });
		expect((pendingEntry?.data as PendingHandover | undefined)?.nextPrompt).toContain(AUTO_CONTINUATION_MARKER);
	});

	it("handover-continue starts the replacement session and resolves pending state after success", async () => {
		const cwd = await createCwd();
		const item = pendingItem();
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: item }];
		const ctx = createContext(cwd, entries);
		const pi = createPi(ctx);

		await pi.commands.get("handover-continue")!(item.id, ctx);

		expect(ctx.newSession).toHaveBeenCalledWith(expect.objectContaining({ parentSession: item.parentSession }));
		expect(ctx.replacementMessages).toEqual([item.nextPrompt]);
		expect(entries.find((entry) => entry.customType === HANDOVER_METADATA_ENTRY)?.data).toMatchObject({
			id: item.id,
			summary: item.summary,
			checklist: item.checklist,
		});
		expect(entries.at(-1)?.customType).toBe(HANDOVER_RESOLVED_ENTRY);
		expect(entries.at(-1)?.data).toMatchObject({ id: item.id, reason: "resumed" });
	});

	it("handover-continue does not keep the old command context alive while replacement prompt runs", async () => {
		const cwd = await createCwd();
		const item = pendingItem();
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: item }];
		const ctx = createContext(cwd, entries);
		let resolveReplacementPrompt!: () => void;
		ctx.newSession.mockImplementationOnce(async (options) => {
			await options.setup?.({ appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
			await options.withSession?.({
				sendUserMessage: async (message) => {
					ctx.replacementMessages.push(message);
					await new Promise<void>((resolve) => {
						resolveReplacementPrompt = resolve;
					});
				},
			});
			return { cancelled: false };
		});
		const pi = createPi(ctx);

		const commandPromise = pi.commands.get("handover-continue")!(item.id, ctx);
		await vi.waitFor(() => expect(ctx.replacementMessages).toEqual([item.nextPrompt]));

		await commandPromise;
		resolveReplacementPrompt();
	});

	it("handover-continue carries automatic handover state into the replacement session", async () => {
		const cwd = await createCwd();
		const item = {
			...pendingItem(),
			auto: {
				chainId: "chain",
				depth: 1,
				maxDepth: 3,
				armed: true,
				createdAt: "2026-06-05T00:00:00.000Z",
				updatedAt: "2026-06-05T00:00:00.000Z",
			},
		};
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: item }];
		const ctx = createContext(cwd, entries);
		const pi = createPi(ctx);

		await pi.commands.get("handover-continue")!(item.id, ctx);

		expect(entries.find((entry) => entry.customType === HANDOVER_METADATA_ENTRY)?.data).toMatchObject({
			id: item.id,
			auto: { chainId: "chain", depth: 1, maxDepth: 3 },
		});
		expect(entries.find((entry) => entry.customType === HANDOVER_AUTO_STATE_ENTRY)?.data).toMatchObject({
			chainId: "chain",
			depth: 2,
			maxDepth: 3,
			armed: true,
		});
	});

	it("handover-continue sends the augmented auto prompt from handover_complete to the replacement session", async () => {
		const cwd = await createCwd();
		const auto = {
			chainId: "chain",
			depth: 1,
			maxDepth: 3,
			armed: true,
			createdAt: "2026-06-05T00:00:00.000Z",
			updatedAt: "2026-06-05T00:00:00.000Z",
		};
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_AUTO_STATE_ENTRY, data: auto }];
		const ctx = createContext(cwd, entries);
		const pi = createPi(ctx);

		await pi.tool!.execute("call", { nextPrompt: "bare next prompt" }, undefined, undefined, ctx);
		const pending = entries.find((entry) => entry.customType === HANDOVER_PENDING_ENTRY)?.data as PendingHandover;
		await pi.commands.get("handover-continue")!(pending.id, ctx);

		expect(ctx.replacementMessages).toHaveLength(1);
		expect(ctx.replacementMessages[0]).toContain("bare next prompt");
		expect(ctx.replacementMessages[0]).toContain(AUTO_CONTINUATION_MARKER);
		expect(ctx.replacementMessages[0]).toContain("handover_complete");
	});

	it("handover-continue remains pending when prompt review is cancelled", async () => {
		const cwd = await createCwd();
		const item = { ...pendingItem(), reviewPromptBeforeStart: true };
		const entries: Entry[] = [{ type: "custom", customType: HANDOVER_PENDING_ENTRY, data: item }];
		const ctx = createContext(cwd, entries);
		ctx.ui.custom.mockResolvedValue(undefined);
		const pi = createPi(ctx);

		await pi.commands.get("handover-continue")!(item.id, ctx);

		expect(ctx.newSession).not.toHaveBeenCalled();
		expect(entries.some((entry) => entry.customType === HANDOVER_RESOLVED_ENTRY)).toBe(false);
		expect(ctx.notifications.at(-1)).toEqual({ message: "Handover cancelled", level: "info" });
	});
});
