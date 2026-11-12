import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SessionState = z.enum(["loaded", "blocked", "denied", "error", "none"]);
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
