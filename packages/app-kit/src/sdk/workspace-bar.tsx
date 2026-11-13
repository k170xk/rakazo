import { Archive, Check, ChevronDown, Layers, LoaderCircle, Plus, Users, X } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  FormEvent,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { MemberRole } from "../workspace.js";
import type { WorkspaceMember } from "./index.js";
import { useApp, useAppGeneration, useWorkspace } from "./index.js";

/**
 * What every app with workspaces shows above its own screens: the open workspace, a menu to open
 * another or start one, and (for its leads and the owner) who is in it. Someone in no workspace
 * yet sees how to get into one instead of an empty app.
 *
 * Every app carries this file, and its utility CSS is generated from the files an app uses, so
 * the bar brings its own small stylesheet (only added while workspaces are on) instead of
 * utility classes.
 */

const STYLES = `
.min-h-screen{min-height:calc(100vh - 2.5rem)}.h-screen{height:calc(100vh - 2.5rem)}
.min-h-dvh{min-height:calc(100dvh - 2.5rem)}.h-dvh{height:calc(100dvh - 2.5rem)}
.ows svg{width:1rem;height:1rem;flex-shrink:0}
.ows-bar{position:relative;z-index:40;display:flex;align-items:center;gap:.5rem;height:2.5rem;padding:0 .75rem;border-bottom:1px solid hsl(var(--border)/.7);background:hsl(var(--card));color:hsl(var(--foreground));font-size:13px}
@media(min-width:640px){.ows-bar{padding:0 1.25rem}}
@media(max-width:639px){.ows-label{display:none}}
.ows-muted{color:hsl(var(--muted-foreground))}
.ows-note{font-size:12px;color:hsl(var(--muted-foreground));margin:0}
.ows-error{font-size:12px;font-weight:500;color:hsl(var(--destructive));margin:0}
.ows-trunc{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ows-anchor{position:relative;min-width:0}
.ows-trigger{display:inline-flex;align-items:center;gap:.25rem;max-width:60vw;padding:.25rem .5rem;border:0;border-radius:.375rem;background:none;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.ows-trigger:hover,.ows-item:hover,.ows-ghost:hover{background:hsl(var(--muted))}
.ows-tag{border-radius:999px;background:hsl(var(--muted));padding:.125rem .5rem;font-size:11px;font-weight:600;color:hsl(var(--muted-foreground))}
.ows-push{margin-left:auto}
.ows-menu{position:absolute;top:100%;left:0;margin-top:.25rem;width:18rem;max-width:90vw;padding:.25rem;border:1px solid hsl(var(--border));border-radius:.75rem;background:hsl(var(--popover));color:hsl(var(--foreground));box-shadow:0 12px 32px -8px rgb(0 0 0/.25)}
.ows-list{max-height:18rem;overflow-y:auto}
.ows-item{display:flex;width:100%;align-items:center;gap:.5rem;padding:.5rem .625rem;border:0;border-radius:.5rem;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ows-item:disabled{opacity:.6}
.ows-item[aria-checked=true]{font-weight:600}
.ows-item[aria-checked=false] .ows-check{visibility:hidden}
.ows-check{color:hsl(var(--primary))}
.ows-grow{flex:1}
.ows-foot{margin-top:.25rem;padding:.5rem .375rem .375rem;border-top:1px solid hsl(var(--border)/.7)}
.ows-btn{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:.375rem;height:2rem;padding:0 .75rem;border:1px solid transparent;border-radius:.375rem;font:inherit;font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
.ows-btn:disabled{opacity:.5;cursor:default}
.ows-primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.ows-outline{border-color:hsl(var(--border));background:hsl(var(--card));color:hsl(var(--foreground))}
.ows-ghost{background:transparent;color:hsl(var(--foreground))}
.ows-danger{background:hsl(var(--destructive));color:hsl(var(--destructive-foreground))}
.ows-square{padding:0 .5rem}
.ows-spin{animation:ows-spin 1s linear infinite}@keyframes ows-spin{to{transform:rotate(360deg)}}
.ows-field{width:100%;min-width:0;height:2rem;padding:0 .625rem;border:1px solid hsl(var(--input));border-radius:.375rem;background:hsl(var(--card));color:hsl(var(--foreground));font:inherit;font-size:13px;outline:none}
.ows-field:focus{border-color:hsl(var(--primary)/.6);box-shadow:0 0 0 2px hsl(var(--primary)/.2)}
.ows-role{width:7rem;flex-shrink:0}
.ows-row{display:flex;align-items:center;gap:.5rem}
.ows-col{display:flex;flex-direction:column;gap:.375rem}
.ows-stack{display:flex;flex-direction:column;gap:1.25rem}
.ows-strong{margin:0;font-weight:600}
.ows-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgb(0 0 0/.4)}
.ows-panel{width:100%;max-width:32rem;max-height:90vh;overflow-y:auto;padding:1.25rem;border:1px solid hsl(var(--border));border-radius:1rem;background:hsl(var(--card));color:hsl(var(--foreground));font-size:13px;box-shadow:0 24px 48px -12px rgb(0 0 0/.3)}
.ows-head{display:flex;align-items:flex-start;gap:.75rem;margin-bottom:1rem}
.ows-head h2{margin:0;font-size:1rem;font-weight:600}
.ows-labelled{display:flex;flex:1;flex-direction:column;gap:.375rem;min-width:0;font-weight:600}
.ows-people{margin:0;padding:0;list-style:none;border:1px solid hsl(var(--border)/.7);border-radius:.75rem}
.ows-people li{display:flex;align-items:center;gap:.75rem;padding:.625rem .75rem}
.ows-people li+li{border-top:1px solid hsl(var(--border)/.7)}
.ows-split{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-top:1rem;border-top:1px solid hsl(var(--border)/.7)}
.ows-gate{display:flex;min-height:calc(100vh - 2.5rem);align-items:center;justify-content:center;padding:1.5rem;background:hsl(var(--background));color:hsl(var(--foreground))}
.ows-card{width:100%;max-width:28rem;padding:1.5rem;border:1px solid hsl(var(--border)/.7);border-radius:1rem;background:hsl(var(--card))}
.ows-card h2{margin:0;font-size:1.125rem;font-weight:700}
.ows-card p{margin:.375rem 0 0;font-size:14px;color:hsl(var(--muted-foreground))}
.ows-mark{display:flex;width:2.75rem;height:2.75rem;align-items:center;justify-content:center;margin-bottom:1rem;border-radius:.75rem;background:hsl(var(--primary)/.12);color:hsl(var(--primary))}
.ows-mark svg{width:1.25rem;height:1.25rem}
`;

const ROLE_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

const ROLE_HINT: Record<MemberRole, string> = {
  lead: "changes everything and chooses who is in it",
  member: "adds and changes entries",
  viewer: "reads only",
};

export function plural(label: string) {
  const word = label.trim() || "Workspace";
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "That did not work. Try again.";

function Button({
  variant = "primary",
  icon,
  loading,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`ows-btn ows-${variant} ${children ? "" : "ows-square"} ${className}`}
      {...props}
    >
      {loading ? <LoaderCircle className="ows-spin" /> : icon}
      {children}
    </button>
  );
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="ows-field" />;
}

function RoleSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className="ows-field ows-role">
      {ROLE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Wraps the app: the bar above it, and a fresh mount each time another workspace opens. */
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const space = useWorkspace();
  const { viewer } = useApp();
  const generation = useAppGeneration();
  if (!space.enabled) return <>{children}</>;
  const waiting = !space.current && viewer.role !== "owner";
  return (
    <>
      <style>{STYLES}</style>
      <WorkspaceBar />
      {waiting ? <WorkspaceGate /> : <div key={generation}>{children}</div>}
    </>
  );
}

function WorkspaceBar() {
  const space = useWorkspace();
  const owner = useApp().viewer.role === "owner";
  const [menu, setMenu] = useState(false);
  const [people, setPeople] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const current = space.current;
  const role = current?.role;
  return (
    <div data-workspace-bar="" className="ows ows-bar">
      <Layers className="ows-muted" aria-hidden />
      <span className="ows-label ows-muted">{space.label}</span>
      <div ref={box} className="ows-anchor">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
          className="ows-trigger"
        >
          <span className="ows-trunc">
            {current?.name ??
              (owner
                ? `All ${plural(space.label).toLowerCase()}`
                : `No ${space.label.toLowerCase()} yet`)}
          </span>
          <ChevronDown className="ows-muted" aria-hidden />
        </button>
        {menu && <WorkspaceMenu onDone={() => setMenu(false)} />}
      </div>
      {role === "viewer" && <span className="ows-tag">View only</span>}
      {role === "lead" && <span className="ows-tag">Lead</span>}
      {space.canManage && current && (
        <Button
          variant="ghost"
          className="ows-push"
          icon={<Users />}
          onClick={() => setPeople(true)}
        >
          People
        </Button>
      )}
      {people && current && (
        <PeopleDialog workspace={current.id} name={current.name} onClose={() => setPeople(false)} />
      )}
    </div>
  );
}

function WorkspaceMenu({ onDone }: { onDone: () => void }) {
  const space = useWorkspace();
  const { viewer } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async (id: string | null) => {
    if (id === (space.current?.id ?? null)) return onDone();
    setBusy(true);
    setError(null);
    try {
      await space.open(id);
      onDone();
    } catch (problem) {
      setError(failure(problem));
      setBusy(false);
    }
  };
  const item = (id: string | null, label: string, note?: string) => (
    <button
      key={id ?? "all"}
      type="button"
      role="menuitemradio"
      aria-checked={id === (space.current?.id ?? null)}
      disabled={busy}
      onClick={() => void open(id)}
      className="ows-item"
    >
      <Check className="ows-check" />
      <span className="ows-trunc ows-grow">{label}</span>
      {note && <span className="ows-note">{note}</span>}
    </button>
  );
  const noteFor = (entry: (typeof space.workspaces)[number]) =>
    entry.archived
      ? "archived"
      : entry.role === "lead"
        ? "lead"
        : entry.role === "viewer"
          ? "view only"
          : undefined;
  return (
    <div role="menu" className="ows-menu">
      <div className="ows-list">
        {viewer.role === "owner" && item(null, `All ${plural(space.label).toLowerCase()}`)}
        {space.workspaces.map((entry) => item(entry.id, entry.name, noteFor(entry)))}
        {!space.workspaces.length && (
          <p className="ows-note ows-item">No {plural(space.label).toLowerCase()} yet.</p>
        )}
      </div>
      {error && <p className="ows-error ows-item">{error}</p>}
      {space.canCreate && (
        <div className="ows-foot">
          <StartWorkspace label={space.label} onStarted={onDone} />
        </div>
      )}
    </div>
  );
}

function StartWorkspace({ label, onStarted }: { label: string; onStarted?: () => void }) {
  const space = useWorkspace();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await space.create(name);
      onStarted?.();
    } catch (problem) {
      setError(failure(problem));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="ows-col">
      <div className="ows-row">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`New ${label.toLowerCase()} name`}
          aria-label={`New ${label.toLowerCase()} name`}
          maxLength={80}
        />
        <Button type="submit" icon={<Plus />} loading={busy} disabled={!name.trim()}>
          Start
        </Button>
      </div>
      {error && <p className="ows-error">{error}</p>}
    </form>
  );
}

function WorkspaceGate() {
  const space = useWorkspace();
  const label = space.label.toLowerCase();
  return (
    <div className="ows ows-gate">
      <div className="ows-card">
        <div className="ows-mark">
          <Layers aria-hidden />
        </div>
        <h2>You're not in a {label} yet</h2>
        <p>
          Each {label} keeps its own entries, seen only by the people in it. Ask the app's owner or
          a {label}'s lead to add you
          {space.canCreate ? `, or start a ${label} of your own.` : "."}
        </p>
        {space.canCreate && (
          <div style={{ marginTop: "1.25rem" }}>
            <StartWorkspace label={space.label} />
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="ows ows-overlay"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="ows-panel">
        <div className="ows-head">
          <div className="ows-grow">
            <h2>{title}</h2>
            <p className="ows-note" style={{ marginTop: "0.25rem" }}>
              {description}
            </p>
          </div>
          <Button variant="ghost" aria-label="Close" icon={<X />} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

function PeopleDialog({
  workspace,
  name,
  onClose,
}: {
  workspace: string;
  name: string;
  onClose: () => void;
}) {
  const space = useWorkspace();
  const { viewer } = useApp();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [title, setTitle] = useState(name);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const nameField = useId();
  const label = space.label.toLowerCase();
  const archived = space.workspaces.some((entry) => entry.id === workspace && entry.archived);

  useEffect(() => {
    let live = true;
    space.members(workspace).then(
      (list) => live && setMembers(list),
      (problem) => live && setError(failure(problem)),
    );
    return () => {
      live = false;
    };
  }, [space.members, workspace]);

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const list = await work();
      if (Array.isArray(list)) setMembers(list as WorkspaceMember[]);
      return true;
    } catch (problem) {
      setError(failure(problem));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    if (await run("add", () => space.addMember(workspace, email, role))) setEmail("");
  };
  const who = (member: WorkspaceMember) => member.name ?? member.email ?? "Invited colleague";

  return (
    <Panel
      onClose={onClose}
      title={`People in ${name}`}
      description={`Only the people here see this ${label}'s entries.`}
    >
      <div className="ows-stack">
        <form
          className="ows-row"
          style={{ alignItems: "flex-end" }}
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && title.trim() !== name)
              void run("rename", () => space.rename(workspace, title));
          }}
        >
          <div className="ows-labelled">
            <label htmlFor={nameField}>Name</label>
            <Input
              id={nameField}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            loading={busy === "rename"}
            disabled={!title.trim() || title.trim() === name}
          >
            Rename
          </Button>
        </form>

        <div className="ows-col">
          <p className="ows-strong">People</p>
          {!members ? (
            <p className="ows-note">Loading…</p>
          ) : (
            <ul className="ows-people">
              {members.map((member) => (
                <li key={member.id}>
                  <div className="ows-grow ows-trunc">
                    <p className="ows-trunc" style={{ margin: 0, fontWeight: 500 }}>
                      {who(member)}
                      {member.me && <span className="ows-muted"> (you)</span>}
                    </p>
                    <p className="ows-note ows-trunc">
                      {member.name && member.email ? `${member.email} · ` : ""}
                      {member.joined ? ROLE_HINT[member.role] : "added; not opened yet"}
                    </p>
                  </div>
                  <RoleSelect
                    aria-label={`Role for ${who(member)}`}
                    value={member.role}
                    disabled={busy !== null}
                    onChange={(event) =>
                      void run(member.id, () =>
                        space.setRole(workspace, member.id, event.target.value as MemberRole),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    icon={<X />}
                    aria-label={`Take ${who(member)} out`}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(member.id, () => space.removeMember(workspace, member.id))
                    }
                  />
                </li>
              ))}
              {!members.length && <li className="ows-note">Nobody yet.</li>}
            </ul>
          )}
        </div>

        <form onSubmit={(event) => void add(event)} className="ows-col">
          <p className="ows-strong">Add a colleague</p>
          <div className="ows-row">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@ocsc.ie"
              aria-label="Work email"
            />
            <RoleSelect
              aria-label="Role"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
            />
            <Button type="submit" loading={busy === "add"} disabled={!email.trim()}>
              Add
            </Button>
          </div>
        </form>

        {error && <p className="ows-error">{error}</p>}

        <div className="ows-split">
          <p className="ows-note">
            Archiving keeps every entry.
            {viewer.role === "owner" ? "" : " Only the app's owner can bring it back."}
          </p>
          {archived ? (
            <Button
              variant="outline"
              loading={busy === "archive"}
              onClick={() =>
                void run("archive", () => space.archive(workspace, false)).then(
                  (done) => done && onClose(),
                )
              }
            >
              Bring back
            </Button>
          ) : (
            <Button
              variant={archiving ? "danger" : "outline"}
              icon={<Archive />}
              loading={busy === "archive"}
              onClick={() => {
                if (!archiving) return setArchiving(true);
                void run("archive", () => space.archive(workspace, true)).then(
                  (done) => done && onClose(),
                );
              }}
            >
              {archiving ? `Archive ${name}?` : "Archive"}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
