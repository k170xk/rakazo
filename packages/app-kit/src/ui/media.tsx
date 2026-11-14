import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  LoaderCircle,
  Pencil,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imageIds, MAX_IMAGES_PER_CELL } from "../schema.js";
import type { PhotoInfo } from "../sdk/index.js";
import { uploadImage, uploadPhoto, useAsset, useCanUpload } from "../sdk/index.js";
import { Skeleton } from "./basic.js";
import { cn, ease } from "./cn.js";
import { PhotoMarkup } from "./markup.js";
import { toast } from "./overlay.js";

/** A picture the app keeps, by asset id, with a shimmer while it loads. */
export function AssetImage({
  asset,
  alt = "",
  className,
  fit = "cover",
}: {
  asset: string | null | undefined;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const url = useAsset(asset);
  if (!asset) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
      >
        <ImageIcon className="size-6" />
      </div>
    );
  }
  if (!url) return <Skeleton className={cn("rounded-none", className)} />;
  return (
    <motion.img
      src={url}
      alt={alt}
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease }}
      className={cn(fit === "cover" ? "object-cover" : "object-contain", className)}
    />
  );
}

/**
 * A wide banner for the top of a page: a picture (an infographic, a site photo) or the brand
 * gradient, with the title over it.
 */
export function Hero({
  eyebrow,
  title,
  description,
  asset,
  actions,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  asset?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease }}
      className={cn(
        "relative isolate mb-7 overflow-hidden rounded-3xl border border-border/60 bg-[linear-gradient(135deg,hsl(110_40%_16%),hsl(95_49%_30%)_55%,hsl(95_49%_45%))] text-white shadow-lift",
        className,
      )}
    >
      {asset && (
        <AssetImage
          asset={asset}
          className="absolute inset-0 -z-10 h-full w-full opacity-45 mix-blend-luminosity"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,hsl(0_0%_100%/0.18),transparent_55%)]" />
      <div className="absolute inset-0 -z-10 bg-grid opacity-[0.08]" />
      <div className="flex flex-col gap-6 px-7 py-9 sm:px-10 sm:py-11 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          {eyebrow && (
            <p className="mb-2 text-xs font-bold tracking-[0.16em] text-white/75 uppercase">
              {eyebrow}
            </p>
          )}
          <h2 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">{title}</h2>
          {description && (
            <p className="mt-3 text-[15px] leading-relaxed text-white/80">{description}</p>
          )}
          {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </motion.section>
  );
}

export function ImageCard({
  asset,
  title,
  description,
  footer,
  onClick,
  className,
}: {
  asset?: string | null;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onClick={onClick}
      className={cn(
        "group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card transition-shadow hover:shadow-lift",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <div className="aspect-[16/10] overflow-hidden">
        <AssetImage
          asset={asset}
          alt={typeof title === "string" ? title : ""}
          className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <div className="p-4">
        <p className="truncate text-[15px] font-semibold">{title}</p>
        {description && (
          <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{description}</p>
        )}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </motion.div>
  );
}

/** A grid of pictures that open full size. */
export function Gallery({
  assets,
  columns = 3,
}: {
  assets: Array<{ id: string; caption?: string }>;
  columns?: 2 | 3 | 4;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-3 lg:grid-cols-4",
  }[columns];
  return (
    <>
      <div className={cn("grid grid-cols-1 gap-3", cols)}>
        {assets.map((item, index) => (
          <figure
            key={item.id}
            className="group overflow-hidden rounded-xl border border-border/70 bg-card transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lift"
          >
            <button type="button" className="block w-full overflow-hidden" onClick={() => setOpen(index)}>
              <AssetImage asset={item.id} className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-[1.04]" />
            </button>
            {item.caption && (
              <figcaption className="px-3 py-2 text-xs text-muted-foreground">
                {item.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      <Lightbox
        ids={assets.map((item) => item.id)}
        captions={assets.map((item) => item.caption)}
        index={open}
        onIndex={setOpen}
      />
    </>
  );
}

/** Pictures full screen, with arrows and keys to move between them and Escape to close. */
export function Lightbox({
  ids,
  captions,
  index,
  onIndex,
}: {
  ids: string[];
  captions?: Array<string | undefined>;
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const current = index === null ? null : ids[index];
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onIndex(null);
      if (event.key === "ArrowRight") onIndex((index + 1) % ids.length);
      if (event.key === "ArrowLeft") onIndex((index - 1 + ids.length) % ids.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, ids.length, onIndex]);
  if (typeof document === "undefined") return null;
  const arrow =
    "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20";
  return createPortal(
    <AnimatePresence>
      {current && index !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-4 sm:p-10"
          onClick={() => onIndex(null)}
        >
          <motion.div
            key={current}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease }}
            className="flex max-h-full w-full max-w-5xl flex-1 items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <AssetImage asset={current} fit="contain" className="max-h-[80vh] w-full rounded-xl" />
          </motion.div>
          <p className="mt-3 text-sm text-white/80 tabular">
            {captions?.[index] ? `${captions[index]} · ` : ""}
            {index + 1} / {ids.length}
          </p>
          <button
            type="button"
            aria-label="Close"
            className="absolute top-4 right-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => onIndex(null)}
          >
            <X className="size-5" />
          </button>
          {ids.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous"
                className={cn(arrow, "left-3")}
                onClick={(event) => {
                  event.stopPropagation();
                  onIndex((index - 1 + ids.length) % ids.length);
                }}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Next"
                className={cn(arrow, "right-3")}
                onClick={(event) => {
                  event.stopPropagation();
                  onIndex((index + 1) % ids.length);
                }}
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** The photos of an image cell as small thumbnails that open full size. */
export function Photos({
  value,
  size = "md",
  limit = 4,
}: {
  value: unknown;
  size?: "sm" | "md" | "lg";
  limit?: number;
}) {
  const ids = imageIds(value);
  const [open, setOpen] = useState<number | null>(null);
  if (!ids.length) return null;
  const box = { sm: "size-8 rounded-md", md: "size-14 rounded-lg", lg: "size-24 rounded-xl" }[size];
  const extra = ids.length - limit;
  return (
    <div className="flex items-center gap-1.5">
      {ids.slice(0, limit).map((id, index) => (
        <button
          key={id}
          type="button"
          className={cn("relative shrink-0 overflow-hidden ring-1 ring-border/70", box)}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(index);
          }}
        >
          <AssetImage asset={id} className="h-full w-full" />
          {index === limit - 1 && extra > 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-bold text-white">
              +{extra}
            </span>
          )}
        </button>
      ))}
      <Lightbox ids={ids} index={open} onIndex={setOpen} />
    </div>
  );
}

/**
 * Photos for an image column: take one with the camera or choose from the library (several at
 * once), see them as thumbnails, open full size and remove. The value is the cell's text (picture
 * ids joined by commas), so it goes straight into insert and update. onPhoto hears each added
 * photo with where and when it was taken (the camera's GPS, else the device's position for a
 * photo just taken), for geotagged site photos.
 */
export function PhotoInput({
  value,
  onChange,
  onPhoto,
  markup,
  max = MAX_IMAGES_PER_CELL,
  label = "Add photo",
  disabled,
}: {
  value: unknown;
  onChange: (value: string | null) => void;
  onPhoto?: (photo: PhotoInfo) => void;
  /** A pencil on each photo to mark it up; the marked-up copy takes the original's place. */
  markup?: boolean;
  max?: number;
  label?: string;
  disabled?: boolean;
}) {
  const ids = imageIds(value);
  const canUpload = useCanUpload() && !disabled;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const latest = useRef(ids);
  latest.current = ids;
  const limit = Math.min(max, MAX_IMAGES_PER_CELL);

  const add = async (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, Math.max(0, limit - ids.length));
    if (!picked.length) return;
    setBusy((count) => count + picked.length);
    for (const file of picked) {
      try {
        const photo = onPhoto
          ? await uploadPhoto(file, { locate: true })
          : { id: await uploadImage(file) };
        const next = [...latest.current, photo.id].slice(0, limit);
        latest.current = next;
        onChange(next.join(","));
        onPhoto?.(photo);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That photo could not be added.");
      } finally {
        setBusy((count) => count - 1);
      }
    }
  };
  const remove = (id: string) => {
    const next = ids.filter((item) => item !== id);
    onChange(next.length ? next.join(",") : null);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id, index) => (
        <motion.div
          key={id}
          layout
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="group relative size-24 overflow-hidden rounded-xl ring-1 ring-border/70"
        >
          <button type="button" className="h-full w-full" onClick={() => setOpen(index)}>
            <AssetImage asset={id} className="h-full w-full" />
          </button>
          {canUpload && markup && (
            <button
              type="button"
              aria-label="Mark up photo"
              onClick={() => setMarking(id)}
              className="absolute top-1 left-1 flex size-8 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {canUpload && (
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => remove(id)}
              className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          )}
        </motion.div>
      ))}
      {Array.from({ length: busy }, (_, index) => (
        <div
          key={`busy-${index}`}
          className="flex size-24 items-center justify-center rounded-xl bg-muted"
        >
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ))}
      {canUpload && ids.length + busy < limit && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex size-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
        >
          <Camera className="size-5" />
          {label}
        </button>
      )}
      {!canUpload && ids.length === 0 && <p className="text-sm text-muted-foreground">No photos</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple={limit - ids.length > 1}
        className="hidden"
        onChange={(event) => {
          void add(event.target.files);
          event.target.value = "";
        }}
      />
      <Lightbox ids={ids} index={open} onIndex={setOpen} />
      {markup && (
        <PhotoMarkup
          photo={marking}
          open={marking !== null}
          onClose={() => setMarking(null)}
          onSave={(saved) => {
            const next = latest.current.map((item) => (item === marking ? saved : item));
            latest.current = next;
            onChange(next.join(","));
          }}
        />
      )}
    </div>
  );
}
