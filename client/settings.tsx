import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { RpcOutput } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { worktreeTrustRpc } from "../shared/rpc";
import { worktreeSettings } from "../shared/settings";

const LABEL = "Allow identical .envrc in new worktrees";
const HINT = "Runs direnv allow on a worktree's .envrc when it matches the allowed .envrc in the main checkout.";

export function WorktreeSettings(_props: PluginSurfaceProps) {
  const settings = useSettings(worktreeSettings);
  const getTrust = useRpc(worktreeTrustRpc);
  const [trust, setTrust] = useState<RpcOutput<typeof worktreeTrustRpc> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getTrust({})
      .then((next) => live && setTrust(next))
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      live = false;
    };
  }, [getTrust]);

  return (
    <SettingsSection title="Worktrees">
      <SettingsCard>{row()}</SettingsCard>
    </SettingsSection>
  );

  function row() {
    if (error) return <SettingsRow label={LABEL} error={error} />;
    if (!trust) return <SettingsRow label={LABEL} hint="Loading…" />;
    // The daemon's environment wins over the saved setting, so the toggle only reports it.
    if (trust.fromVariable) {
      return (
        <SettingsSwitch
          label={LABEL}
          hint="Set by PASEO_DIRENV_TRUST_WORKTREES on this host."
          value={trust.trustWorktrees}
          onValueChange={() => undefined}
          disabled
        />
      );
    }
    switch (settings.status) {
      case "loading":
        return <SettingsRow label={LABEL} hint="Loading…" />;
      case "error":
        return <SettingsRow label={LABEL} error={settings.error} />;
      case "invalid":
        return (
          <SettingsAction
            label={LABEL}
            error={`The saved setting is invalid, so worktrees inherit trust. ${settings.error}`}
            actionLabel="Reset"
            onPress={() => void settings.reset()}
            disabled={settings.saving}
          />
        );
      case "ready":
        return (
          <SettingsSwitch
            label={LABEL}
            hint={HINT}
            error={settings.saveError}
            value={settings.values.trustWorktrees}
            onValueChange={(trustWorktrees) => void settings.save({ ...settings.values, trustWorktrees }, settings.revision)}
            disabled={settings.saving}
          />
        );
    }
  }
}
