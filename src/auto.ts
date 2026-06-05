import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inferMaxDepthFromPlanText, type AutoHandoverState } from "./domain.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

export function autoSummary(auto: AutoHandoverState): string {
	return `Auto handover armed (${auto.depth}/${auto.maxDepth})${auto.source ? ` from ${auto.source}` : ""}.`;
}

export function parseAutoDepth(args: string): number | undefined {
	const value = args.trim();
	if (!value) return undefined;
	const depth = Number(value);
	return Number.isInteger(depth) && depth > 0 ? depth : undefined;
}

export async function inferAutoDepth(
	ctx: CommandContext,
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
