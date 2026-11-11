import { ImageIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useAsset } from "../sdk/index.js";
import { Skeleton } from "./basic.js";
import { cn, ease } from "./cn.js";

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
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-3 lg:grid-cols-4",
  }[columns];
  return (
    <div className={cn("grid grid-cols-1 gap-3", cols)}>
      {assets.map((item) => (
        <figure
          key={item.id}
          className="overflow-hidden rounded-xl border border-border/70 bg-card"
        >
          <AssetImage asset={item.id} className="aspect-[4/3] w-full" />
          {item.caption && (
            <figcaption className="px-3 py-2 text-xs text-muted-foreground">
              {item.caption}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
