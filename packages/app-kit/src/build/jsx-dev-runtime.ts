import { Fragment, jsx, jsxs } from "react/jsx-runtime";

export { Fragment };

type Source = { fileName?: string; lineNumber?: number; columnNumber?: number } | undefined;

/**
 * Preview builds compile JSX in development form so each element knows where it was written.
 * Elements from the app's own files get a data-loc attribute ("App.tsx:12:7") that the Studio's
 * picker reads; everything else renders exactly as in a published build.
 */
export function jsxDEV(type: unknown, props: Record<string, unknown>, key: unknown, isStatic: boolean, source: Source) {
  if (typeof type === "string" && source?.fileName?.startsWith("app:")) {
    props = { ...props, "data-loc": `${source.fileName.slice(4)}:${source.lineNumber ?? 0}:${source.columnNumber ?? 0}` };
  }
  return (isStatic ? jsxs : jsx)(type as never, props, key as never);
}
