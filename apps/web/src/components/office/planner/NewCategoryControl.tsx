import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@rakazo/ui-web";
import { Check } from "lucide-react";
import { CATEGORY_COLOURS, categoryKey, nextCategoryColour, type PlanCategory } from "./categories";
import { drawerFieldKey, useJanttDrawerField } from "./drawer-field";

const CATEGORY_SELECT_ID = "jantt-sidebar-category";
const NEW_OPTION = "__planner_new_category__";

type Props = {
  categories: Readonly<Record<string, PlanCategory>>;
  onCreate: (key: string, category: PlanCategory) => void;
};

/**
 * Adds "New category…" to the task drawer's Category list. Jantt reads the list when "Save Changes"
 * is pressed, so a new category is selected there and added to the plan when that save commits.
 */
export function NewCategoryControl(props: Props) {
  const select = useJanttDrawerField(CATEGORY_SELECT_ID, HTMLSelectElement);
  return select ? <CategoryForm key={drawerFieldKey(select)} select={select} {...props} /> : null;
}

function CategoryForm({ select, categories, onCreate }: Props & { select: HTMLSelectElement }) {
  const { t } = useLingui();
  const [host] = useState(() => document.createElement("div"));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(() => nextCategoryColour(Object.values(categories)));

  useEffect(() => {
    const option = document.createElement("option");
    option.value = NEW_OPTION;
    option.textContent = t`+ New category…`;
    select.appendChild(option);
    select.parentElement?.appendChild(host);
    let previous = select.value;
    const onChange = () => {
      if (select.value !== NEW_OPTION) {
        previous = select.value;
        return;
      }
      // Keep the real category selected until the new one is added; Jantt must never save the marker.
      select.value = previous;
      setOpen(true);
    };
    select.addEventListener("change", onChange);
    return () => {
      select.removeEventListener("change", onChange);
      option.remove();
      host.remove();
    };
  }, [select, host, t]);

  const label = name.trim();
  const add = () => {
    if (!label) return;
    const taken = new Set([...select.options].map((option) => option.value));
    const existing = [...select.options].find(
      (option) => option.value !== NEW_OPTION && option.textContent?.trim().toLowerCase() === label.toLowerCase(),
    );
    const key = existing?.value ?? categoryKey(label, taken);
    if (!existing) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      select.insertBefore(option, select.querySelector(`option[value="${NEW_OPTION}"]`));
      onCreate(key, { label, color: colour });
    }
    select.value = key;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setName("");
    setOpen(false);
  };

  if (!open) return null;
  return createPortal(
    <div
      className="mt-2 flex flex-col gap-2.5 rounded-xl border border-border bg-background/60 p-3"
      onKeyDown={(event) => {
        // Jantt closes the drawer on Escape from anywhere in the document.
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter") {
          event.preventDefault();
          add();
        }
        if (event.key === "Escape" || event.key === "Enter") event.nativeEvent.stopPropagation();
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t`Category name, e.g. Mechanical & Electrical`}
        aria-label={t`New category name`}
        maxLength={60}
        className="h-9 text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t`Category colour`}>
        {CATEGORY_COLOURS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            role="radio"
            aria-checked={swatch === colour}
            aria-label={swatch}
            onClick={() => setColour(swatch)}
            className="flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow aria-checked:ring-2 aria-checked:ring-foreground/60"
            style={{ background: swatch }}
          >
            {swatch === colour ? <Check size={13} className="text-white" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="button" size="sm" disabled={!label} onClick={add}>
          <Trans>Add category</Trans>
        </Button>
      </div>
    </div>,
    host,
  );
}
