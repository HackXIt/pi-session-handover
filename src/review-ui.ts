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

function pad(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
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

function renderBox(theme: CustomTheme, width: number, title: string, body: string[]): string[] {
	const contentWidth = Math.max(20, width - 4);
	const boxWidth = contentWidth + 4;
	const horizontalWidth = boxWidth - 2;
	const border = (text: string) => theme.fg("borderAccent", text);
	const titleText = ` ${title} `;
	const titleWidth = Math.min(titleText.length, horizontalWidth);
	const left = Math.max(0, Math.floor((horizontalWidth - titleWidth) / 2));
	const right = Math.max(0, horizontalWidth - titleWidth - left);
	const lines = [
		border(`╭${"─".repeat(left)}`) + theme.fg("accent", theme.bold(truncate(titleText, titleWidth))) + border(`${"─".repeat(right)}╮`),
	];
	for (const line of body) lines.push(border("│ ") + pad(truncate(line, contentWidth), contentWidth) + border(" │"));
	lines.push(border(`╰${"─".repeat(horizontalWidth)}╯`));
	return lines;
}

function checklistLine(item: PendingHandover["checklist"][number]): string {
	const status = item.status === "done" ? "✓" : item.status === "blocked" ? "!" : "-";
	const evidence = item.evidence === undefined ? "" : ` evidence=${JSON.stringify(item.evidence)}`;
	return `${status} ${item.name}${item.notes ? ` — ${item.notes}` : ""}${evidence}`;
}

export function pendingSummary(item: PendingHandover): string {
	const blocked = item.checklist.filter((step) => step.status === "blocked").length;
	return `Pending handover ${item.id}: ${item.checklist.length} checklist item(s), ${blocked} blocked.`;
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
				const bodyWidth = Math.max(20, width - 4);
				const textWidth = Math.max(10, bodyWidth - 2);
				const header = [
					pendingSummary(item),
					"Accept by submitting the editor; cancel with the editor cancel keybinding.",
					"",
					theme.fg("accent", "Summary"),
					...(item.summary ? wrapPlainText(item.summary, textWidth) : ["(none)"]),
					"",
					theme.fg("accent", "Checklist"),
					...(item.checklist.length > 0 ? item.checklist.flatMap((entry) => wrapPlainText(checklistLine(entry), textWidth)) : ["(none supplied)"]),
					"",
					theme.fg("accent", "Next-session prompt"),
				];
				return [...renderBox(theme, width, "Handover review", header), ...editor.render(width)];
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
