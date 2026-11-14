import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Callout, SampleBanner } from "./basic.js";
import { AreaChart, DonutChart } from "./charts.js";
import { Markdown } from "./content.js";
import { isoDate, matchesWords } from "./pickers.js";
import { RecordDetail, RecordForm } from "./records.js";
import { AudioPlayer, ImageViewer, SketchPad, SplitPane, VideoPlayer } from "./studio-media.js";
import { themeCss } from "./theme.js";
import { ActionList, CalendarMonth } from "./views.js";

describe("Markdown", () => {
  it("renders headings, emphasis, lists, tables and code", () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {
          "## Fees\n\nUp **12%** on *last* month, see `Q3`.\n\n- Dublin\n- Cork\n\n1. First\n2. Second\n\n| Office | Jobs |\n| --- | --- |\n| Dublin | 42 |\n\n> A quote\n\n```\nconst a = 1;\n```"
        }
      </Markdown>,
    );
    expect(html).toContain("<h4");
    expect(html).toContain("<strong>12%</strong>");
    expect(html).toContain("<em>last</em>");
    expect(html).toContain("<code");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain('<td class="px-3 py-2">42</td>');
    expect(html).toContain("<blockquote");
    expect(html).toContain("const a = 1;");
  });

  it("never turns text into markup or script links", () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {'<img src=x onerror="alert(1)"> [bad](javascript:alert(1)) [good](https://ocsc.ie)'}
      </Markdown>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://ocsc.ie"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("matchesWords", () => {
  it("needs every word, in any order, ignoring case and accents", () => {
    expect(matchesWords("Seán Murphy", "sean")).toBe(true);
    expect(matchesWords("Seán Murphy", "murphy SEAN")).toBe(true);
    expect(matchesWords("Seán Murphy", "sean kelly")).toBe(false);
    expect(matchesWords("Anything", "  ")).toBe(true);
  });
});

describe("isoDate", () => {
  it("uses the local calendar day", () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("themeCss", () => {
  it("is empty for the standard look", () => {
    expect(themeCss({})).toBe("");
  });

  it("sets light and dark values so the person's mode keeps working", () => {
    const css = themeCss({ preset: "forest", radius: "lg", density: "compact" });
    expect(css).toContain("html{--radius:1rem;font-size:15px}");
    expect(css).toContain("html:not(.dark){--surface:100 22% 97%");
    expect(css).toContain("html.dark{--surface:120 12% 5%");
  });

  it("offers only greens for the primary colour", () => {
    const css = themeCss({ green: "teal" });
    expect(css).toContain("--primary:172 62% 34%");
    expect(css).toContain("--ring:172 62% 34%");
  });
});

describe("kit charts", () => {
  it("render without recharts on the server (no width yet, no crash)", () => {
    const area = renderToStaticMarkup(
      <AreaChart data={[{ m: "Jan", v: 1 }]} x="m" series={["v"]} />,
    );
    expect(area).toContain("height:280px");
    const donut = renderToStaticMarkup(
      <DonutChart
        data={[
          { label: "Dublin", value: 3 },
          { label: "Cork", value: 1 },
        ]}
      />,
    );
    expect(donut).toContain("Dublin");
    expect(donut).toContain("75%");
    expect(donut).toContain(">4<");
  });
});

describe("SampleBanner, Callout and hidden columns", () => {
  it("shows SampleBanner only while is_sample rows exist", () => {
    const empty = renderToStaticMarkup(
      <SampleBanner tables={[{ rows: [{ _id: "1", name: "Real" }], canEdit: true, remove: async () => {} }]} />,
    );
    expect(empty).toBe("");

    const shown = renderToStaticMarkup(
      <SampleBanner
        tables={[{ rows: [{ _id: "1", is_sample: true }, { _id: "2", is_sample: false }], canEdit: true, remove: async () => {} }]}
      />,
    );
    expect(shown).toContain("Exploring with 1 sample record");
    expect(shown).toContain("Clear sample data");
  });

  it("renders theme-safe Callout and hides hidden: true columns in forms and detail", () => {
    const banner = renderToStaticMarkup(
      <Callout tone="warning" title="Unverified">
        Check before issuing.
      </Callout>,
    );
    expect(banner).toContain("Unverified");
    expect(banner).toContain("Check before issuing.");

    const schema = {
      name: "items",
      label: "Items",
      columns: [
        { key: "name", label: "Name", type: "text" as const },
        { key: "is_sample", label: "Sample", type: "boolean" as const, hidden: true },
      ],
    };
    const detail = renderToStaticMarkup(
      <RecordDetail schema={schema} row={{ _id: "1", name: "Beam", is_sample: true }} />,
    );
    expect(detail).toContain("Beam");
    expect(detail).not.toContain("Sample");

    const form = renderToStaticMarkup(
      <RecordForm schema={schema} value={{ name: "Beam", is_sample: true }} onChange={() => {}} />,
    );
    expect(form).toContain("Name");
    expect(form).not.toContain("Sample");
  });

  it("renders ActionList, CalendarMonth modes, VideoPlayer, AudioPlayer, ImageViewer, SketchPad and SplitPane", () => {
    const list = renderToStaticMarkup(
      <ActionList
        items={[
          { id: "1", title: "STR-001", subtitle: "Riverside Offices", badge: "Overdue", tone: "danger", meta: "2 Nov" },
        ]}
      />,
    );
    expect(list).toContain("STR-001");
    expect(list).toContain("Overdue");

    const cal = renderToStaticMarkup(
      <CalendarMonth
        rows={[{ _id: "1", due: "2026-11-14", name: "Core pour", status: "Live" }]}
        dateKey="due"
        titleKey="name"
        toneKey="status"
        defaultView="agenda"
      />,
    );
    expect(cal).toContain("Core pour");
    expect(cal).toContain("agenda");

    const studio = renderToStaticMarkup(
      <SplitPane
        left={<VideoPlayer title="Site walkdown" chapters={[{ time: 0, label: "Entrance" }]} />}
        right={
          <div>
            <AudioPlayer title="Voice note" />
            <ImageViewer title="GA Plan" />
            <SketchPad label="Redline" />
          </div>
        }
      />,
    );
    expect(studio).toContain("Entrance");
    expect(studio).toContain("GA Plan");
    expect(studio).toContain("Redline");
  });
});
