import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readFile } from "node:fs/promises";
import { mergeEnv } from "./server/direnv";
import {
  allowEnvrc,
  loadEnvironment,
  sha256,
  StillLoading,
  watchesChanged,
  type AgentState,
} from "./server/load";
import { allowRpc, reloadRpc, statusRpc } from "./shared/rpc";

// Ends before Paseo's own 30 second limit on agent.open.before.
const LOAD_TIMEOUT_MS = 25_000;

export default function contribute(server: PluginServerContext) {
  const states = new Map<string, AgentState>();

  const removeHook = server.addHook("agent.open.before", async ({ request }, context) => {
    // Paseo opens an archived agent only to read its history, which runs nothing,
    // and its directory may already be gone with its worktree.
    if (request.purpose === "history") return request;
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(LOAD_TIMEOUT_MS)]);
    try {
      const { state, env } = await loadEnvironment(request.cwd, signal);
      states.set(request.agentId, state);
      if (state.state !== "loaded") return request;
      return { ...request, env: mergeEnv(request.env, env) };
    } catch (error) {
      if (error instanceof StillLoading) {
        const { agentId } = request;
        const path = error.path;
        console.error(`direnv is still loading ${path} for agent ${agentId}, which opens without it`);
        states.set(agentId, { state: "loading", path });
        // Only a state this load set is moved on. A later open may have replaced it.
        const current = () => {
          const state = states.get(agentId);
          return state?.state === "loading" && state.path === path;
        };
        error.done.then(
          () => {
            if (current()) states.set(agentId, { state: "ready", path });
          },
          (failure: unknown) => {
            if (current()) states.set(agentId, { state: "error", path, message: describe(failure) });
          },
        );
        return request;
      }
      const message = describe(error);
      console.error(`direnv load failed for agent ${request.agentId} in ${request.cwd}: ${message}`);
      states.set(request.agentId, { state: "error", path: null, message });
      return request;
    }
  });

  const removeCloseHook = server.addHook("agent.close.after", async ({ agent }) => {
    states.delete(agent.id);
  });

  // A loaded environment is reported stale once a file direnv watches has changed.
  async function current(agentId: string): Promise<AgentState | { state: "stale"; path: string }> {
    const state = states.get(agentId) ?? { state: "none" };
    if (state.state !== "loaded") return state;
    const changed = await watchesChanged(state.watches).catch(() => false);
    return changed ? { state: "stale", path: state.path } : state;
  }

  server.handle(statusRpc, async ({ agentId }) => {
    const state = await current(agentId);
    const result = {
      state: state.state,
      path: "path" in state ? state.path : null,
      message: state.state === "error" ? state.message : null,
      contents: null as string | null,
      sha256: null as string | null,
    };
    if (state.state !== "blocked") return result;
    try {
      const bytes = await readFile(state.path);
      return { ...result, contents: new TextDecoder().decode(bytes), sha256: sha256(bytes) };
    } catch (error) {
      return { ...result, state: "error" as const, message: `cannot read ${state.path}: ${describe(error)}` };
    }
  });

  server.handle(allowRpc, async ({ agentId, sha256: shown }, { paseo }) => {
    // The path comes from the server's own state, never from the client.
    const state = states.get(agentId);
    if (state?.state !== "blocked") {
      return { ok: false as const, message: "This agent has no blocked .envrc." };
    }
    try {
      const current = sha256(await readFile(state.path));
      if (current !== shown) {
        return { ok: false as const, message: `${state.path} changed after it was shown. Reopen it and read it again.` };
      }
      await allowEnvrc(state.path);
      await paseo.agents.ref(agentId).reload();
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describe(error) };
    }
  });

  server.handle(reloadRpc, async ({ agentId }, { paseo }) => {
    const state = (await current(agentId)).state;
    if (state !== "ready" && state !== "stale") {
      return { ok: false as const, message: "This agent has no environment waiting to load." };
    }
    try {
      await paseo.agents.ref(agentId).reload();
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describe(error) };
    }
  });

  return () => {
    removeHook();
    removeCloseHook();
    states.clear();
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
