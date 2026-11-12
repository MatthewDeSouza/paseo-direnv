import type {
  PluginButton,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import { createEnvrcContent } from "./client/envrc";
import { statusRpc } from "./shared/rpc";

type Status = RpcOutput<typeof statusRpc>;

interface AgentRef {
  id: string;
  workspaceId?: string | null;
  status?: string;
}

export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  const seen = new Map<string, string | undefined>();
  const generations = new Map<string, number>();
  const lifetime = new AbortController();
  let stopped = false;

  function removePill(agentId: string): void {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  const Content = createEnvrcContent(removePill);

  function button(status: Status): PluginButton {
    const behavior = { kind: "popover" as const, Content };
    if (status.state === "blocked") {
      return { title: "Review the blocked .envrc", label: ".envrc blocked", icon: "ShieldAlert", behavior };
    }
    return { title: "direnv failed to load", label: "direnv error", icon: "TriangleAlert", behavior };
  }

  // Each open of the agent can change its state, so ask the server whenever the agent status moves.
  async function sync(agent: AgentRef): Promise<void> {
    const workspaceId = agent.workspaceId;
    if (stopped || !workspaceId) return;
    const generation = (generations.get(agent.id) ?? 0) + 1;
    generations.set(agent.id, generation);
    const status = await client.rpc(statusRpc, { agentId: agent.id });
    if (stopped || generations.get(agent.id) !== generation) return;
    if (status.state !== "blocked" && status.state !== "error") {
      removePill(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing) {
      existing.update(button(status));
      return;
    }
    pills.set(
      agent.id,
      client.addComposerPill({ id: "direnv", workspaceId, agentId: agent.id, button: button(status) }),
    );
  }

  function observe(agent: AgentRef): void {
    if (seen.has(agent.id) && seen.get(agent.id) === agent.status) return;
    seen.set(agent.id, agent.status);
    sync(agent).catch((error: unknown) => {
      if (!stopped) console.error(`paseo-direnv: status for agent ${agent.id} failed`, error);
    });
  }

  function forget(agentId: string): void {
    removePill(agentId);
    seen.delete(agentId);
    generations.delete(agentId);
  }

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          const present = new Set(entries.map(({ agent }) => agent.id));
          for (const agentId of [...seen.keys()]) if (!present.has(agentId)) forget(agentId);
          for (const { agent } of entries) observe(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") forget(update.agentId);
          else observe(update.agent);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("paseo-direnv: agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
