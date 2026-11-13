import { LOC_CLASS_PREFIX, locFromClass } from "../loc.js";

/**
 * Finding what the app's code wrote under the pointer, for the Studio's element picker. Preview
 * builds tag app elements with data-loc and kit components with a place class, but a component
 * that draws from props (the shell's title and tabs, chart labels, dialog contents in a portal)
 * may not pass the class to anything on screen. React's own tree still links every node on screen
 * to the element that made it, so the picker climbs that tree, as React's developer tools do, and
 * falls back to the page's tags when it can't.
 */
export type Fiber = {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode: unknown;
  memoizedProps: unknown;
};

const FIBER_KEY = "__reactFiber$";
const CONTAINER_KEY = "__reactContainer$";

function internal<T>(node: object, prefix: string): T | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith(prefix)) return (node as Record<string, T>)[key] ?? null;
  }
  return null;
}

/** The place written on an element's props: data-loc, or the place class among its classes. */
export function locOfProps(props: unknown): string {
  if (!props || typeof props !== "object") return "";
  const values = props as Record<string, unknown>;
  const attribute = values["data-loc"];
  if (typeof attribute === "string" && attribute) return attribute;
  const className = values.className;
  if (typeof className !== "string" || !className.includes(LOC_CLASS_PREFIX)) return "";
  for (const name of className.split(/\s+/)) {
    const loc = locFromClass(name);
    if (loc) return loc;
  }
  return "";
}

/** The nearest element written in the app's code at or above a node, through portals too. */
export function sourceAt(node: Node | null): { loc: string; fiber: Fiber | null } | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    const fiber = internal<Fiber>(current, FIBER_KEY);
    if (!fiber) {
      if (current instanceof Element) {
        const loc =
          current.getAttribute("data-loc") ?? locOfProps({ className: current.className });
        if (loc) return { loc, fiber: null };
      }
      continue;
    }
    for (let at: Fiber | null = fiber; at; at = at.return) {
      const loc = locOfProps(at.memoizedProps);
      if (loc) return { loc, fiber: at };
    }
    return null;
  }
  return null;
}

/** The outermost page elements an element draws; a component can draw several, or one in a portal. */
export function hostNodes(fiber: Fiber): Element[] {
  if (fiber.stateNode instanceof Element) return [fiber.stateNode];
  const nodes: Element[] = [];
  for (let child = fiber.child; child; child = child.sibling) nodes.push(...hostNodes(child));
  return nodes;
}

function currentRoot(): Fiber | null {
  for (const element of document.querySelectorAll("body > *")) {
    const container = internal<{ stateNode?: { current?: Fiber } }>(element, CONTAINER_KEY);
    if (container) return container.stateNode?.current ?? (container as Fiber);
  }
  return null;
}

/** Every page element drawn by the element written at loc, each copy when it is in a list. */
export function nodesForLoc(loc: string): Element[] {
  const root = currentRoot();
  if (!root) return [];
  const found: Element[] = [];
  const stack: Fiber[] = [root];
  while (stack.length) {
    const fiber = stack.pop()!;
    if (locOfProps(fiber.memoizedProps) === loc) {
      found.push(...hostNodes(fiber));
      continue;
    }
    for (let child = fiber.child; child; child = child.sibling) stack.push(child);
  }
  return found;
}
