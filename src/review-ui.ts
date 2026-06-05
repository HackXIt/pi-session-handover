import { stripVTControlCharacters } from "node:util";
import { ExtensionEditorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PendingHandover } from "./domain.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
type CustomFactory = Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0];
type CustomTheme = Parameters<CustomFactory>[1];

function visibleLength(text: string): number {
	return stripVTControlCharacters(text).length;
}

function truncate(text: string, width: number): string {
	if (visibleLength(text) <= width) return text;
	return `${stripVTControlCharacters(text).slice(0, Math.max(0, width - 1))}…`;
}

function wrapPlainLine(line: string, width: number): string[] {
	if (!line) return [""];
	const words = line.split(/(\s+)/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (!word) continue;
		if (visibleLength(current + word) <= width) {
			current += word;
			continue;
		}
		if (current.trim()) lines.push(current.trimEnd());
		current = word.trimStart();
		while (visibleLength(current) > width) {
			lines.push(current.slice(0, width));
			current = current.slice(width);
		}
	}
	if (current || lines.length === 0) lines.push(current.trimEnd());
	return lines;
}

function wrapPlainText(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => wrapPlainLine(line, width));
}

function checklistLine(item: PendingHandover["checklist"][number]): string {
	const status = item.status === "done" ? "✓" : item.status === "blocked" ? "!" : "-";
	return `${status} ${item.name}${item.notes ? ` — ${item.notes}` : ""}`;
}

function pluralStatus(count: number, label: string): string | undefined {
	return count > 0 ? `${count} ${label}` : undefined;
}

export function pendingSummary(item: PendingHandover): string {
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	return `Pending handover ${item.id}: ${item.checklist.length} checklist item(s), ${blocked} blocked.`;
}

export function buildReviewHeaderLines(item: PendingHandover, textWidth: number): string[] {
	const done = item.checklist.filter((step) => step.status === "done").length;
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	const skipped = item.checklist.length - done - blocked;
	const openItems = item.checklist.filter((step) => step.status !== "done");
	const checklistSummary =
		openItems.length === 0
			? `Checklist: all ${item.checklist.length} item(s) done.`
			: `Checklist: ${[pluralStatus(done, "done"), pluralStatus(blocked, "blocked"), pluralStatus(skipped, "skipped")]
					.filter((part): part is string => part !== undefined)
					.join(", ")}.`;
	return [
		pendingSummary(item),
		"Submit the editor to accept; use the external-editor keybinding for large edits.",
		"",
		"Summary",
		...(item.summary ? wrapPlainText(item.summary, textWidth).slice(0, 4) : ["(none)"]),
		"",
		checklistSummary,
		...openItems.flatMap((entry) => wrapPlainText(checklistLine(entry), textWidth)).slice(0, 5),
		"",
		"Next-session prompt",
	];
}

export function buildReviewIntroLines(item: PendingHandover, textWidth: number): string[] {
	return ["Handover review", "", ...buildReviewHeaderLines(item, textWidth), ""];
}

function styleReviewIntroLine(theme: CustomTheme, line: string): string {
	if (line === "Handover review") return theme.fg("accent", theme.bold(line));
	if (line === "Summary" || line === "Next-session prompt") return theme.fg("accent", line);
	if (line.startsWith("Checklist:")) return theme.fg("accent", line);
	return line;
}

export async function reviewPendingHandover(ctx: CommandContext, item: PendingHandover): Promise<string | undefined> {
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
				const textWidth = Math.max(10, width);
				const header = buildReviewIntroLines(item, textWidth).map((line) => styleReviewIntroLine(theme, truncate(line, width)));
				return [...header, ...editor.render(width)];
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
