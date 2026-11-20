import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import type { EvolvePersonOption } from "@rakazo/contracts";
import { CircleCheck, CircleAlert } from "lucide-react";
import { PersonAvatar } from "../../GroupPeople";
import { drawerFieldKey, useJanttDrawerField } from "./drawer-field";
import { findEvolvePerson, matchEvolvePeople } from "./evolve-people";

const ASSIGNEE_INPUT_ID = "jantt-sidebar-assignee";
const MENU_MAX_PX = 300;

/**
 * Turns the task drawer's "Assignee / Owner" box into a search over Evolve's CV profiles. Jantt
 * still reads the box when "Save Changes" is pressed, so picking a person only fills in their name.
 */
export function EvolveAssigneePicker({ people }: { people: readonly EvolvePersonOption[] }) {
  const input = useJanttDrawerField(ASSIGNEE_INPUT_ID, HTMLInputElement);
  return input ? <AssigneeMenu key={drawerFieldKey(input)} input={input} people={people} /> : null;
}

function AssigneeMenu({ input, people }: { input: HTMLInputElement; people: readonly EvolvePersonOption[] }) {
  const { t } = useLingui();
  const [query, setQuery] = useState(input.value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [statusHost] = useState(() => document.createElement("div"));
  const matches = useMemo(() => matchEvolvePeople(people, query), [people, query]);
  const linked = findEvolvePerson(people, query);

  const pick = (person: EvolvePersonOption) => {
    input.value = person.name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setQuery(person.name);
    setOpen(false);
  };
  const pickRef = useLatest(pick);
  const stateRef = useLatest({ open, matches, highlight });

  useEffect(() => {
    const placeholder = input.placeholder;
    const autocomplete = input.autocomplete;
    input.placeholder = t`Search Evolve people`;
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.parentElement?.appendChild(statusHost);
    const place = () => setRect(input.getBoundingClientRect());
    const onFocus = () => {
      place();
      setOpen(true);
    };
    const onInput = () => {
      setQuery(input.value);
      setHighlight(0);
      place();
      setOpen(true);
    };
    const onBlur = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      const { open: isOpen, matches: options, highlight: index } = stateRef.current;
      if (!isOpen || !options.length) return;
      if (event.key === "ArrowDown") setHighlight(Math.min(index + 1, options.length - 1));
      else if (event.key === "ArrowUp") setHighlight(Math.max(index - 1, 0));
      else if (event.key === "Enter") pickRef.current(options[Math.min(index, options.length - 1)]!);
      else if (event.key === "Escape") setOpen(false);
      else return;
      // Escape would otherwise close the whole drawer, and Enter would reach Jantt.
      event.preventDefault();
      event.stopPropagation();
    };
    input.addEventListener("focus", onFocus);
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    input.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      input.placeholder = placeholder;
      input.autocomplete = autocomplete;
      input.removeAttribute("role");
      statusHost.remove();
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [input, statusHost, t, pickRef, stateRef]);

  const below = rect ? window.innerHeight - rect.bottom : 0;
  const flip = rect !== null && below < MENU_MAX_PX && rect.top > below;

  return (
    <>
      {createPortal(
        query.trim() ? (
          <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-tight text-muted-foreground">
            {linked ? (
              <>
                <CircleCheck size={13} className="shrink-0 text-success" aria-hidden="true" />
                <span className="truncate">
                  <Trans>Evolve profile</Trans>
                  {linked.jobTitle ? ` · ${linked.jobTitle}` : ""}
                </span>
              </>
            ) : (
              <>
                <CircleAlert size={13} className="shrink-0 text-warning" aria-hidden="true" />
                <span title={t`Pick someone from the list to link their Evolve CV.`}>
                  <Trans>Not linked to Evolve</Trans>
                </span>
              </>
            )}
          </p>
        ) : null,
        statusHost,
      )}
      {open && rect
        ? createPortal(
            <div
              role="listbox"
              aria-label={t`Evolve people`}
              className="fixed overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{
                zIndex: 1001,
                left: rect.left,
                width: Math.max(rect.width, 260),
                maxHeight: MENU_MAX_PX,
                ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              {matches.map((person, index) => (
                <div
                  key={person.id}
                  role="option"
                  aria-selected={index === highlight}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                    index === highlight ? "bg-accent" : ""
                  }`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(person)}
                >
                  <PersonAvatar name={person.name} image={person.photo} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground" dir="auto">
                      {person.name}
                    </span>
                    {person.jobTitle ? (
                      <span className="block truncate text-[11.5px] text-muted-foreground">{person.jobTitle}</span>
                    ) : null}
                  </span>
                </div>
              ))}
              {matches.length === 0 ? (
                <p className="px-2.5 py-2.5 text-[12.5px] text-muted-foreground">
                  <Trans>No Evolve profile matches. The name is kept as typed.</Trans>
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
