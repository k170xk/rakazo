// Imported with { type: "text" } and { type: "bytes" }; esbuild inlines them into the app bundle.
declare module "*.css" {
  const text: string;
  export default text;
}

declare module "*.woff2" {
  const bytes: Uint8Array;
  export default bytes;
}
