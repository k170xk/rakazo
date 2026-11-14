import { t as translate } from "@lingui/core/macro";
import type { DocumentFormat } from "@rakazo/contracts";
import { DOCUMENT_MIME_TYPES } from "@rakazo/contracts";
import type { ComponentType, LazyExoticComponent } from "react";
import { lazy } from "react";

/** What every document studio takes: the file family to open, and how to leave or switch. */
export type OfficeStudioProps = {
  rootArtifactId: string;
  onClose: () => void;
  onOpenDocument: (rootArtifactId: string) => void;
};

export type OfficeStudioEntry = {
  format: DocumentFormat;
  /** The tile's name: Word, PowerPoint or Excel. */
  label: () => string;
  extension: `.${DocumentFormat}`;
  mimeType: string;
  /** For `<input type="file" accept>`. */
  accept: string;
  icon: string;
  /** Null while the studio is still being built; its tile and Open buttons stay off. */
  Studio: LazyExoticComponent<ComponentType<OfficeStudioProps>> | null;
};

function entry(
  format: DocumentFormat,
  label: () => string,
  icon: string,
  Studio: OfficeStudioEntry["Studio"],
): OfficeStudioEntry {
  const mimeType = DOCUMENT_MIME_TYPES[format];
  return {
    format,
    label,
    extension: `.${format}`,
    mimeType,
    accept: `.${format},${mimeType}`,
    icon,
    Studio,
  };
}

export const OFFICE_STUDIOS: Readonly<Record<DocumentFormat, OfficeStudioEntry>> = {
  docx: entry(
    "docx",
    () => translate`Word`,
    "/icons/studios/word.png",
    lazy(() => import("./WordStudio")),
  ),
  pptx: entry(
    "pptx",
    () => translate`PowerPoint`,
    "/icons/studios/powerpoint.png",
    lazy(() => import("./SlidesStudio")),
  ),
  xlsx: entry(
    "xlsx",
    () => translate`Excel`,
    "/icons/studios/excel.png",
    lazy(() => import("./SheetStudio")),
  ),
};

export const OFFICE_FORMATS: readonly DocumentFormat[] = ["docx", "pptx", "xlsx"];

export function officeStudioReady(format: DocumentFormat): boolean {
  return OFFICE_STUDIOS[format].Studio !== null;
}

/** The studio format for a file's MIME type or name, when it has a studio that opens it. */
export function officeFormatOfFile(name: string, mimeType: string): DocumentFormat | null {
  const lower = name.toLowerCase();
  for (const format of OFFICE_FORMATS) {
    if (mimeType === DOCUMENT_MIME_TYPES[format] || lower.endsWith(`.${format}`)) return format;
  }
  return null;
}
