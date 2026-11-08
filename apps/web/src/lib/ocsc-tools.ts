/**
 * The built-in skills OCSC built for the whole company, shown to people as OCSC Tools so they
 * read apart from skills that staff write themselves. Names match OCSC_SKILLS in the adapters.
 */
export const OCSC_TOOLS = [
  { skill: "ocsc-word", title: "OCSC Word", image: "/tools/word.webp" },
  { skill: "ocsc-slides", title: "OCSC Slides", image: "/tools/slides.webp" },
  { skill: "ocsc-excel", title: "OCSC Excel", image: "/tools/excel.webp" },
  { skill: "ocsc-pdf", title: "OCSC PDF", image: "/tools/pdf.webp" },
  { skill: "ocsc-pdf-markup", title: "OCSC PDF Studio", image: "/tools/markup.webp" },
  { skill: "ocsc-video", title: "OCSC Video", image: "/tools/video.webp" },
  { skill: "evolve-plugin", title: "OCSC Apps", image: "/tools/apps.webp" },
] as const;

export type OcscToolSkill = (typeof OCSC_TOOLS)[number]["skill"];

const TOOL_SKILLS = new Set<string>(OCSC_TOOLS.map((tool) => tool.skill));

export function isOcscTool(skillName: string): skillName is OcscToolSkill {
  return TOOL_SKILLS.has(skillName);
}

export function ocscToolTitle(skillName: string): string | undefined {
  return OCSC_TOOLS.find((tool) => tool.skill === skillName)?.title;
}
