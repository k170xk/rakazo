import { Trash2 } from "lucide-react";

/** Shown on a switcher row while the pointer is over it, and always on a phone. */
export function StudioSwitcherDelete({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid="studio-switcher-delete"
      className="hidden size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none group-focus-within/dropdown-menu-item:grid group-hover/dropdown-menu-item:grid pointer-coarse:grid max-sm:grid"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDelete();
      }}
    >
      <Trash2 className="size-3.5" strokeWidth={1.8} />
    </button>
  );
}
