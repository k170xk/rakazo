import { Trans, useLingui } from "@lingui/react/macro";
import type { DeploymentSettings } from "@rakazo/contracts";
import { useEffect, useMemo, useState } from "react";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { rpc } from "../lib/rpc";

export function DeploymentOwnerSettings() {
  const { t } = useLingui();
  const [settings, setSettings] = useState<DeploymentSettings | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [provider, setProvider] = useState("openai");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [allowlist, setAllowlist] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"key" | "signups" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const providers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of catalog) {
      if (!seen.has(entry.provider)) seen.set(entry.provider, entry.providerName ?? entry.provider);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [catalog]);

  const models = useMemo(
    () => catalog.filter((entry) => entry.provider === provider && !entry.placeholder),
    [catalog, provider],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([rpc.deployment.get(), rpc.models.list()])
      .then(([nextSettings, nextCatalog]) => {
        if (cancelled) return;
        applySettings(nextSettings, nextCatalog);
        setCatalog(nextCatalog);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(t`Could not load server settings`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  function applySettings(next: DeploymentSettings, nextCatalog: ModelCatalogEntry[]) {
    setSettings(next);
    const nextProvider =
      next.defaultProvider && nextCatalog.some((entry) => entry.provider === next.defaultProvider)
        ? next.defaultProvider
        : nextCatalog.some((entry) => entry.provider === "openai")
          ? "openai"
          : (nextCatalog[0]?.provider ?? "openai");
    setProvider(nextProvider);
    const providerModels = nextCatalog.filter((entry) => entry.provider === nextProvider);
    setModelId(
      next.defaultModel && providerModels.some((entry) => entry.id === next.defaultModel)
        ? next.defaultModel
        : (providerModels[0]?.id ?? ""),
    );
    setSignupsEnabled(next.signupsEnabled);
    setAllowlist(next.signupAllowlist.join("\n"));
  }

  async function saveKey() {
    if (pending) return;
    setPending("key");
    setError(null);
    setNotice(null);
    try {
      const next = await rpc.deployment.update({
        modelProvider: provider,
        modelId: modelId || undefined,
        ...(apiKey.trim() ? { modelApiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      applySettings(next, catalog);
      setNotice(apiKey.trim() ? t`Server key saved.` : t`Default model saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save the server key`);
    } finally {
      setPending(null);
    }
  }

  async function saveSignups() {
    if (pending) return;
    setPending("signups");
    setError(null);
    setNotice(null);
    try {
      const next = await rpc.deployment.update({
        signupsEnabled,
        signupAllowlist: allowlist
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      applySettings(next, catalog);
      setNotice(t`Signups updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not update signups`);
    } finally {
      setPending(null);
    }
  }

  if (loading) return null;

  return (
    <section
      data-testid="deployment-owner-settings"
      className="mt-5 rounded-[14px] border border-[#E2E8F0] bg-[#ffffff] px-4 py-4"
    >
      <h3 className="text-[15px] font-medium text-[#020817]">
        <Trans>Server model</Trans>
      </h3>
      <p className="mt-2 text-[13px] text-[#64748B]">
        {settings?.hasDeploymentModelCredential ? (
          <Trans>Staff use this key unless they add their own.</Trans>
        ) : (
          <Trans>Set one key for everyone on this server.</Trans>
        )}
      </p>
      <label className="mt-3 block text-[12.5px] text-[#64748B]">
        <Trans>Provider</Trans>
        <select
          value={provider}
          onChange={(event) => {
            const next = event.target.value;
            setProvider(next);
            const first = catalog.find((entry) => entry.provider === next && !entry.placeholder);
            setModelId(first?.id ?? "");
          }}
          className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-2 text-[14px] text-[#020817]"
        >
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-[12.5px] text-[#64748B]">
        <Trans>Model</Trans>
        <select
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-2 text-[14px] text-[#020817]"
        >
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-[12.5px] text-[#64748B]">
        <Trans>API key</Trans>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={
            settings?.hasDeploymentModelCredential ? t`Key is set. Paste to replace.` : t`Paste key`
          }
          onChange={(event) => setApiKey(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-2.5 py-2 text-[14px] text-[#020817]"
        />
      </label>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => void saveKey()}
        className="mt-3 rounded-full bg-[#E2E8F0] px-4 py-2 text-[13.5px] font-medium text-[#020817] disabled:opacity-40"
      >
        <Trans>Save model</Trans>
      </button>

      <h3 className="mt-6 text-[15px] font-medium text-[#020817]">
        <Trans>Signups</Trans>
      </h3>
      <label className="mt-3 flex items-center gap-2 text-[14px] text-[#334155]">
        <input
          type="checkbox"
          checked={signupsEnabled}
          onChange={(event) => setSignupsEnabled(event.target.checked)}
        />
        <Trans>Allow new accounts</Trans>
      </label>
      <label className="mt-3 block text-[12.5px] text-[#64748B]">
        <Trans>Allowed emails</Trans>
        <textarea
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-2.5 py-2 text-[14px] text-[#020817]"
        />
      </label>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => void saveSignups()}
        className="mt-3 rounded-full bg-[#E2E8F0] px-4 py-2 text-[13.5px] font-medium text-[#020817] disabled:opacity-40"
      >
        <Trans>Save signups</Trans>
      </button>
      {notice ? <p className="mt-3 text-[12.5px] text-[#334155]">{notice}</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-[#E65707]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
