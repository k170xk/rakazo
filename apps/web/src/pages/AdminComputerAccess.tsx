import { Trans, useLingui } from "@lingui/react/macro";
import type {
  CompanyAdminState,
  CompanyTools,
  ComputerAccess,
  FileCleanupSchedule,
} from "@rakazo/contracts";
import { Button, Input, NativeSelect, NativeSelectOption, toast } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useState } from "react";
import { ComputerProviderSettings } from "../components/ComputerProviderSettings";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const STORAGE_LIMITS_GB = [1, 2, 5, 10, 20, 50];
const RETENTION_DAYS = [7, 14, 30, 60, 90, 180];

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type People = CompanyAdminState["computers"]["people"];

function useAdminSave(onSaved: (next: CompanyAdminState) => Promise<void>, failure: string) {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, action: () => Promise<CompanyAdminState>) {
    setBusy(key);
    try {
      await onSaved(await action());
    } catch (err) {
      toast.error(errorText(err, failure));
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

function usePersonFilter(people: People) {
  const { t } = useLingui();
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const shown = query
    ? people.filter(
        (person) =>
          person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query),
      )
    : people;
  const input =
    people.length > 8 ? (
      <Input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t`Find a person`}
        aria-label={t`Find a person`}
      />
    ) : null;
  return { shown, input };
}

function SectionHeading({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function SettingLine({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <label htmlFor={id} className="flex-1 basis-56 text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function PersonLabel({
  id,
  person,
  detail,
}: {
  id: string;
  person: People[number];
  detail?: ReactNode;
}) {
  return (
    <label htmlFor={id} className="min-w-48 flex-1 cursor-pointer">
      <span className="block truncate text-sm font-medium">{person.name}</span>
      <span className="block truncate text-[13px] text-muted-foreground">{person.email}</span>
      {detail ? (
        <span className="block truncate text-[13px] text-muted-foreground tabular-nums">
          {detail}
        </span>
      ) : null}
    </label>
  );
}

/** Who may use a computer beyond the company tools, and how busy the computers are. */
export function CompanyComputerAccessSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const { busy, run } = useAdminSave(onSaved, t`Could not update computer access`);
  const { defaultAccess, people, capacity } = state.computers;
  const { shown, input } = usePersonFilter(people);
  const computersOn = state.features.computers;

  const levels: Record<ComputerAccess, string> = {
    full: t`Full computer`,
    tools: t`Tools only`,
    none: t`No computer`,
  };

  return (
    <section id="computer" className="space-y-6" data-testid="company-computer-access">
      <SectionHeading title={<Trans>Computers</Trans>}>
        <Trans>
          Word, PowerPoint, Excel, PDF and video files always run on the company tool runners, for
          everyone. Full adds the person's own computer for browsing, a shell and routines. Tools
          only and No computer: documents, videos and Evolve tools. Every person's files stay their
          own.
        </Trans>
      </SectionHeading>

      {computersOn ? null : (
        <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Trans>
            Computers are switched off in Features, so nobody has one. Documents and videos still
            work for everyone.
          </Trans>
        </p>
      )}

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label={t`Computers running`} value={String(capacity.runningComputers)} />
        <Stat
          label={t`Video renders`}
          value={`${capacity.videoRendering} / ${capacity.videoSlots}`}
        />
        <Stat label={t`Renders waiting`} value={String(capacity.videoQueued)} />
      </dl>

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Computer provider</Trans>
        </h3>
        <div className="rounded-xl border border-border px-4 py-4">
          <ComputerProviderSettings scope="deployment" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Who gets a computer</Trans>
        </h3>
        <div className="rounded-xl border border-border">
          <SettingLine
            id="computer-access-default"
            label={<Trans>Everyone without their own level</Trans>}
          >
            <AccessSelect
              id="computer-access-default"
              value={defaultAccess}
              levels={levels}
              disabled={busy !== null || !computersOn}
              onChange={(access) =>
                void run("default", () =>
                  rpc.companyAdmin.setTools({ defaultComputerAccess: access as ComputerAccess }),
                )
              }
            />
          </SettingLine>
        </div>
        {input}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {shown.map((person) => {
            const id = `computer-access-${person.userId}`;
            return (
              <li key={person.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <PersonLabel id={id} person={person} />
                <AccessSelect
                  id={id}
                  value={person.access ?? "default"}
                  levels={{
                    default: t`Company default (${levels[defaultAccess]})`,
                    ...levels,
                  }}
                  disabled={busy !== null || !computersOn}
                  onChange={(access) =>
                    void run(`person:${person.userId}`, () =>
                      rpc.companyAdmin.setComputerAccess({
                        userId: person.userId,
                        access: access === "default" ? null : (access as ComputerAccess),
                      }),
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** How much each person may keep, how long bot-made files live and when cleanup runs. */
export function CompanyStorageSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const { busy, run } = useAdminSave(onSaved, t`Could not update storage`);
  const { people, storage } = state.computers;
  const { shown, input } = usePersonFilter(people);

  const limits = Object.fromEntries(
    STORAGE_LIMITS_GB.map((gb) => [String(gb * 1024), t`${gb} GB`]),
  ) as Record<string, string>;
  const retentions = Object.fromEntries(
    RETENTION_DAYS.map((days) => [String(days), t`${days} days`]),
  ) as Record<string, string>;
  const limitLabel = (mb: number) => limits[String(mb)] ?? formatSize(mb * 1024 * 1024);
  const diskNearlyFull = Boolean(
    storage.disk && storage.disk.usedBytes > storage.disk.totalBytes * 0.8,
  );
  const totalStored = people.reduce((sum, person) => sum + (person.storageUsedBytes ?? 0), 0);
  const nearlyFull = people.filter(
    (person) =>
      person.storageUsedBytes !== null &&
      person.storageUsedBytes >= person.effectiveStorageLimitMb * 1024 * 1024 * 0.8,
  ).length;

  return (
    <section id="storage" className="space-y-6" data-testid="company-storage">
      <SectionHeading title={<Trans>Storage and cleanup</Trans>}>
        <Trans>
          Files bots make stay on each person's own computer and are never visible to anyone else.
          Anything nobody changes for the period below is deleted at the next cleanup unless its
          owner pins it in the bot's Files tab. Files bots attach in chats count towards the same
          limit. People are told a week before files are deleted and when they are nearly full, and
          can download or delete them from Manage storage. Once someone reaches their limit, their
          bots stop making new documents and videos until they delete something.
        </Trans>
      </SectionHeading>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat
          label={t`Server disk`}
          value={
            storage.disk
              ? `${formatSize(storage.disk.usedBytes)} / ${formatSize(storage.disk.totalBytes)}`
              : "—"
          }
          warn={diskNearlyFull}
        />
        <Stat label={t`Everyone's files`} value={formatSize(totalStored)} />
        <Stat label={t`Nearly full (80%+)`} value={String(nearlyFull)} warn={nearlyFull > 0} />
      </dl>
      {diskNearlyFull ? (
        <p role="alert" className="px-1 text-[13px] text-destructive">
          <Trans>
            The server disk is over 80% full. Lower limits or retention, or ask people to clear
            files. Below 5% free, everyone's new documents and videos are paused.
          </Trans>
        </p>
      ) : null}

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Keeping files</Trans>
        </h3>
        <div className="divide-y divide-border rounded-xl border border-border">
          <SettingLine id="file-retention" label={<Trans>Delete unpinned files after</Trans>}>
            <AccessSelect
              id="file-retention"
              value={String(storage.fileRetentionDays)}
              levels={{
                [String(storage.fileRetentionDays)]: t`${storage.fileRetentionDays} days`,
                ...retentions,
              }}
              disabled={busy !== null}
              onChange={(days) =>
                void run("retention", () =>
                  rpc.companyAdmin.setTools({ fileRetentionDays: Number(days) }),
                )
              }
            />
          </SettingLine>
          <div>
            <SettingLine
              id="chat-file-retention"
              label={<Trans>Delete files bots attached in chats after</Trans>}
            >
              <AccessSelect
                id="chat-file-retention"
                value={
                  storage.chatFileRetentionDays === null
                    ? "keep"
                    : String(storage.chatFileRetentionDays)
                }
                levels={{
                  keep: t`Never`,
                  ...(storage.chatFileRetentionDays === null
                    ? {}
                    : {
                        [String(storage.chatFileRetentionDays)]:
                          t`${storage.chatFileRetentionDays} days`,
                      }),
                  ...retentions,
                }}
                disabled={busy !== null}
                onChange={(days) =>
                  void run("chat-retention", () =>
                    rpc.companyAdmin.setTools({
                      chatFileRetentionDays: days === "keep" ? null : Number(days),
                    }),
                  )
                }
              />
            </SettingLine>
            <p className="-mt-1 px-4 pb-3 text-[13px] text-muted-foreground">
              <Trans>
                Counted from when the bot made the file. Files people upload themselves are never
                deleted. The chat keeps the message and shows that the file was removed.
              </Trans>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Cleanup schedule</Trans>
        </h3>
        <CleanupSchedule
          cleanup={storage.cleanup}
          busy={busy}
          onSchedule={(change) =>
            void run("cleanup-schedule", () => rpc.companyAdmin.setTools(change))
          }
          onRunNow={() => void run("cleanup-now", () => rpc.companyAdmin.runFileCleanup())}
        />
      </div>

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Storage per person</Trans>
        </h3>
        <div className="rounded-xl border border-border">
          <SettingLine id="storage-default" label={<Trans>Everyone without their own limit</Trans>}>
            <AccessSelect
              id="storage-default"
              value={String(storage.defaultStorageLimitMb)}
              levels={{
                [String(storage.defaultStorageLimitMb)]: limitLabel(storage.defaultStorageLimitMb),
                ...limits,
              }}
              disabled={busy !== null}
              onChange={(mb) =>
                void run("storage-default", () =>
                  rpc.companyAdmin.setTools({ defaultStorageLimitMb: Number(mb) }),
                )
              }
            />
          </SettingLine>
        </div>
        {input}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {shown.map((person) => {
            const id = `storage-limit-${person.userId}`;
            return (
              <li key={person.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <PersonLabel
                  id={id}
                  person={person}
                  detail={
                    person.storageUsedBytes === null ? (
                      <Trans>No files yet</Trans>
                    ) : (
                      <Trans>
                        {formatSize(person.storageUsedBytes)} of{" "}
                        {limitLabel(person.effectiveStorageLimitMb)} used
                      </Trans>
                    )
                  }
                />
                <AccessSelect
                  id={id}
                  label={t`Storage limit for ${person.name}`}
                  value={person.storageLimitMb === null ? "default" : String(person.storageLimitMb)}
                  levels={{
                    default: t`Default storage (${limitLabel(storage.defaultStorageLimitMb)})`,
                    ...(person.storageLimitMb === null
                      ? {}
                      : { [String(person.storageLimitMb)]: limitLabel(person.storageLimitMb) }),
                    ...limits,
                  }}
                  disabled={busy !== null}
                  onChange={(mb) =>
                    void run(`storage:${person.userId}`, () =>
                      rpc.companyAdmin.setStorageLimit({
                        userId: person.userId,
                        limitMb: mb === "default" ? null : Number(mb),
                      }),
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

type Cleanup = CompanyAdminState["computers"]["storage"]["cleanup"];

function CleanupSchedule({
  cleanup,
  busy,
  onSchedule,
  onRunNow,
}: {
  cleanup: Cleanup;
  busy: string | null;
  onSchedule: (change: Partial<CompanyTools>) => void;
  onRunNow: () => void;
}) {
  const { t, i18n } = useLingui();
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale, {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const schedules: Record<FileCleanupSchedule, string> = {
    daily: t`Every day`,
    weekly: t`Every week`,
    off: t`Paused`,
  };
  const hours = Object.fromEntries(
    Array.from({ length: 24 }, (_, hour) => [String(hour), `${String(hour).padStart(2, "0")}:00`]),
  ) as Record<string, string>;
  const weekdays = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      String(day),
      new Intl.DateTimeFormat(i18n.locale, { weekday: "long", timeZone: "UTC" }).format(
        new Date(Date.UTC(2026, 0, 4 + day)),
      ),
    ]),
  ) as Record<string, string>;
  const last = cleanup.lastResult;

  return (
    <div
      className="space-y-3 rounded-xl border border-border p-4"
      data-testid="file-cleanup-schedule"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="cleanup-schedule" className="flex-1 text-sm font-medium">
          <Trans>Run cleanup</Trans>
        </label>
        <AccessSelect
          id="cleanup-schedule"
          value={cleanup.schedule}
          levels={schedules}
          disabled={busy !== null}
          onChange={(schedule) =>
            onSchedule({ fileCleanupSchedule: schedule as FileCleanupSchedule })
          }
        />
      </div>
      {cleanup.schedule === "weekly" ? (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="cleanup-weekday" className="flex-1 text-sm font-medium">
            <Trans>On</Trans>
          </label>
          <AccessSelect
            id="cleanup-weekday"
            value={String(cleanup.weekday)}
            levels={weekdays}
            disabled={busy !== null}
            onChange={(day) => onSchedule({ fileCleanupWeekday: Number(day) })}
          />
        </div>
      ) : null}
      {cleanup.schedule === "off" ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="cleanup-hour" className="flex-1 text-sm font-medium">
            <Trans>At (UK time)</Trans>
          </label>
          <AccessSelect
            id="cleanup-hour"
            value={String(cleanup.hour)}
            levels={hours}
            disabled={busy !== null}
            onChange={(hour) => onSchedule({ fileCleanupHour: Number(hour) })}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 space-y-0.5 text-[13px] text-muted-foreground">
          <p>
            {cleanup.lastRunAt ? (
              last ? (
                <Trans>
                  Last cleanup {when(cleanup.lastRunAt)}: {last.deletedItems} removed,{" "}
                  {formatSize(last.freedBytes)} freed.
                </Trans>
              ) : (
                <Trans>Cleanup started {when(cleanup.lastRunAt)}.</Trans>
              )
            ) : (
              <Trans>No cleanup has run yet.</Trans>
            )}
          </p>
          {last?.error ? (
            <p className="text-destructive">
              <Trans>It stopped early: {last.error}</Trans>
            </p>
          ) : null}
          <p>
            {cleanup.requested ? (
              <Trans>Cleanup requested; it starts within a minute.</Trans>
            ) : cleanup.nextRunAt ? (
              <Trans>Next cleanup {when(cleanup.nextRunAt)}.</Trans>
            ) : (
              <Trans>Cleanup is paused, so nothing is deleted.</Trans>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null || cleanup.requested}
          onClick={onRunNow}
        >
          <Trans>Run cleanup now</Trans>
        </Button>
      </div>
    </div>
  );
}

function AccessSelect({
  id,
  label,
  value,
  levels,
  disabled,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  levels: Record<string, string>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-56 max-w-full"
    >
      {Object.entries(levels).map(([level, label]) => (
        <NativeSelectOption key={level} value={level}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={`text-base font-medium tabular-nums ${warn ? "text-destructive" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
