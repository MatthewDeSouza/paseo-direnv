# paseo-direnv

paseo-direnv is a [Paseo](https://github.com/getpaseo/paseo) plugin that gives every agent the Paseo daemon starts
the direnv environment of the agent's own directory. It targets Paseo `0.15.3`
and direnv `2.38`.

## What it does

The plugin runs in the `agent.open.before` hook, which Paseo awaits before it
creates, resumes, refreshes or imports an agent. Opens that only read an agent's
history are skipped. The hook runs `direnv status
--json` in the agent's directory. When the `.envrc` there is allowed, it runs
`direnv export json` and merges the result into the agent's launch environment.
The agent therefore has the environment from its first command, for Codex and
Claude alike, since the variables travel with the launch request rather than
with the process directory.

A load that fails never stops the agent from opening. A missing `direnv` or
`git`, or an `.envrc` that exits with an error, leaves the environment unchanged,
and the composer shows a `direnv error` pill with the message.

A load that takes longer than 25 seconds also lets the agent open without the
environment, since Paseo fails an open that waits 30. This is typical of a first
`use flake`, which builds the devshell. The plugin keeps `direnv export` running
so the build completes, for up to 30 minutes, and the composer shows a
`direnv loading` pill. Agents opening in the same directory meanwhile share that
one export. When it finishes, the pill becomes `Reload with direnv`, which
reopens the agent with the environment. The reopen runs `direnv export` again,
which a cached devshell answers quickly. An `.envrc` that is slow on every run
returns to the loading pill each time.

When the `.envrc` is not allowed, the agent starts without it and the composer
shows an `.envrc blocked` pill. The pill opens the path and the full file. `Allow`
sends the SHA-256 of the text that was shown, and the daemon allows the file only
if it still has that hash. It then runs `direnv allow` and reloads the agent so
that it restarts with the environment. The daemon takes the path from its own
record of the agent and never from the client. `Deny` runs `direnv deny` under
the same hash check, and the agent keeps running without the environment.
direnv records a denial by path rather than by content, so a denied `.envrc`
stays denied after it changes and shows no pill until `direnv allow` clears it.

An agent keeps the environment it opened with. The plugin records the files
direnv watches, which are `.envrc`, its allow and deny records, and every file
named with `watch_file`. Once one of them changes, the composer shows a
`direnv changed` pill that reopens the agent with the new environment. The check
runs whenever the agent's status changes, such as at the end of a turn.

The plugin runs `direnv` and `git` from the daemon's `PATH` through `execFile`,
without a shell, and sends nothing off the machine.

## Trust in worktrees

direnv keys its allow list by path and content, so a new git worktree of an
allowed checkout starts out blocked. The plugin lets a worktree inherit trust
from its main checkout. It finds the main checkout with `git rev-parse
--git-common-dir` and takes the `.envrc` at the same path relative to the
repository root. When that file is allowed and byte-identical to the worktree's,
the plugin runs `direnv allow` on the worktree's file and loads it without a
prompt. Any difference in content, a main file that is not allowed, or a bare
repository with no main checkout leaves the worktree blocked.

## Limits

direnv trusts the text of `.envrc` alone. A file containing `use flake` stays
allowed while `flake.nix` changes beneath it, so a changed devshell loads with no
prompt. The same holds for any file an `.envrc` sources or evaluates.

The hook can add and replace variables in the launch environment but cannot
remove one. A variable that direnv unsets, which `direnv export json` reports as
`null`, stays at the value the daemon passes to the agent.

## Install

Enable plugins on the daemon, either with **Enable plugins** under **Settings →
Plugins** or by setting the root `pluginsEnabled` field of the daemon's
`config.json` to `true` and applying it:

```bash
paseo reload --json
```

Then install the plugin directory. A checkout of this repository works, and so
does the Nix package built from it, which holds only the files Paseo loads:

```bash
nix build
paseo plugin install "$(readlink -f result)"
paseo plugin ls
```

The daemon compiles the TypeScript sources when it loads them, so the
directory needs no build step and no `node_modules`.

## Development

`nix develop` provides Node 22, TypeScript, direnv and just. `just setup`
installs the SDK types from `package-lock.json`. `just typecheck` checks the
server and client projects, and `just test` runs the unit tests for the
parsing, worktree and merge logic in `server/direnv.ts`, and the integration
tests that run `server/load.ts` against real `direnv` and `git` in a scratch
directory with its own `XDG_DATA_HOME`. `just check` runs both
in the Nix sandbox through `nix flake check`, which is what CI runs on every
push and pull request for `x86_64-linux`, `aarch64-linux` and `aarch64-darwin`.
`just install` builds the package and installs it into the local daemon.

## Licence

MIT. See `LICENSE`.
