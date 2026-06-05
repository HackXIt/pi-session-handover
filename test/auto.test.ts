import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { autoSummary, inferAutoDepth, parseAutoDepth } from "../src/auto.js";

function ctx(cwd: string, input: string | undefined) {
	return {
		cwd,
		ui: {
			input: vi.fn(async () => input),
			notify: vi.fn(),
		},
	} as any;
}

describe("parseAutoDepth", () => {
	it("accepts positive integers only", () => {
		expect(parseAutoDepth("5")).toBe(5);
		expect(parseAutoDepth(" 12 ")).toBe(12);
		expect(parseAutoDepth("")).toBeUndefined();
		expect(parseAutoDepth("0")).toBeUndefined();
		expect(parseAutoDepth("1.5")).toBeUndefined();
		expect(parseAutoDepth("later")).toBeUndefined();
	});
});

describe("autoSummary", () => {
	it("includes depth and optional source", () => {
		expect(autoSummary({ chainId: "c", depth: 2, maxDepth: 5, armed: true, createdAt: "now", updatedAt: "now" })).toBe(
			"Auto handover armed (2/5).",
		);
		expect(autoSummary({ chainId: "c", depth: 2, maxDepth: 5, armed: true, createdAt: "now", updatedAt: "now", source: "PLAN.md" })).toBe(
			"Auto handover armed (2/5) from PLAN.md.",
		);
	});
});

describe("inferAutoDepth", () => {
	it("infers depth from a configured source field file", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "handover-auto-"));
		await writeFile(join(cwd, "PLAN.md"), "- [ ] one\n- [ ] two\n");
		const context = ctx(cwd, "PLAN.md");

		await expect(inferAutoDepth(context, { promptContextFields: [{ name: "plan", prompt: "Plan?" }] })).resolves.toEqual({
			maxDepth: 2,
			source: "PLAN.md",
		});
		expect(context.ui.input).toHaveBeenCalledTimes(1);
	});

	it("falls back to explicit max depth when source inference fails", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "handover-auto-"));
		const context = ctx(cwd, "3");

		await expect(inferAutoDepth(context, { promptContextFields: [] })).resolves.toEqual({ maxDepth: 3 });
	});

	it("notifies and cancels when explicit max depth is invalid", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "handover-auto-"));
		const context = ctx(cwd, "invalid");

		await expect(inferAutoDepth(context, { promptContextFields: [] })).resolves.toBeUndefined();
		expect(context.ui.notify).toHaveBeenCalledWith("Auto handover max depth must be a positive integer", "error");
	});

	it("returns undefined when input is cancelled", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "handover-auto-"));
		await mkdir(join(cwd, "nested"));
		const context = ctx(cwd, undefined);

		await expect(inferAutoDepth(context, { promptContextFields: [{ name: "plan", prompt: "Plan?" }] })).resolves.toBeUndefined();
	});
});
