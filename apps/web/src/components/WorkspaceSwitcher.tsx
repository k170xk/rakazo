import { Trans, useLingui } from "@lingui/react/macro";
import type { Me, Workspace } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

export function WorkspaceSwitcher({ me, onSwitched }: { me: Me; onSwitched: () => void }) {
  const { t } = useLingui();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
        setError(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  async function switchTo(workspace: Workspace) {
    if (workspace.id === me.workspaceId || pending) return;
    setPending(true);
    setError(null);
    try {
      await rpc.workspaces.switch({ workspaceId: workspace.id });
      onSwitched();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not switch workspace`);
      setPending(false);
    }
  }

  async function createWorkspace() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      await rpc.workspaces.create({ name: trimmed });
      onSwitched();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not create workspace`);
      setPending(false);
    }
  }

  return (
    <div ref={rootRef} className="relative mx-3.5 mb-2" data-testid="workspace-switcher">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t`Workspace`}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-xl border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-start"
      >
        <span className="min-w-0 truncate text-[13.5px] text-[#020817]">{me.workspaceName}</span>
        <span aria-hidden="true" className="text-[12px] text-[#94A3B8]">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-[#E2E8F0] bg-[#ffffff] py-1 shadow-lg">
          {me.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              role="option"
              aria-selected={workspace.id === me.workspaceId}
              disabled={pending}
              onClick={() => void switchTo(workspace)}
              className={`block w-full truncate px-3.5 py-2 text-start text-[14px] ${
                workspace.id === me.workspaceId
                  ? "bg-[#F1F5F9] text-[#020817]"
                  : "text-[#334155] hover:bg-[#F1F5F9]"
              }`}
            >
              {workspace.name}
            </button>
          ))}
          <div className="mt-1 border-t border-[#E2E8F0] px-2 py-2">
            {creating ? (
              <div className="flex flex-col gap-2">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t`Workspace name`}
                  maxLength={60}
                  className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-[13.5px] outline-none"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createWorkspace();
                  }}
                />
                <button
                  type="button"
                  disabled={pending || !name.trim()}
                  onClick={() => void createWorkspace()}
                  className="rounded-lg bg-[#F1F5F9] px-2.5 py-1.5 text-[13px] text-[#020817] disabled:opacity-40"
                >
                  <Trans>Create</Trans>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setCreating(true)}
                className="w-full px-1.5 py-1 text-start text-[13px] text-[#64748B] hover:text-[#020817]"
              >
                <Trans>New workspace</Trans>
              </button>
            )}
          </div>
          {error ? (
            <p role="alert" className="px-3.5 pb-2 text-[12px] text-[#E65707]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
