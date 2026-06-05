import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getGlobalHandoverConfigPath, type HandoverConfig } from "./config.js";

export type EditableHandoverConfig = Partial<HandoverConfig> & Record<string, unknown>;

export type EditableSettingsScope = "global" | "project";

export type LoadEditableSettingsTargetOptions = {
	jsonPath: string;
	markdownPath?: string;
};

export type EditableSettingsConfigOptions = {
	globalConfigPath?: string;
};

export type LoadEditableSettingsTargetResult =
	| { ok: true; config: EditableHandoverConfig; projectRules?: string }
	| { ok: false; error: { kind: "invalid-json"; path: string; message: string } };

export type SaveEditableSettingsTargetOptions = {
	jsonPath: string;
	config: EditableHandoverConfig;
	markdownPath?: string;
	projectRules?: string;
};

export type SaveEditableSettingsTargetResult = { ok: true } | { ok: false; error: { kind: "invalid-json"; path: string; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonConfig(path: string): Promise<LoadEditableSettingsTargetResult> {
	try {
		const json = await readFile(path, "utf8");
		const parsed = JSON.parse(json);
		return { ok: true, config: isRecord(parsed) ? parsed : {} };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, config: {} };
		if (error instanceof SyntaxError) {
			return { ok: false, error: { kind: "invalid-json", path, message: error.message } };
		}
		throw error;
	}
}

async function readOptionalText(path: string | undefined): Promise<string | undefined> {
	if (!path) return undefined;
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export function getEditableSettingsTargetPaths(
	scope: EditableSettingsScope,
	cwd: string,
	options: EditableSettingsConfigOptions = {},
): LoadEditableSettingsTargetOptions {
	if (scope === "global") return { jsonPath: options.globalConfigPath ?? getGlobalHandoverConfigPath() };
	return { jsonPath: join(cwd, ".pi", "handover.json"), markdownPath: join(cwd, ".pi", "handover.md") };
}

export async function loadEditableSettingsTarget(
	options: LoadEditableSettingsTargetOptions,
): Promise<LoadEditableSettingsTargetResult> {
	const jsonResult = await readJsonConfig(options.jsonPath);
	if (!jsonResult.ok) return jsonResult;
	return { ok: true, config: jsonResult.config, projectRules: await readOptionalText(options.markdownPath) };
}

export async function loadEditableSettingsConfig(
	scope: EditableSettingsScope,
	cwd: string,
	options: EditableSettingsConfigOptions = {},
): Promise<LoadEditableSettingsTargetResult> {
	return loadEditableSettingsTarget(getEditableSettingsTargetPaths(scope, cwd, options));
}

export async function saveEditableSettingsTarget(
	options: SaveEditableSettingsTargetOptions,
): Promise<SaveEditableSettingsTargetResult> {
	const existing = await readJsonConfig(options.jsonPath);
	if (!existing.ok) return existing;
	await mkdir(dirname(options.jsonPath), { recursive: true });
	await writeFile(options.jsonPath, `${JSON.stringify({ ...existing.config, ...options.config }, null, 2)}\n`);
	if (options.markdownPath && options.projectRules !== undefined) {
		await mkdir(dirname(options.markdownPath), { recursive: true });
		await writeFile(options.markdownPath, options.projectRules);
	}
	return { ok: true };
}
