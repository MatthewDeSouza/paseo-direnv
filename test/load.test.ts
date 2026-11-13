// Runs server/load.ts against real direnv and git in a scratch directory.
// direnv keeps its allow and deny records under XDG_DATA_HOME, so each run starts with none.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { allowEnvrc, denyEnvrc, loadEnvironment, StillLoading, watchesChanged } from "../server/load.ts";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-direnv-")));
const HOOK_MS = 10_000;

before(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("DIRENV_")) delete process.env[key];
  process.env.HOME = root;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  process.env.XDG_CONFIG_HOME = path.join(root, "config");
  process.env.XDG_CACHE_HOME = path.join(root, "cache");
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

after(() => rmSync(root, { recursive: true, force: true }));

function directory(name: string, envrc?: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  if (envrc !== undefined) writeFileSync(path.join(dir, ".envrc"), envrc);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args], { cwd, stdio: "ignore" });
}

const load = (cwd: string, ms = HOOK_MS) => loadEnvironment(cwd, AbortSignal.timeout(ms));

describe("loadEnvironment", () => {
  it("reports none without an .envrc", async () => {
    assert.deepEqual(await load(directory("plain")), { state: { state: "none" }, env: {} });
  });

  it("blocks a new .envrc and loads it once allowed", async () => {
    const dir = directory("fresh", "export PASEO_DIRENV_TEST=fresh\n");
    const envrc = path.join(dir, ".envrc");
    assert.deepEqual(await load(dir), { state: { state: "blocked", path: envrc }, env: {} });

    await allowEnvrc(envrc);
    const { state, env } = await load(dir);
    assert.equal(state.state, "loaded");
    assert.equal(env.PASEO_DIRENV_TEST, "fresh");
    assert.ok(state.state === "loaded" && state.watches.some((watch) => watch.path === envrc));
  });

  it("keeps a denied .envrc denied after it changes", async () => {
    const dir = directory("denied", "export PASEO_DIRENV_TEST=denied\n");
    const envrc = path.join(dir, ".envrc");
    await denyEnvrc(envrc);
    assert.deepEqual(await load(dir), { state: { state: "denied", path: envrc }, env: {} });

    writeFileSync(envrc, "export PASEO_DIRENV_TEST=changed\n");
    assert.equal((await load(dir)).state.state, "denied");
  });
});

describe("worktree trust", () => {
  const contents = "export PASEO_DIRENV_TEST=main\n";
  let main: string;

  before(async () => {
    main = directory("repo", contents);
    git(main, "init", "--quiet", "--initial-branch=main");
    git(main, "add", ".envrc");
    git(main, "commit", "--quiet", "--no-gpg-sign", "--message=init");
    git(main, "worktree", "add", "--quiet", path.join(root, "wt-same"));
    git(main, "worktree", "add", "--quiet", path.join(root, "wt-diff"));
    git(main, "worktree", "add", "--quiet", path.join(root, "wt-blocked-main"));
  });

  it("leaves the worktree blocked while the main .envrc is not allowed", async () => {
    const dir = path.join(root, "wt-blocked-main");
    assert.equal((await load(dir)).state.state, "blocked");
  });

  it("inherits trust from an allowed, identical main .envrc", async () => {
    await allowEnvrc(path.join(main, ".envrc"));
    const { state, env } = await load(path.join(root, "wt-same"));
    assert.equal(state.state, "loaded");
    assert.equal(env.PASEO_DIRENV_TEST, "main");
  });

  it("blocks a worktree whose .envrc differs", async () => {
    const dir = path.join(root, "wt-diff");
    writeFileSync(path.join(dir, ".envrc"), contents.replace("main", "diff"));
    assert.equal((await load(dir)).state.state, "blocked");
  });
});

describe("slow exports", () => {
  it("throws StillLoading at the deadline and shares the export that keeps running", async () => {
    const dir = directory("slow", "sleep 2\nexport PASEO_DIRENV_TEST=slow\n");
    await allowEnvrc(path.join(dir, ".envrc"));

    const [first, second] = await Promise.allSettled([load(dir, 200), load(dir, 200)]);
    assert.ok(first.status === "rejected" && first.reason instanceof StillLoading);
    assert.ok(second.status === "rejected" && second.reason instanceof StillLoading);
    assert.equal(first.reason.path, path.join(dir, ".envrc"));
    assert.equal(first.reason.done, second.reason.done);

    const loaded = (await first.reason.done) as Record<string, string>;
    assert.equal(loaded.PASEO_DIRENV_TEST, "slow");
  });
});

describe("watchesChanged", () => {
  it("notices a change to a watch_file", async () => {
    const dir = directory("watched", "watch_file extra\nexport PASEO_DIRENV_TEST=watched\n");
    const extra = path.join(dir, "extra");
    writeFileSync(extra, "1");
    await allowEnvrc(path.join(dir, ".envrc"));
    const { state } = await load(dir);
    assert.ok(state.state === "loaded");
    assert.ok(state.watches.some((watch) => watch.path === extra));
    assert.equal(await watchesChanged(state.watches), false);

    const later = new Date(Date.now() + 60_000);
    utimesSync(extra, later, later);
    assert.equal(await watchesChanged(state.watches), true);
  });
});

describe("failures", () => {
  it("reports a missing direnv", async () => {
    const dir = directory("missing", "export PASEO_DIRENV_TEST=missing\n");
    const saved = process.env.PATH;
    process.env.PATH = directory("empty-bin");
    try {
      await assert.rejects(load(dir), /could not start direnv/);
    } finally {
      process.env.PATH = saved;
    }
  });
});
