import { findAutoHandoverState, findPendingHandovers, type AutoHandoverState, type PendingHandover } from "./domain.js";

type EntryLike = { type: string; customType?: string; data?: unknown };
type SessionEntriesContext = { sessionManager: { getEntries(): EntryLike[] } };

export class HandoverRuntimeState {
	private readonly pending = new Map<string, PendingHandover>();
	private autoState: AutoHandoverState | undefined;

	rememberFromEntries(ctx: SessionEntriesContext): PendingHandover | undefined {
		const entries = ctx.sessionManager.getEntries();
		this.pending.clear();
		const pendingItems = findPendingHandovers(entries);
		for (const item of pendingItems) this.pending.set(item.id, item);
		this.autoState = findAutoHandoverState(entries);
		return pendingItems.at(-1);
	}

	getPending(ctx: SessionEntriesContext, id?: string): PendingHandover | undefined {
		const fromEntries = this.rememberFromEntries(ctx);
		return id ? this.pending.get(id) : fromEntries;
	}

	getAuto(ctx: SessionEntriesContext): AutoHandoverState | undefined {
		this.rememberFromEntries(ctx);
		return this.autoState;
	}

	setAuto(auto: AutoHandoverState | undefined): void {
		this.autoState = auto;
	}

	rememberPending(item: PendingHandover): void {
		this.pending.set(item.id, item);
	}

	deletePending(id: string): void {
		this.pending.delete(id);
	}
}
