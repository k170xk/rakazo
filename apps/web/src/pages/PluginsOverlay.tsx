import { Trans, useLingui } from "@lingui/react/macro";
import type { CapabilityInstall, ConnectionCatalogItem, McpServer } from "@rakazo/contracts";
import {
  abortableDelay,
  buildFeaturedConnectorTiles,
  deriveMcpSlug,
  EMPTY_PLUGIN_CATALOG_MESSAGE,
  matchFeaturedConnectorId,
  parseMcpEnvLines,
} from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

type SourceKind = "treg" | "mcp" | "api";

function itemKey(item: Pick<ConnectionCatalogItem, "connectorId" | "slug">) {
  return `${item.connectorId}:${item.slug}`;
}

function markConnected(
  items: ConnectionCatalogItem[],
  connectorId: string,
  slug: string,
  connected: boolean,
) {
  return items.map((entry) =>
    entry.connectorId === connectorId && entry.slug === slug ? { ...entry, connected } : entry,
  );
}

export function PluginsOverlay({
  onClose,
  onOpenMcp,
  activeBotId,
}: {
  onClose: () => void;
  onOpenMcp?: () => void;
  activeBotId?: string;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>([]);
  const [sources, setSources] = useState<CapabilityInstall[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"streamable_http" | "stdio">("streamable_http");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpEnvText, setMcpEnvText] = useState("");
  const [credential, setCredential] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "header">("bearer");
  const [authName, setAuthName] = useState("x-api-key");
  const [pending, setPending] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const connectionAttempt = useRef<AbortController | null>(null);

  async function refresh() {
    const [items, installs, servers] = await Promise.all([
      rpc.connections.catalog({}),
      rpc.capabilities.list(),
      rpc.mcp.servers.list(),
    ]);
    setCatalog(items);
    setSources(installs.filter((install) => install.kind === "mcp" || install.kind === "api"));
    setMcpServers(servers);
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setCatalogError(err instanceof Error ? err.message : t`Could not load integrations`),
      )
      .finally(() => setLoading(false));
    return () => connectionAttempt.current?.abort();
  }, []);

  const featuredTiles = useMemo(() => buildFeaturedConnectorTiles(catalog), [catalog]);
  const showFeatured = !query.trim();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scoped = showFeatured
      ? catalog.filter(
          (item) =>
            matchFeaturedConnectorId(item.slug) === null &&
            matchFeaturedConnectorId(item.name) === null,
        )
      : catalog;
    if (!needle) return scoped;
    return scoped.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.slug.toLowerCase().includes(needle) ||
        item.connectorId.toLowerCase().includes(needle),
    );
  }, [catalog, query, showFeatured]);

  async function notifyAppConnected(item: ConnectionCatalogItem) {
    if (!activeBotId) return;
    await rpc.onboarding
      .appConnected({ botId: activeBotId, provider: item.slug })
      .catch(() => undefined);
  }

  function setItemConnected(item: ConnectionCatalogItem, connected: boolean) {
    setCatalog((prev) => markConnected(prev, item.connectorId, item.slug, connected));
  }

  async function connect(item: ConnectionCatalogItem) {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setCatalogError(null);
    const key = itemKey(item);
    setPending(key);
    try {
      const started = await rpc.connections.begin({
        connectorId: item.connectorId,
        provider: item.slug,
        displayName: item.name,
      });
      if (started.authorizationUrl)
        window.open(started.authorizationUrl, "_blank", "noopener,noreferrer");
      if (item.noAuth && !started.authorizationUrl) {
        if (controller.signal.aborted) return;
        setItemConnected(item, true);
        void notifyAppConnected(item);
        return;
      }
      for (let i = 0; i < 45; i += 1) {
        if (controller.signal.aborted) return;
        const row = await rpc.connections
          .complete({ connectionId: started.connectionId })
          .catch(() => undefined);
        if (row?.status === "connected") {
          if (controller.signal.aborted) return;
          setItemConnected(item, true);
          void notifyAppConnected(item);
          return;
        }
        await abortableDelay(2_000, controller.signal);
      }
      if (controller.signal.aborted) return;
      setCatalogError(
        t`Connection to ${item.name} is still pending. You can close this and check again.`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setCatalogError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setPending(null);
      }
    }
  }

  async function revoke(item: ConnectionCatalogItem) {
    setCatalogError(null);
    const key = itemKey(item);
    setPending(key);
    try {
      const rows = await rpc.connections.list();
      const matches = rows.filter(
        (entry) => entry.connectorId === item.connectorId && entry.provider === item.slug,
      );
      const row =
        matches.find((entry) => entry.status === "connected") ??
        matches.find((entry) => entry.status === "pending") ??
        matches.find((entry) => entry.status === "error");
      if (!row) throw new Error(t`No connection record found for ${item.name}.`);
      await rpc.connections.revoke({ connectionId: row.id });
      setItemConnected(item, false);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not revoke connection`);
    } finally {
      setPending(null);
    }
  }

  function beginSource(kind: SourceKind) {
    setSourceKind(kind);
    setSourceError(null);
    setSourceName(kind === "treg" ? "Treg" : "");
    setSourceUrl(kind === "treg" ? "https://treg.to/mcp/" : "");
    setMcpTransport("streamable_http");
    setMcpCommand("");
    setMcpArgs("");
    setMcpEnvText("");
    setCredential("");
    setAuthType(kind === "treg" ? "bearer" : "none");
    setAuthName("x-api-key");
  }

  async function installSource() {
    if (!sourceKind) return;
    setSourceError(null);
    setPending("install-source");
    try {
      if (sourceKind === "mcp" && mcpTransport === "stdio") {
        if (!mcpCommand.trim()) {
          setSourceError(t`Add a stdio command.`);
          return;
        }
        const parsedEnv = parseMcpEnvLines(mcpEnvText);
        if (parsedEnv.error) {
          setSourceError(parsedEnv.error);
          return;
        }
        const created = await rpc.mcp.servers.create({
          slug: deriveMcpSlug(sourceName.trim() || "OpenAI Image"),
          name: sourceName.trim() || "OpenAI Image",
          transport: "stdio",
          command: mcpCommand.trim(),
          args: mcpArgs.split(/\s+/).filter(Boolean),
          env: parsedEnv.env,
          enabled: true,
        });
        if (activeBotId) {
          const existing = await rpc.mcp.assignments.list({ botId: activeBotId });
          await rpc.mcp.assignments.replace({
            botId: activeBotId,
            assignments: [
              ...existing.filter((entry) => entry.serverId !== created.id),
              { serverId: created.id, allowAllTools: true, allowedTools: [] },
            ],
          });
        }
      } else {
        const auth = {
          type: authType,
          ...(authType === "header" ? { name: authName.trim() } : {}),
        };
        await rpc.capabilities.install({
          kind: sourceKind === "api" ? "api" : "mcp",
          name: sourceName.trim() || (sourceKind === "treg" ? "Treg" : "Custom connector"),
          source: sourceUrl.trim(),
          credential: credential.trim() || undefined,
          config:
            sourceKind === "treg"
              ? { preset: "treg", auth: { type: "bearer" } }
              : sourceKind === "api"
                ? { openApi: true, auth }
                : { preset: "custom", auth },
        });
      }
      setCredential("");
      setSourceKind(null);
      await refresh();
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not install connector`);
    } finally {
      setPending(null);
    }
  }

  async function removeSource(install: CapabilityInstall) {
    setPending(install.id);
    setSourceError(null);
    try {
      await rpc.capabilities.remove({ id: install.id });
      setSources((current) => current.filter((source) => source.id !== install.id));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove connector`);
    } finally {
      setPending(null);
    }
  }

  async function removeMcpServer(server: McpServer) {
    setPending(server.id);
    setSourceError(null);
    try {
      await rpc.mcp.servers.remove({ id: server.id });
      setMcpServers((current) => current.filter((entry) => entry.id !== server.id));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove connector`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-10">
      <div className="flex h-[760px] w-[1080px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[#e2e8f0] bg-[#ffffff] shadow-[0_40px_90px_rgba(0,0,0,.55)]">
        <div className="flex items-start justify-between px-8 pt-7">
          <div className="text-2xl font-medium text-[#020817]">
            <Trans>Integrations</Trans>
          </div>
          <button
            type="button"
            aria-label={t`Close integrations`}
            onClick={onClose}
            className="text-[#64748B]"
          >
            ✕
          </button>
        </div>

        <div className="px-8 pt-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t`Search apps`}
            placeholder={t`Search apps`}
            className="w-full rounded-[13px] border border-[#E2E8F0] bg-[#ffffff] px-4 py-3 text-[15px] text-[#020817] outline-none"
          />
        </div>

        <div id="integration-list" className="rk-scroll flex-1 overflow-y-auto px-8 py-6">
          {catalogError ? <p className="mb-4 text-sm text-[#C94244]">{catalogError}</p> : null}
          {loading ? (
            <p className="text-[#64748B]">
              <Trans>Loading integrations…</Trans>
            </p>
          ) : null}

          {showFeatured ? (
            <div className="mb-6" data-testid="featured-connectors">
              {!loading && catalog.length === 0 ? (
                <p className="text-[13.5px] leading-6 text-[#64748B]">
                  {EMPTY_PLUGIN_CATALOG_MESSAGE}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {featuredTiles.map((tile) => {
                    const item = tile.item;
                    const key = item ? itemKey(item) : tile.id;
                    const disabled = tile.missing || !item;
                    const connected = item?.connected ?? false;
                    return (
                      <div
                        key={key}
                        className={`flex min-w-0 items-center gap-3 rounded-[13px] px-2.5 py-2 ${
                          disabled ? "opacity-70" : ""
                        }`}
                      >
                        {item?.logo ? (
                          <img
                            src={item.logo}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-xl bg-[#E2E8F0] object-contain"
                          />
                        ) : (
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E2E8F0] text-sm font-semibold text-[#020817]">
                            {tile.label[0]}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium text-[#020817]">
                            {tile.label}
                          </div>
                          {disabled ? (
                            <div className="truncate text-[12.5px] text-[#64748b]">
                              <Trans>Not in the plugin catalog</Trans>
                            </div>
                          ) : null}
                        </div>
                        {item && !tile.missing ? (
                          <Button
                            type="button"
                            variant="pill"
                            size="sm"
                            disabled={pending === key}
                            onClick={() => void (connected ? revoke(item) : connect(item))}
                          >
                            {pending === key ? (
                              connected ? (
                                <Trans>Removing…</Trans>
                              ) : (
                                <Trans>Adding…</Trans>
                              )
                            ) : connected ? (
                              <Trans>Remove</Trans>
                            ) : (
                              <Trans>Add</Trans>
                            )}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {!loading && catalog.length === 0 && !showFeatured ? (
            <p className="text-[#64748B]">
              <Trans>No managed app catalog is configured on this deployment.</Trans>
            </p>
          ) : null}
          {!loading && catalog.length > 0 && visible.length === 0 && !showFeatured ? (
            <p className="text-[#64748B]">
              <Trans>No apps match your search.</Trans>
            </p>
          ) : null}
          {visible.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {visible.map((item) => {
                const key = itemKey(item);
                return (
                  <div
                    key={key}
                    className="flex min-w-0 items-center gap-3 rounded-[13px] px-2.5 py-2"
                  >
                    {item.logo ? (
                      <img
                        src={item.logo}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-xl bg-[#E2E8F0] object-contain"
                      />
                    ) : (
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E2E8F0] text-sm font-semibold text-[#020817]">
                        {item.name[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium text-[#020817]">
                        {item.name}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === key}
                      onClick={() => void (item.connected ? revoke(item) : connect(item))}
                    >
                      {pending === key ? (
                        item.connected ? (
                          <Trans>Removing…</Trans>
                        ) : (
                          <Trans>Adding…</Trans>
                        )
                      ) : item.connected ? (
                        <Trans>Remove</Trans>
                      ) : (
                        <Trans>Add</Trans>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <details
            data-testid="integrations-advanced"
            className="group mt-8"
            onToggle={(event) => {
              if (!(event.currentTarget as HTMLDetailsElement).open) {
                setSourceKind(null);
                setSourceError(null);
                setSourceName("");
                setSourceUrl("");
                setMcpTransport("streamable_http");
                setMcpCommand("");
                setMcpArgs("");
                setMcpEnvText("");
                setCredential("");
                setAuthType("none");
                setAuthName("x-api-key");
              }
            }}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] text-[#64748B]">
              <span className="text-[#64748B]">
                <Trans>Advanced</Trans>
              </span>
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>

            <div className="mt-4 space-y-4">
              {onOpenMcp ? (
                <button
                  type="button"
                  onClick={onOpenMcp}
                  className="rounded-full border border-[#383844] px-3 py-1.5 text-xs text-[#334155] hover:bg-[#e2e8f0]"
                >
                  <Trans>MCP servers</Trans>
                </button>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("mcp")}>
                  <Trans>Add MCP server</Trans>
                </Button>
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("api")}>
                  <Trans>Add OpenAPI</Trans>
                </Button>
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("treg")}>
                  <Trans>Add Treg</Trans>
                </Button>
              </div>

              {sourceError ? <p className="text-sm text-[#C94244]">{sourceError}</p> : null}

              {sourceKind ? (
                <div className="space-y-3 rounded-[16px] border border-[#E2E8F0] bg-[#ffffff] p-5">
                  <div className="text-base font-medium text-[#020817]">
                    {sourceKind === "treg" ? (
                      <Trans>Connect Treg</Trans>
                    ) : sourceKind === "mcp" ? (
                      mcpTransport === "stdio" ? (
                        <Trans>Add local MCP server</Trans>
                      ) : (
                        <Trans>Add remote MCP server</Trans>
                      )
                    ) : (
                      <Trans>Import OpenAPI JSON</Trans>
                    )}
                  </div>
                  <input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder={t`Display name`}
                    className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                  />
                  {sourceKind === "mcp" ? (
                    <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] p-1">
                      {(
                        [
                          ["streamable_http", "Remote URL"],
                          ["stdio", "Local command"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={mcpTransport === value}
                          onClick={() => setMcpTransport(value)}
                          className={`rounded-lg px-2 py-2 text-xs ${mcpTransport === value ? "bg-[#30356A] text-[#E2E4FF]" : "text-[#64748B]"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {sourceKind === "mcp" && mcpTransport === "stdio" ? (
                    <>
                      <input
                        value={mcpCommand}
                        onChange={(event) => setMcpCommand(event.target.value)}
                        placeholder="npx"
                        aria-label={t`Command`}
                        className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                      />
                      <input
                        value={mcpArgs}
                        onChange={(event) => setMcpArgs(event.target.value)}
                        placeholder="-y gpt-image-2-mcp"
                        aria-label={t`Arguments`}
                        className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                      />
                      <textarea
                        value={mcpEnvText}
                        onChange={(event) => setMcpEnvText(event.target.value)}
                        placeholder={"OPENAI_API_KEY="}
                        aria-label={t`Environment (KEY=value, one per line)`}
                        rows={3}
                        className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 font-mono text-sm text-[#020817] outline-none"
                      />
                    </>
                  ) : sourceKind !== "treg" ? (
                    <input
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder={
                        sourceKind === "mcp"
                          ? "https://example.com/mcp"
                          : "https://example.com/openapi.json"
                      }
                      className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                    />
                  ) : null}
                  {sourceKind !== "treg" &&
                  !(sourceKind === "mcp" && mcpTransport === "stdio") ? (
                    <select
                      value={authType}
                      onChange={(event) => setAuthType(event.target.value as typeof authType)}
                      className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                    >
                      <option value="none">
                        <Trans>No authentication</Trans>
                      </option>
                      <option value="bearer">
                        <Trans>Bearer token</Trans>
                      </option>
                      <option value="header">
                        <Trans>API key header</Trans>
                      </option>
                    </select>
                  ) : null}
                  {authType === "header" &&
                  sourceKind !== "treg" &&
                  !(sourceKind === "mcp" && mcpTransport === "stdio") ? (
                    <input
                      value={authName}
                      onChange={(event) => setAuthName(event.target.value)}
                      placeholder={t`Header name`}
                      className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                    />
                  ) : null}
                  {(sourceKind === "treg" || authType !== "none") &&
                  !(sourceKind === "mcp" && mcpTransport === "stdio") ? (
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={sourceKind === "treg" ? t`Treg token` : t`Credential`}
                      className="w-full rounded-xl border border-[#E2E8F0] bg-[#e2e8f0] px-3 py-2.5 text-sm text-[#020817] outline-none"
                    />
                  ) : null}
                  <p className="text-xs leading-5 text-[#64748b]">
                    <Trans>
                      Evolve Computer verifies the source before saving it. Credentials are encrypted and are
                      never returned to clients or exposed to the model.
                    </Trans>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === "install-source"}
                      onClick={() => void installSource()}
                    >
                      {pending === "install-source" ? (
                        sourceKind === "mcp" && mcpTransport === "stdio" ? (
                          <Trans>Adding…</Trans>
                        ) : (
                          <Trans>Verifying…</Trans>
                        )
                      ) : sourceKind === "mcp" && mcpTransport === "stdio" ? (
                        <Trans>Add server</Trans>
                      ) : (
                        <Trans>Verify and add</Trans>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      onClick={() => setSourceKind(null)}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-3 text-sm font-medium text-[#94A3B8]">
                  <Trans>Tool sources</Trans>
                </div>
                {sources.length === 0 && mcpServers.length === 0 && !sourceKind ? (
                  <p className="text-[#64748B]">
                    <Trans>No MCP or API tool sources installed yet.</Trans>
                  </p>
                ) : null}
                {mcpServers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center gap-4 rounded-[13px] px-3 py-2.5"
                  >
                    <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#E2E8F0] font-semibold uppercase text-[#020817]">
                      M
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15.5px] font-medium text-[#020817]">{server.name}</div>
                      <div className="truncate text-[13.5px] text-[#64748B]">
                        MCP · {server.endpoint ?? server.command ?? server.slug}
                        {server.hasSecret || server.envKeys.length > 0 ? (
                          <>
                            {" · "}
                            <Trans>credential saved</Trans>
                          </>
                        ) : (
                          <>
                            {" · "}
                            <Trans>no auth</Trans>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === server.id}
                      onClick={() => void removeMcpServer(server)}
                    >
                      {pending === server.id ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
                    </Button>
                  </div>
                ))}
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center gap-4 rounded-[13px] px-3 py-2.5"
                  >
                    <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#E2E8F0] font-semibold uppercase text-[#020817]">
                      {source.kind === "mcp" ? "M" : "A"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15.5px] font-medium text-[#020817]">{source.name}</div>
                      <div className="truncate text-[13.5px] text-[#64748B]">
                        {source.kind.toUpperCase()} · {source.source} ·{" "}
                        {source.secretConfigured ? (
                          <Trans>credential saved</Trans>
                        ) : (
                          <Trans>no auth</Trans>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === source.id}
                      onClick={() => void removeSource(source)}
                    >
                      {pending === source.id ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
