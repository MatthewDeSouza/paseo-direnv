// Pure logic for reading direnv output and applying the worktree trust rule.
// Nothing here touches the filesystem or starts a process.

import { inflateSync } from "node:zlib";

export type Allowed = "allowed" | "not-allowed" | "denied";

export interface FoundRC {
  path: string;
  allowed: Allowed;
}

const ALLOWED_CODES: Record<number, Allowed> = { 0: "allowed", 1: "not-allowed", 2: "denied" };

/** Parses `direnv status --json`. Returns `null` where no `.envrc` applies. */
export function parseStatus(stdout: string): FoundRC | null {
  const data: unknown = JSON.parse(stdout);
  if (!isRecord(data) || !isRecord(data.state)) {
    throw new Error("direnv status --json has no state object");
  }
  const found = data.state.foundRC;
  if (found === null || found === undefined) return null;
  if (!isRecord(found) || typeof found.path !== "string" || typeof found.allowed !== "number") {
    throw new Error("direnv status --json has a malformed foundRC");
  }
  const allowed = ALLOWED_CODES[found.allowed];
  if (!allowed) throw new Error(`direnv status --json reports unknown allowed ${found.allowed}`);
  return { path: found.path, allowed };
}

/**
 * Parses `direnv export json`. Empty output means no change. `null` values mark
 * variables direnv unsets, which an override map cannot express, so they are dropped.
 */
export function parseExport(stdout: string): Record<string, string> {
  if (stdout.trim() === "") return {};
  const data: unknown = JSON.parse(stdout);
  if (!isRecord(data)) throw new Error("direnv export json is not an object");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

/** A file direnv watches, as recorded when the environment was loaded. */
export interface Watch {
  path: string;
  /** Seconds since the epoch, or 0 for a file that did not exist. */
  modtime: number;
  exists: boolean;
}

/**
 * Decodes `DIRENV_WATCHES`, which is URL-safe base64 of zlib-compressed JSON.
 * It lists `.envrc`, its allow and deny records, and every `watch_file`.
 */
export function parseWatches(value: string): Watch[] {
  const data: unknown = JSON.parse(inflateSync(Buffer.from(value, "base64url")).toString("utf8"));
  if (!Array.isArray(data)) throw new Error("DIRENV_WATCHES is not a list");
  return data.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.modtime !== "number" ||
      typeof entry.exists !== "boolean"
    ) {
      throw new Error("DIRENV_WATCHES has a malformed entry");
    }
    return { path: entry.path, modtime: entry.modtime, exists: entry.exists };
  });
}

/** The environment is stale once any watched file appeared, vanished, or changed its modification time. */
export function isStale(recorded: Watch[], current: Watch[]): boolean {
  const now = new Map(current.map((watch) => [watch.path, watch]));
  return recorded.some((watch) => {
    const seen = now.get(watch.path);
    if (!seen) return true;
    if (seen.exists !== watch.exists) return true;
    return watch.exists && seen.modtime !== watch.modtime;
  });
}

/** Merges the direnv values over the hook's input env. */
export function mergeEnv(
  input: Record<string, string>,
  loaded: Record<string, string>,
): Record<string, string> {
  return { ...input, ...loaded };
}

/**
 * Finds the `.envrc` in the main checkout that a worktree's `.envrc` corresponds to.
 * All paths must be absolute and canonical. Returns `null` when there is no main
 * checkout to inherit from: a bare repository, the main checkout itself, or an
 * `.envrc` outside the worktree.
 */
export function mainCheckoutEnvrc(input: {
  worktreeRoot: string;
  gitCommonDir: string;
  envrcPath: string;
}): string | null {
  const { worktreeRoot, gitCommonDir, envrcPath } = input;
  if (basename(gitCommonDir) !== ".git") return null;
  const mainRoot = dirname(gitCommonDir);
  if (mainRoot === worktreeRoot) return null;
  const prefix = worktreeRoot.endsWith("/") ? worktreeRoot : `${worktreeRoot}/`;
  if (!envrcPath.startsWith(prefix)) return null;
  return `${mainRoot}/${envrcPath.slice(prefix.length)}`;
}

/** The worktree inherits trust only from an allowed, byte-identical main `.envrc`. */
export function inheritsTrust(input: {
  mainStatus: FoundRC | null;
  mainEnvrc: string;
  mainContents: Uint8Array | null;
  worktreeContents: Uint8Array;
}): boolean {
  const { mainStatus, mainEnvrc, mainContents, worktreeContents } = input;
  if (!mainStatus || mainStatus.path !== mainEnvrc || mainStatus.allowed !== "allowed") {
    return false;
  }
  if (!mainContents || mainContents.length !== worktreeContents.length) return false;
  return mainContents.every((byte, index) => byte === worktreeContents[index]);
}

const DIRENV_STATE = new Set(["DIRENV_DIR", "DIRENV_FILE", "DIRENV_DIFF", "DIRENV_WATCHES"]);

/**
 * Drops direnv's loaded-state variables so a daemon started inside a direnv shell
 * does not make direnv diff against that shell. Settings such as `DIRENV_CONFIG` stay.
 */
export function cleanProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!DIRENV_STATE.has(key)) clean[key] = value;
  }
  return clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}

export const TRUST_WORKTREES_VARIABLE = "PASEO_DIRENV_TRUST_WORKTREES";

export interface WorktreeTrust {
  trustWorktrees: boolean;
  /** True when `PASEO_DIRENV_TRUST_WORKTREES` decided the value. */
  fromVariable: boolean;
  /** True when the variable holds a value other than `1` or `0`. */
  invalidVariable: boolean;
}

/**
 * Decides whether a worktree may inherit trust. A set variable wins, with `1`
 * on and any other value off. Without it the host setting applies once it
 * reads as `ready`, and otherwise trust stays on.
 */
export function worktreeTrust(
  variable: string | undefined,
  setting: { status: "ready"; values: { trustWorktrees: boolean } } | { status: string } | null,
): WorktreeTrust {
  if (variable !== undefined) {
    return { trustWorktrees: variable === "1", fromVariable: true, invalidVariable: variable !== "1" && variable !== "0" };
  }
  const trustWorktrees = setting !== null && "values" in setting ? setting.values.trustWorktrees : true;
  return { trustWorktrees, fromVariable: false, invalidVariable: false };
}
