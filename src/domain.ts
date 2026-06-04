export const HANDOVER_PENDING_ENTRY = "pi-agent-handoff:pending";
export const HANDOVER_RESOLVED_ENTRY = "pi-agent-handoff:resolved";

export type ChecklistStatus = "done" | "blocked" | "skipped";

export type ChecklistEvidence = string | string[] | Record<string, unknown>;

export type HandoverChecklistItem = {
	id?: string;
	name: string;
	status: ChecklistStatus;
	notes?: string;
	evidence?: ChecklistEvidence;
};

export type RawHandoverChecklistItem = string | {
	id?: unknown;
	name?: unknown;
	status?: unknown;
	notes?: unknown;
	evidence?: unknown;
};

export type PendingHandover = {
	id: string;
	nextPrompt: string;
	summary?: string;
	checklist: HandoverChecklistItem[];
	parentSession?: string;
	reviewPromptBeforeStart: boolean;
	createdAt: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown): ChecklistStatus {
	return value === "blocked" || value === "skipped" || value === "done" ? value : "done";
}

export function normalizeChecklist(items: unknown): HandoverChecklistItem[] {
	if (!Array.isArray(items)) return [];
	return items.map((item, index) => {
		if (typeof item === "string") {
			return { name: item, status: "done" } satisfies HandoverChecklistItem;
		}
		if (!isObject(item)) {
			throw new Error(`Checklist item ${index + 1} must be a string or object.`);
		}
		const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
		const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
		if (!name) {
			throw new Error(`Checklist item ${index + 1} must include id or name.`);
		}
		const status = normalizeStatus(item.status);
		const notes = typeof item.notes === "string" && item.notes.trim() ? item.notes.trim() : undefined;
		if (status === "blocked" && !notes) {
			throw new Error(`Blocked checklist item ${name} must include notes.`);
		}
		return {
			...(id ? { id } : {}),
			name,
			status,
			...(notes ? { notes } : {}),
			...(item.evidence !== undefined ? { evidence: item.evidence as ChecklistEvidence } : {}),
		};
	});
}

export function hasBlockedChecklistItem(checklist: HandoverChecklistItem[]): boolean {
	return checklist.some((item) => item.status === "blocked");
}

export function shouldReviewHandover(configReview: boolean, checklist: HandoverChecklistItem[]): boolean {
	return configReview || hasBlockedChecklistItem(checklist);
}

export function findPendingHandover(entries: Array<{ type: string; customType?: string; data?: unknown }>): PendingHandover | undefined {
	const pending = new Map<string, PendingHandover>();
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (entry.customType === HANDOVER_PENDING_ENTRY && isPendingHandover(entry.data)) {
			pending.set(entry.data.id, entry.data);
		}
		if (entry.customType === HANDOVER_RESOLVED_ENTRY && isObject(entry.data) && typeof entry.data.id === "string") {
			pending.delete(entry.data.id);
		}
	}
	return Array.from(pending.values()).at(-1);
}

function isPendingHandover(value: unknown): value is PendingHandover {
	return (
		isObject(value) &&
		typeof value.id === "string" &&
		typeof value.nextPrompt === "string" &&
		Array.isArray(value.checklist) &&
		typeof value.reviewPromptBeforeStart === "boolean" &&
		typeof value.createdAt === "string"
	);
}
