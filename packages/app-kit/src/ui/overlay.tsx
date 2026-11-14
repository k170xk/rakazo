import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { Button } from "./basic.js";
import { cn } from "./cn.js";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open, onClose]);
}

function Backdrop({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-40 bg-[hsl(222_47%_6%/0.42)] backdrop-blur-[3px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    />
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEscape(open, onClose);
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClose={onClose} />
          {/* On a phone a dialog rises from the bottom like an iOS sheet, full width. */}
          <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className={cn(
                "pointer-events-auto flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-popover text-popover-foreground shadow-lift sm:max-h-[min(90vh,860px)] sm:rounded-2xl",
                width,
              )}
            >
              {(title || description) && (
                <div className="flex items-start justify-between gap-4 border-b border-border/70 px-6 py-4">
                  <div>
                    {title && <h2 className="text-lg font-bold tracking-tight">{title}</h2>}
                    {description && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                    <X />
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
              {footer && (
                <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/30 px-6 py-3.5">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** A panel that slides in from the right, for a record's details or a form. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <Backdrop onClose={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            style={{ width: `min(${width}px, 100vw)` }}
            className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-border bg-popover text-popover-foreground shadow-lift"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/70 px-6 py-4">
              <div className="min-w-0">
                {title && <h2 className="truncate text-lg font-bold tracking-tight">{title}</h2>}
                {description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/30 px-6 py-3.5">
                {footer}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Asks before something that cannot be undone. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  description,
  confirmLabel = "Delete",
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

type ToastItem = {
  id: number;
  title: string;
  description?: string;
  tone: "success" | "error" | "info";
};
let toasts: ToastItem[] = [];
let toastId = 0;
const toastListeners = new Set<() => void>();
let toasterMounted = false;

function emitToasts() {
  for (const listener of toastListeners) listener();
}

function Toaster() {
  const list = useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {list.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-popover px-4 py-3 shadow-lift"
          >
            <span
              className={cn(
                "mt-0.5 [&_svg]:size-[18px]",
                item.tone === "success"
                  ? "text-success"
                  : item.tone === "error"
                    ? "text-destructive"
                    : "text-info",
              )}
            >
              {item.tone === "success" ? (
                <CircleCheck />
              ) : item.tone === "error" ? (
                <TriangleAlert />
              ) : (
                <Info />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{item.title}</p>
              {item.description && (
                <p className="mt-0.5 text-[13px] text-muted-foreground">{item.description}</p>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ensureToaster() {
  if (toasterMounted || typeof document === "undefined") return;
  toasterMounted = true;
  const element = document.createElement("div");
  document.body.append(element);
  createRoot(element).render(<Toaster />);
}

function push(tone: ToastItem["tone"], title: string, description?: string) {
  ensureToaster();
  toastId += 1;
  const id = toastId;
  toasts = [...toasts.slice(-3), { id, title, description, tone }];
  emitToasts();
  setTimeout(
    () => {
      toasts = toasts.filter((item) => item.id !== id);
      emitToasts();
    },
    tone === "error" ? 6000 : 3600,
  );
}

/** Short confirmations in the corner: toast.success("Saved"). */
export const toast = Object.assign(
  (title: string, description?: string) => push("info", title, description),
  {
    success: (title: string, description?: string) => push("success", title, description),
    error: (title: string, description?: string) => push("error", title, description),
  },
);

/** A button that opens a small list of actions. */
export function Menu({
  trigger,
  items,
  align = "end",
}: {
  trigger: ReactNode;
  items: Array<
    { label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean } | "divider"
  >;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const listener = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the trigger is a button of its own; this only listens */}
      <span
        role="presentation"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setOpen(true);
        }}
      >
        {trigger}
      </span>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className={cn(
              "absolute top-full z-50 mt-1.5 min-w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lift",
              align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            {items.map((item, index) =>
              item === "divider" ? (
                <div key={index} className="my-1 h-px bg-border" />
              ) : (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-muted [&_svg]:size-4",
                    item.danger ? "text-destructive" : "text-foreground",
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
