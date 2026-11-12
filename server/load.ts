import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  cleanProcessEnv,
  inheritsTrust,
  mainCheckoutEnvrc,
  parseExport,
  parseStatus,
  type FoundRC,
} from "./direnv";

export type AgentState =
  | { state: "none" }
  | { state: "loaded" | "blocked" | "denied"; path: string }
  | { state: "error"; path: string | null; message: string };

export interface LoadResult {
  state: AgentState;
  env: Record<string, string>;
}

/** Loads the direnv environment for `cwd`, inheriting trust from the main checkout of a worktree. */
export async function loadEnvironment(cwd: string, signal: AbortSignal): Promise<LoadResult> {
  const status = await direnvStatus(cwd, signal);
  if (!status) return { state: { state: "none" }, env: {} };
  if (status.allowed === "denied") return { state: { state: "denied", path: status.path }, env: {} };
  if (status.allowed === "not-allowed" && !(await inheritTrust(cwd, status.path, signal))) {
    return { state: { state: "blocked", path: status.path }, env: {} };
  }
  const env = parseExport(await run("direnv", ["export", "json"], cwd, signal));
  return { state: { state: "loaded", path: status.path }, env };
}

/** Runs `direnv allow` on `envrcPath` from its own directory. */
export async function allowEnvrc(envrcPath: string, signal?: AbortSignal): Promise<void> {
  await run("direnv", ["allow", envrcPath], path.dirname(envrcPath), signal);
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function direnvStatus(cwd: string, signal: AbortSignal): Promise<FoundRC | null> {
  const status = parseStatus(await run("direnv", ["status", "--json"], cwd, signal));
  return status && { ...status, path: await realpath(status.path) };
}

/**
 * A worktree's `.envrc` is allowed without a prompt when the `.envrc` at the same
 * relative path in the main checkout is allowed and byte-identical.
 */
async function inheritTrust(cwd: string, envrcPath: string, signal: AbortSignal): Promise<boolean> {
  let gitCommonDir: string;
  let worktreeRoot: string;
  try {
    const stdout = await run(
      "git",
      ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"],
      cwd,
      signal,
    );
    const [commonDir, toplevel] = stdout.trim().split("\n");
    if (!commonDir || !toplevel) return false;
    gitCommonDir = await realpath(commonDir);
    worktreeRoot = await realpath(toplevel);
  } catch (error) {
    // Outside a git repository there is no main checkout to inherit from.
    if (!(error instanceof RunError) || error.reason !== "failed") throw error;
    return false;
  }
  const mainEnvrc = mainCheckoutEnvrc({ worktreeRoot, gitCommonDir, envrcPath });
  if (!mainEnvrc) return false;
  const mainContents = await readFile(mainEnvrc).catch(() => null);
  if (!mainContents) return false;
  const worktreeContents = await readFile(envrcPath);
  const mainStatus = await direnvStatus(path.dirname(mainEnvrc), signal);
  if (!inheritsTrust({ mainStatus, mainEnvrc, mainContents, worktreeContents })) return false;
  await allowEnvrc(envrcPath, signal);
  return true;
}

function run(file: string, args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, env: cleanProcessEnv(process.env), signal, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (signal?.aborted) {
          return reject(new RunError("aborted", `${file} ${args[0]} was stopped: ${abortReason(signal)}`));
        }
        if (error.code === "ENOENT") {
          return reject(
            new RunError("missing", `could not start ${file} in ${cwd}: not on the daemon's PATH, or the directory is missing`),
          );
        }
        const detail = stderr.trim().split("\n").filter(Boolean).at(-1) ?? error.message;
        reject(new RunError("failed", `${file} ${args.join(" ")} failed: ${detail}`));
      },
    );
  });
}

class RunError extends Error {
  readonly reason: "aborted" | "missing" | "failed";

  constructor(reason: RunError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

function abortReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.name === "TimeoutError") return "timed out";
  return reason instanceof Error ? reason.message : String(reason);
}
