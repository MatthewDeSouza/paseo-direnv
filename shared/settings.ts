import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// PASEO_DIRENV_TRUST_WORKTREES overrides this on a host that sets it.
export const worktreeSettings = defineSettings({
  id: "worktrees",
  scope: "host",
  version: 1,
  schema: z.object({ trustWorktrees: z.boolean().default(true) }),
});
