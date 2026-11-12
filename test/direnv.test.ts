import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanProcessEnv,
  inheritsTrust,
  mainCheckoutEnvrc,
  mergeEnv,
  parseExport,
  parseStatus,
} from "../server/direnv.ts";

const status = (foundRC: unknown) =>
  JSON.stringify({ config: { ConfigDir: "/c", SelfPath: "/bin/direnv" }, state: { foundRC, loadedRC: null } });

describe("parseStatus", () => {
  it("returns null without an .envrc", () => {
    assert.equal(parseStatus(status(null)), null);
  });

  it("maps the allowed codes", () => {
    assert.deepEqual(parseStatus(status({ allowed: 0, path: "/r/.envrc" })), { path: "/r/.envrc", allowed: "allowed" });
    assert.equal(parseStatus(status({ allowed: 1, path: "/r/.envrc" }))?.allowed, "not-allowed");
    assert.equal(parseStatus(status({ allowed: 2, path: "/r/.envrc" }))?.allowed, "denied");
  });

  it("rejects unknown codes and malformed output", () => {
    assert.throws(() => parseStatus(status({ allowed: 3, path: "/r/.envrc" })), /unknown allowed 3/);
    assert.throws(() => parseStatus(status({ allowed: "0", path: "/r/.envrc" })), /malformed/);
    assert.throws(() => parseStatus("{}"), /no state/);
    assert.throws(() => parseStatus("not json"));
  });
});

describe("parseExport", () => {
  it("treats empty output as no change", () => {
    assert.deepEqual(parseExport(""), {});
    assert.deepEqual(parseExport("\n"), {});
  });

  it("keeps strings and drops unset variables", () => {
    assert.deepEqual(parseExport(JSON.stringify({ FOO: "1", GONE: null, EMPTY: "" })), { FOO: "1", EMPTY: "" });
  });

  it("rejects a non-object", () => {
    assert.throws(() => parseExport("[]"), /not an object/);
  });
});

describe("mergeEnv", () => {
  it("lets direnv values win over the input", () => {
    assert.deepEqual(mergeEnv({ A: "input", B: "kept" }, { A: "direnv", C: "new" }), {
      A: "direnv",
      B: "kept",
      C: "new",
    });
  });
});

describe("mainCheckoutEnvrc", () => {
  it("maps a worktree .envrc to the same relative path in the main checkout", () => {
    assert.equal(
      mainCheckoutEnvrc({ worktreeRoot: "/wt/feature", gitCommonDir: "/src/repo/.git", envrcPath: "/wt/feature/sub/.envrc" }),
      "/src/repo/sub/.envrc",
    );
  });

  it("returns null for the main checkout itself", () => {
    assert.equal(
      mainCheckoutEnvrc({ worktreeRoot: "/src/repo", gitCommonDir: "/src/repo/.git", envrcPath: "/src/repo/.envrc" }),
      null,
    );
  });

  it("returns null for a bare repository", () => {
    assert.equal(
      mainCheckoutEnvrc({ worktreeRoot: "/wt/feature", gitCommonDir: "/src/repo.git", envrcPath: "/wt/feature/.envrc" }),
      null,
    );
  });

  it("returns null for an .envrc above the worktree", () => {
    assert.equal(
      mainCheckoutEnvrc({ worktreeRoot: "/wt/feature", gitCommonDir: "/src/repo/.git", envrcPath: "/wt/.envrc" }),
      null,
    );
    assert.equal(
      mainCheckoutEnvrc({ worktreeRoot: "/wt/feature", gitCommonDir: "/src/repo/.git", envrcPath: "/wt/feature-2/.envrc" }),
      null,
    );
  });
});

describe("inheritsTrust", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const mainEnvrc = "/src/repo/.envrc";
  const allowed = { path: mainEnvrc, allowed: "allowed" as const };

  it("inherits from an allowed, identical file", () => {
    assert.equal(
      inheritsTrust({ mainStatus: allowed, mainEnvrc, mainContents: bytes("use flake\n"), worktreeContents: bytes("use flake\n") }),
      true,
    );
  });

  it("refuses a file that differs by one byte", () => {
    assert.equal(
      inheritsTrust({ mainStatus: allowed, mainEnvrc, mainContents: bytes("use flake\n"), worktreeContents: bytes("use flake \n") }),
      false,
    );
    assert.equal(
      inheritsTrust({ mainStatus: allowed, mainEnvrc, mainContents: bytes("use flake\n"), worktreeContents: bytes("use flakf\n") }),
      false,
    );
  });

  it("refuses when the main file is not allowed, missing, or another file", () => {
    const same = { mainContents: bytes("x"), worktreeContents: bytes("x"), mainEnvrc };
    assert.equal(inheritsTrust({ ...same, mainStatus: { path: mainEnvrc, allowed: "not-allowed" } }), false);
    assert.equal(inheritsTrust({ ...same, mainStatus: { path: mainEnvrc, allowed: "denied" } }), false);
    assert.equal(inheritsTrust({ ...same, mainStatus: null }), false);
    assert.equal(inheritsTrust({ ...same, mainStatus: { path: "/src/.envrc", allowed: "allowed" } }), false);
    assert.equal(inheritsTrust({ ...same, mainStatus: allowed, mainContents: null }), false);
  });
});

describe("cleanProcessEnv", () => {
  it("drops direnv load state and keeps settings", () => {
    assert.deepEqual(
      cleanProcessEnv({ PATH: "/bin", DIRENV_DIR: "-/x", DIRENV_DIFF: "d", DIRENV_FILE: "f", DIRENV_WATCHES: "w", DIRENV_CONFIG: "/c" }),
      { PATH: "/bin", DIRENV_CONFIG: "/c" },
    );
  });
});
