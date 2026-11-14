import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SessionState = z.enum(["loaded", "blocked", "denied", "error", "none", "loading", "ready", "stale"]);
export type SessionState = z.infer<typeof SessionState>;

export const statusRpc = defineRpc({
  name: "direnv.status",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    state: SessionState,
    path: z.string().nullable(),
    message: z.string().nullable(),
    // Present only for a blocked state.
    contents: z.string().nullable(),
    sha256: z.string().nullable(),
  }),
});

export const allowRpc = defineRpc({
  name: "direnv.allow",
  input: z.object({
    agentId: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
});

// Reopens an agent whose environment became ready after its open went ahead
// without it, or whose watched files changed after it loaded.
export const reloadRpc = defineRpc({
  name: "direnv.reload",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
});

// Denies a blocked .envrc by the hash the client showed. direnv records a denial
// by path, so it holds after the file changes until direnv allow clears it.
export const denyRpc = defineRpc({
  name: "direnv.deny",
  input: z.object({
    agentId: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
});

// The effective worktree trust on the daemon, which the client cannot work out
// itself since it cannot see the daemon's environment.
export const worktreeTrustRpc = defineRpc({
  name: "direnv.worktree-trust",
  input: z.object({}),
  output: z.object({ trustWorktrees: z.boolean(), fromVariable: z.boolean() }),
});
