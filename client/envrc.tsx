import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { RpcOutput } from "@getpaseo/plugin";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { allowRpc, denyRpc, statusRpc } from "../shared/rpc";

type Status = RpcOutput<typeof statusRpc>;

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * Builds the popover body for the composer pill. `onDecided` runs after the
 * server has allowed the file and reloaded the agent, or has denied the file.
 */
export function createEnvrcContent(
  onDecided: (agentId: string) => void,
): ComponentType<PluginButtonContentProps> {
  return function EnvrcContent(props: PluginButtonContentProps) {
    const { theme, close } = props;
    const agentId = props.context === "agent" ? props.agentId : null;
    const getStatus = useRpc(statusRpc);
    const allow = useRpc(allowRpc);
    const deny = useRpc(denyRpc);
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<"allow" | "deny" | null>(null);
    const busy = pending !== null;

    useEffect(() => {
      if (!agentId) return;
      let live = true;
      getStatus({ agentId })
        .then((next) => live && setStatus(next))
        .catch((reason: unknown) => live && setError(describe(reason)));
      return () => {
        live = false;
      };
    }, [agentId, getStatus]);

    const styles = useMemo(
      () => ({
        body: { gap: 12 },
        label: { color: theme.colors.foregroundMuted },
        text: { color: theme.colors.foreground },
        danger: { color: theme.colors.statusDanger },
        file: {
          maxHeight: 360,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
        },
        code: { color: theme.colors.foreground, fontFamily: MONOSPACE, fontSize: 12, padding: 10 },
        row: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 8 },
        cancel: {
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        allow: {
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 6,
          backgroundColor: theme.colors.accent,
          opacity: busy ? 0.6 : 1,
        },
        allowText: { color: theme.colors.accentForeground },
      }),
      [theme, busy],
    );

    // Both decisions send the hash of the text on screen, so the server refuses a file that changed.
    async function decide(kind: "allow" | "deny"): Promise<void> {
      if (!agentId || !status?.sha256) return;
      setPending(kind);
      setError(null);
      try {
        const input = { agentId, sha256: status.sha256 };
        const result = kind === "allow" ? await allow(input) : await deny(input);
        if (result.ok) {
          onDecided(agentId);
          close();
          return;
        }
        setError(result.message);
      } catch (reason) {
        setError(describe(reason));
      } finally {
        setPending(null);
      }
    }

    if (!status) {
      return (
        <View style={styles.body}>
          <Text style={error ? styles.danger : styles.label}>{error ?? "Loading…"}</Text>
        </View>
      );
    }

    if (status.state === "error") {
      return (
        <View style={styles.body}>
          <Text style={styles.label}>direnv could not load the environment for this agent.</Text>
          <Text selectable style={styles.danger}>
            {status.message}
          </Text>
        </View>
      );
    }

    if (status.state === "loading") {
      return (
        <View style={styles.body}>
          <Text style={styles.label}>
            direnv is still loading the environment, often because a first use flake is building the
            devshell. The agent runs without it for now. When the load finishes, this pill offers Reload.
          </Text>
          <Text selectable style={styles.text}>
            {status.path}
          </Text>
        </View>
      );
    }

    if (status.state !== "blocked" || status.contents === null) {
      return (
        <View style={styles.body}>
          <Text style={styles.label}>The environment is no longer blocked.</Text>
        </View>
      );
    }

    return (
      <View style={styles.body}>
        <Text style={styles.label}>
          This .envrc is not allowed. The agent runs without its environment until you allow it.
        </Text>
        <Text selectable style={styles.text}>
          {status.path}
        </Text>
        <ScrollView style={styles.file}>
          <ScrollView horizontal>
            <Text selectable style={styles.code}>
              {status.contents}
            </Text>
          </ScrollView>
        </ScrollView>
        {error ? <Text style={styles.danger}>{error}</Text> : null}
        <Text style={styles.label}>
          Deny keeps this path from loading, even after the file changes, until you run direnv allow.
        </Text>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
            <Text style={styles.text}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void decide("deny")}
            style={styles.cancel}
          >
            <Text style={styles.danger}>{pending === "deny" ? "Denying…" : "Deny"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void decide("allow")}
            style={styles.allow}
          >
            <Text style={styles.allowText}>{pending === "allow" ? "Allowing…" : "Allow"}</Text>
          </Pressable>
        </View>
      </View>
    );
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
