import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyApp } from "@rakazo/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** A company app that connects as a remote MCP server with the person's own token. */
export function CompanyMcpApp({ app, endpoint }: { app: CompanyApp; endpoint: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const secret = token.trim().replace(/^Bearer\s+/i, "");
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      const existing = (await rpc.mcp.servers.list()).find(
        (server) => server.endpoint === endpoint,
      );
      const server = existing
        ? await rpc.mcp.servers.update({ id: existing.id, secret })
        : await rpc.mcp.servers.create({
            slug: app.slug,
            name: app.name,
            transport: "streamable_http",
            endpoint,
            secret,
          });
      const tested = await rpc.mcp.servers.test({ id: server.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queries.connections.companyApps.key() }),
        queryClient.invalidateQueries({ queryKey: queries.mcp.servers.list.key() }),
      ]);
      if (tested.health.status === "error") {
        setError(t`${app.name} did not accept this token. Check it and try again.`);
        return;
      }
      setOpen(false);
      setToken("");
      toast.success(t`${app.name} is connected`);
    } catch (err) {
      setError(errorText(err, t`Could not connect ${app.name}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid={`company-app-${app.slug}`}
      className="flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2"
    >
      {app.logo ? (
        <img
          src={app.logo}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-9 w-9 shrink-0 rounded-xl bg-white object-contain p-1.5"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-foreground">{app.name}</div>
      </div>
      {app.connected ? (
        <Badge variant="secondary">
          <Trans>Connected</Trans>
        </Badge>
      ) : null}
      <Button size="sm" variant={app.connected ? "ghost" : "outline"} onClick={() => setOpen(true)}>
        {app.connected ? <Trans>Change token</Trans> : <Trans>Connect</Trans>}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              <Trans>Connect {app.name}</Trans>
            </DialogTitle>
            <DialogDescription>
              {app.tokenHelp ?? <Trans>Paste your connection token from {app.name}.</Trans>}{" "}
              <Trans>Your token is stored encrypted and only your assistants use it.</Trans>
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              aria-label={t`${app.name} connection token`}
              placeholder={t`Connection token`}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                <Trans>Cancel</Trans>
              </Button>
              <Button type="submit" disabled={busy || !token.trim()}>
                {busy ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
