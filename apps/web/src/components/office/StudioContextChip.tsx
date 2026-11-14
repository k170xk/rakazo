import type { DocumentFormat, StudioNoteChip } from "@rakazo/contracts";
import { studioNoteChip } from "@rakazo/contracts";
import { OFFICE_STUDIOS } from "./registry";

const FORMAT: Record<StudioNoteChip["kind"], DocumentFormat> = {
  word: "docx",
  slides: "pptx",
  sheet: "xlsx",
};

/** The Word, PowerPoint or Excel tile icon for a studio chip. */
export function studioChipIcon(kind: StudioNoteChip["kind"]): string {
  return OFFICE_STUDIOS[FORMAT[kind]].icon;
}

/** "Report · Page 3 · Table: BIM essentials", or the name alone. */
export function studioChipText(chip: Pick<StudioNoteChip, "title" | "label">): string {
  return chip.label ? `${chip.title} · ${chip.label}` : chip.title;
}

/**
 * The open document a sent message was about, on its own line before the text, drawn like the
 * page chip App Studio and Whiteboard messages carry.
 */
export function MessageStudioChip({ text }: { text: string }) {
  const chip = studioNoteChip(text);
  if (!chip) return null;
  return (
    <>
      <span
        className="rk-chat-page-chip"
        data-testid="message-studio-chip"
        style={{ cursor: "default" }}
      >
        <img
          src={studioChipIcon(chip.kind)}
          alt=""
          aria-hidden="true"
          className="rk-chat-page-chip-icon"
          style={{ width: "1.0625em" }}
        />
        <span className="rk-chat-page-chip-title">{studioChipText(chip)}</span>
      </span>
      {"\n"}
    </>
  );
}
