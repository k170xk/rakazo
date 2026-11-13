import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { locClass } from "../loc.js";

export { Fragment };

type Source = { fileName?: string; lineNumber?: number; columnNumber?: number } | undefined;

/**
 * Preview builds compile JSX in development form so each element knows where it was written.
 * Elements from the app's own files get a data-loc attribute ("App.tsx:12:7") that the Studio's
 * picker reads; kit components get the same place as a class, which they pass to the element
 * they draw, so a click on a Button points at the Button. Everything else renders exactly as in
 * a published build.
 */
export function jsxDEV(type: unknown, props: Record<string, unknown>, key: unknown, isStatic: boolean, source: Source) {
  if (source?.fileName?.startsWith("app:") && type !== Fragment) {
    const loc = `${source.fileName.slice(4)}:${source.lineNumber ?? 0}:${source.columnNumber ?? 0}`;
    if (typeof type === "string") props = { ...props, "data-loc": loc };
    else if (props.className === undefined || typeof props.className === "string") {
      props = { ...props, className: props.className ? `${props.className} ${locClass(loc)}` : locClass(loc) };
    }
  }
  return (isStatic ? jsxs : jsx)(type as never, props, key as never);
}
