import { useEffect, useState } from "react";

/**
 * A field in Jantt's task drawer, which Jantt builds as plain DOM appended to <body> and can
 * rebuild in place. Null while the drawer is closed or the field is disabled (read-only or locked).
 */
export function useJanttDrawerField<T extends HTMLInputElement | HTMLSelectElement>(
  id: string,
  type: { new (): T },
): T | null {
  const [field, setField] = useState<T | null>(null);
  useEffect(() => {
    const find = () => {
      const found = document.getElementById(id);
      setField(found instanceof type && !found.disabled ? found : null);
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [id, type]);
  return field;
}

const fieldKeys = new WeakMap<Element, number>();
let nextFieldKey = 0;

/** A React key per field element, so each drawer Jantt opens starts with fresh state. */
export function drawerFieldKey(field: Element): number {
  let value = fieldKeys.get(field);
  if (value === undefined) fieldKeys.set(field, (value = nextFieldKey++));
  return value;
}
