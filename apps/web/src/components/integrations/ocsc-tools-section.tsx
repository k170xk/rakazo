import { Trans, useLingui } from "@lingui/react/macro";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { OcscToolSkill } from "../../lib/ocsc-tools";
import { OCSC_TOOLS } from "../../lib/ocsc-tools";

type ToolStory = { tagline: string; abilities: string[]; tryAsking: string };

function useToolStories(): Record<OcscToolSkill, ToolStory> {
  const { t } = useLingui();
  return {
    "ocsc-word": {
      tagline: t`Branded Word reports, letters, memos and specifications.`,
      abilities: [
        t`Creates a finished OCSC document from a short brief, on the company template`,
        t`Edit it as many times as you like: ask for changes in plain words`,
        t`Every edit is a Word tracked change by "OCSC Bot", so you accept or reject each one`,
        t`Each round is saved as a new version (-v2, -v3), so earlier versions are never lost`,
        t`Compares two versions, or gives you a clean copy with every change accepted`,
        t`Adds infographics, tables, figures and real OCSC project photos`,
        t`Edits Word files you send it, keeping your original untouched`,
      ],
      tryAsking: t`Write a flood risk assessment for HEL18, then tighten the conclusions`,
    },
    "ocsc-slides": {
      tagline: t`PowerPoint decks on the OCSC template, ready to present.`,
      abilities: [
        t`Builds a deck from a brief, with the company fonts, colours, logo and footer`,
        t`Infographics on most slides, plus editable charts, tables and timelines`,
        t`Can add OCSC's company introduction and real project photos`,
        t`Slides come animated for presenting`,
        t`Edit any slide later; each changed slide gets a review comment saying what changed`,
        t`Saves each round as a new version and works on decks you send it`,
      ],
      tryAsking: t`Make a 10-slide bid presentation for a school extension`,
    },
    "ocsc-excel": {
      tagline: t`Spreadsheets, cost plans, registers and trackers.`,
      abilities: [
        t`Builds OCSC-styled workbooks with real formulas, totals and number formats`,
        t`Reads a workbook first, then edits cells, rows and sheets without breaking formulas`,
        t`Adding a line above a total grows the total to include it`,
        t`Saves each round as a new version and says what changed`,
      ],
      tryAsking: t`Turn these quantities into a cost plan with a total per trade`,
    },
    "ocsc-pdf": {
      tagline: t`Makes and reads PDFs.`,
      abilities: [
        t`Turns any OCSC Word report, deck or workbook into a clean PDF`,
        t`Can show tracked changes marked up in the PDF when you want them`,
        t`Reads PDFs you send it, so you can ask questions about them`,
      ],
      tryAsking: t`Send me that report as a PDF with the changes marked up`,
    },
    "ocsc-pdf-markup": {
      tagline: t`Marks up, audits and measures PDFs and drawings in Evolve PDF Studio.`,
      abilities: [
        t`Reads every page, existing comments and hidden information before judging`,
        t`Clouds, callouts, arrows and notes placed exactly where the issue is`,
        t`Sets the drawing scale, then measures lengths, areas and perimeters`,
        t`Totals quantities into a take-off schedule`,
        t`Sends back the marked-up PDF with a list of findings by page`,
      ],
      tryAsking: t`Audit this GA drawing against the brief and mark up anything missing`,
    },
    "ocsc-video": {
      tagline: t`Branded videos, explainers and social clips.`,
      abilities: [
        t`Plans the story scene by scene, then renders an .mp4`,
        t`Uses real OCSC project photos and stock footage`,
        t`Voiceover in OCSC Peter, Rory or Tim's voice`,
        t`Animated charts, statements and transitions; widescreen or vertical`,
        t`Change any scene and render again`,
      ],
      tryAsking: t`Make a 30-second LinkedIn clip about our latest bridge project`,
    },
    "evolve-plugin": {
      tagline: t`Your own dashboards, calculators and apps, built in the OCSC sandbox.`,
      abilities: [
        t`Describe a dashboard or tool and the agent builds it as an Evolve plugin`,
        t`Uses Evolve data you are allowed to see, nothing more`,
        t`Runs in a locked-down sandbox and is reviewed before it is published`,
        t`Share it with colleagues so everyone can use what you built`,
      ],
      tryAsking: t`Build me a fee tracker dashboard for my projects`,
    },
  };
}

/** The tools OCSC built for everyone, each with a picture and what it can do. */
export function OcscToolsSection({ available }: { available?: ReadonlySet<string> }) {
  const stories = useToolStories();
  const [openTool, setOpenTool] = useState<OcscToolSkill | null>(null);
  const tools = available ? OCSC_TOOLS.filter((tool) => available.has(tool.skill)) : OCSC_TOOLS;
  if (tools.length === 0) return null;
  return (
    <section data-testid="ocsc-tools">
      <div className="mb-3 px-2.5">
        <h3 className="text-[14px] font-medium text-muted-foreground">
          <Trans>OCSC Tools</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>
            Built by OCSC for everyone in the company. Your agents use them on their own whenever
            you ask for a document, deck, spreadsheet, PDF, video or app. You can also call one by
            name, for example /ocsc-word.
          </Trans>
        </p>
      </div>
      <div className="space-y-2 px-2.5">
        {tools.map((tool) => {
          const story = stories[tool.skill];
          const open = openTool === tool.skill;
          return (
            <div
              key={tool.skill}
              data-testid="ocsc-tool"
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenTool(open ? null : tool.skill)}
                className="flex w-full items-center gap-3 p-2 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={tool.image}
                  alt=""
                  className="h-14 w-21 flex-none rounded-lg bg-muted object-cover"
                  loading="lazy"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">
                    {tool.title}
                  </span>
                  <span className="block text-[13px] text-muted-foreground">{story.tagline}</span>
                </span>
                <span className="flex flex-none items-center gap-1 pe-1 text-[12.5px] text-primary">
                  {open ? <Trans>Less</Trans> : <Trans>What it can do</Trans>}
                  <ChevronDown
                    className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {open ? (
                <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <img
                    src={tool.image}
                    alt=""
                    className="aspect-[3/2] w-full rounded-lg bg-muted object-cover"
                  />
                  <div className="min-w-0">
                    <ul className="space-y-1.5">
                      {story.abilities.map((ability) => (
                        <li key={ability} className="flex gap-2 text-[13.5px] text-foreground">
                          <Check className="mt-0.5 size-4 flex-none text-primary" />
                          <span>{ability}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[13px]">
                      <span className="font-medium text-primary">
                        <Trans>Try asking</Trans>
                      </span>
                      <span className="block text-foreground">“{story.tryAsking}”</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
