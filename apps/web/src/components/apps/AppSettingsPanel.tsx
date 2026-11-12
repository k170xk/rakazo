import { useLingui } from "@lingui/react/macro";
import type { AppDataAccess } from "@rakazo/contracts";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { AppIcon } from "./AppIcon";
import { AppPublishSection } from "./AppPublishSection";

const PICTURE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/** Who may change the app's data, where it is published, and the pictures the app can show. */
export function AppSettingsPanel({
  pageId,
  title,
  icon,
}: {
  pageId: string;
  title: string;
  icon: string | null;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const data = useQuery(queries.apps.data.queryOptions({ input: { pageId } }));
  const assets = useQuery(queries.apps.assets.queryOptions({ input: { pageId } }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.apps.key() });
  const access = useMutation({
    mutationFn: (next: AppDataAccess) => queries.apps.setDataAccess.call({ pageId, access: next }),
    onSuccess: () => void refresh(),
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      for (let at = 0; at < bytes.length; at += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      }
      return queries.apps.addAsset.call({
        pageId,
        name: file.name.slice(0, 200),
        mime: file.type,
        base64: btoa(text),
      });
    },
    onSuccess: () => {
      setUploadError(null);
      void refresh();
    },
    onError: (error) =>
      setUploadError(error instanceof Error ? error.message : t`That picture wasn't added.`),
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => queries.apps.removeAsset.call({ pageId, assetId }),
    onSuccess: () => void refresh(),
  });
  const [subject, setSubject] = useState("");
  const redraw = useMutation({
    mutationFn: () =>
      queries.apps.redrawIcon.call({ pageId, subject: subject.trim() || undefined }),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: queries.pages.key() });
    },
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const current = data.data?.dataAccess;

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-foreground">{t`App icon`}</h3>
        <div className="flex items-center gap-3">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-foreground/[0.04]">
            {redraw.isPending ? (
              <Spinner />
            ) : (
              <AppIcon
                pageId={pageId}
                icon={icon}
                className="size-14"
                fallback={<Sparkles className="size-5 text-muted-foreground" strokeWidth={1.7} />}
              />
            )}
          </span>
          <p className="text-[12px] text-muted-foreground">
            {redraw.isPending
              ? t`Drawing a new OCSC icon with GPT Image. This takes about a minute.`
              : icon
                ? t`Drawn for this app in the OCSC style. Describe one object to draw something else.`
                : t`Every new app gets an OCSC icon drawn for it. If it hasn't appeared, draw one here.`}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={subject}
            maxLength={300}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t`What it shows, e.g. a hard hat on a clipboard`}
            aria-label={t`What the icon shows`}
            className="h-8 min-w-0 flex-1 rounded-lg border border-foreground/[0.1] bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={redraw.isPending}
            onClick={() => redraw.mutate()}
          >
            {t`Draw a new icon`}
          </Button>
        </div>
        {redraw.isError ? (
          <p role="alert" className="text-[12px] text-destructive">
            {redraw.error instanceof Error ? redraw.error.message : t`The icon couldn't be drawn.`}
          </p>
        ) : null}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-foreground">{t`Who can change the data`}</h3>
        <p className="text-[12px] text-muted-foreground">
          {t`Anyone you share the app with can always see it. Visitors using the password only read.`}
        </p>
        <div className="flex flex-col gap-1.5">
          {(
            [
              ["owner", t`Only me`, t`Others see the data but can't change it.`],
              [
                "contribute",
                t`Colleagues add their own`,
                t`Signed-in colleagues add rows and change only the ones they added (forms, timesheets, inspections).`,
              ],
              [
                "company",
                t`Anyone at OCSC with the link`,
                t`Signed-in colleagues can add, edit and remove rows.`,
              ],
            ] as const
          ).map(([value, label, detail]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-foreground/[0.08] px-3 py-2.5 has-checked:border-primary/50 has-checked:bg-primary/[0.06]"
            >
              <input
                type="radio"
                name="app-data-access"
                className="mt-0.5 accent-primary"
                checked={current === value}
                disabled={!current || access.isPending}
                onChange={() => access.mutate(value)}
              />
              <span className="flex flex-col">
                <span className="text-[13px] text-foreground">{label}</span>
                <span className="text-[12px] text-muted-foreground">{detail}</span>
              </span>
            </label>
          ))}
        </div>
      </section>
      <AppPublishSection pageId={pageId} title={title} />
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-foreground">{t`Pictures`}</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? <Spinner /> : <ImagePlus />}
            {t`Add picture`}
          </Button>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={PICTURE_TYPES}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          {t`The app shows these by id, and the bot can add infographics and generated images here.`}
        </p>
        {uploadError ? (
          <p role="alert" className="text-[12px] text-destructive">
            {uploadError}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {(assets.data ?? [])
            .filter((asset) => asset.source !== "icon")
            .map((asset) => (
              <li
                key={asset.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground">{asset.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {asset.id} · {Math.ceil(asset.size / 1024)} KB · {asset.source}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t`Remove ${asset.name}`}
                  onClick={() => remove.mutate(asset.id)}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          {assets.data?.length === 0 ? (
            <li className="px-2 text-[12px] text-muted-foreground">{t`No pictures yet.`}</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
