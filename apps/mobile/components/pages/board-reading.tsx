import { readBoardItems } from "@rakazo/contracts";
import { ScrollView, Text } from "react-native";

/** A whiteboard on a phone: the words, top to bottom. Editing stays on the web and desktop board. */
export function BoardReading({ code, color }: { code: string; color: string }) {
  const items = readBoardItems(code);
  const byId = new Map(items.map((item) => [item.id, item]));
  const nameOf = (id: string) => {
    const item = byId.get(id);
    return item?.text?.trim() || id;
  };
  const rows = items
    .filter((item) => item.kind !== "pen" && item.kind !== "image")
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x);
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48, gap: 16 }}>
      {rows.map((item) => {
        const from = item.from && "item" in item.from ? nameOf(item.from.item) : "";
        const to = item.to && "item" in item.to ? nameOf(item.to.item) : "";
        const text =
          item.kind === "arrow"
            ? `${from} → ${to}${item.text?.trim() ? `  ${item.text.trim()}` : ""}`
            : (item.text ?? "").trim();
        if (!text) return null;
        return (
          <Text
            key={item.id}
            style={{
              color,
              fontSize: item.kind === "section" ? 13 : 17,
              lineHeight: item.kind === "section" ? 18 : 24,
              fontWeight: item.kind === "section" || item.kind === "text" ? "600" : "400",
            }}
          >
            {text}
          </Text>
        );
      })}
    </ScrollView>
  );
}
