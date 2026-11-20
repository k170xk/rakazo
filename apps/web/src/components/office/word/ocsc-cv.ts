/**
 * The OCSC CV Generator template is one tall two-column table. Microsoft Word splits those
 * rows across pages; Folio's editor often shows them as a single long page. The page-aware
 * preview handles that layout the same way Word does.
 */
export function isOcscCvDocx(bytes: ArrayBuffer | Uint8Array): boolean {
  const sample = new TextDecoder("latin1").decode(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
  return sample.includes("Curriculum Vitae") && sample.includes("header1.xml");
}
