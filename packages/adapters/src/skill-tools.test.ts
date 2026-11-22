import { DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import { buildSkillMd, formatSkillsCatalogInstruction, parseSkillMd } from "@rakazo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_AGENT_SKILLS } from "./builtin-skills.js";
import { setCompanyPolicy } from "./company-policy.js";
import { userTurnInstructions } from "./run-instructions.js";
import {
  applyAssistantSkillPolicy,
  formatRequiredSkillsInstruction,
  listAgentSkillRecords,
  resolveAssistantRequiredSkills,
  sharedAgentSkillRecords,
  skillCreateFromTool,
  skillDeleteFromTool,
  skillReadFromTool,
  skillUpdateFromTool,
} from "./skill-tools.js";

type Scope = { spaceId?: string; userId?: string; OR?: Array<{ spaceId?: string }> };
/** The owner's rows here: added in this space (no fixture is available beyond one). */
function inScope(row: Record<string, unknown>, where: Scope): boolean {
  if (where.userId && row.userId !== where.userId) return false;
  if (where.spaceId && row.spaceId !== where.spaceId) return false;
  if (where.OR && !where.OR.some((branch) => branch.spaceId === row.spaceId)) return false;
  return true;
}

function makePrisma(rows: Array<Record<string, unknown>> = []) {
  const store = [...rows];
  return {
    agentSkill: {
      findMany: vi.fn(async ({ where }: { where?: Scope } = {}) =>
        store.filter((row) => !where || inScope(row, where)).map((row) => ({ ...row })),
      ),
      findFirst: vi.fn(async ({ where }: { where: Scope & { id: string } }) => {
        const row = store.find((item) => item.id === where.id && inScope(item, where));
        return row ? { files: row.files ?? null } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `skill-${store.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          source: "user",
          ...data,
        };
        store.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = store.findIndex((row) => row.id === where.id);
          if (index < 0) throw new Error("missing");
          store[index] = { ...store[index], ...data, updatedAt: new Date() };
          return store[index];
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, string>;
          data: Record<string, unknown>;
        }) => {
          const index = store.findIndex(
            (row) =>
              row.id === where.id &&
              row.spaceId === where.spaceId &&
              row.userId === where.userId &&
              row.source === where.source,
          );
          if (index < 0) return { count: 0 };
          store[index] = { ...store[index], ...data, updatedAt: new Date() };
          return { count: 1 };
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = store.findIndex((row) => row.id === where.id);
        if (index < 0) throw new Error("missing");
        const [removed] = store.splice(index, 1);
        return removed;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, string> }) => {
        const index = store.findIndex(
          (row) =>
            row.id === where.id &&
            row.spaceId === where.spaceId &&
            row.userId === where.userId &&
            row.source === where.source,
        );
        if (index < 0) return { count: 0 };
        store.splice(index, 1);
        return { count: 1 };
      }),
    },
    _store: store,
  };
}

const owner = { spaceId: "ws-1", userId: "user-1" };

describe("skill tools", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it("creates, reads, updates, and deletes user skills", async () => {
    const created = await skillCreateFromTool(prisma as never, owner, {
      name: "Daily standup",
      description: "Prepare standup notes",
      body: "1. Summarize yesterday.\n2. List blockers.",
    });
    expect(created).toMatchObject({ ok: true, name: "Daily standup" });
    expect(String(created.hint)).toContain("/Daily standup");

    const read = await skillReadFromTool(prisma as never, owner, { name: "Daily standup" });
    expect(read).toMatchObject({
      name: "Daily standup",
      description: "Prepare standup notes",
      readOnly: false,
    });
    expect(String(read.content)).toContain("Summarize yesterday");

    const updated = await skillUpdateFromTool(prisma as never, owner, {
      name: "Daily standup",
      description: "Updated when-to-use",
    });
    expect(updated).toMatchObject({ ok: true, description: "Updated when-to-use" });

    const deleted = await skillDeleteFromTool(prisma as never, owner, { name: "Daily standup" });
    expect(deleted).toEqual({ ok: true, name: "Daily standup" });
    expect(await skillReadFromTool(prisma as never, owner, { name: "Daily standup" })).toEqual({
      error: "Skill not found.",
    });
  });

  it("lists a skill's reference files and reads one by exact path only", async () => {
    const prisma = makePrisma([
      {
        id: "plugin-1",
        spaceId: owner.spaceId,
        userId: owner.userId,
        name: "billing",
        description: "Billing guidance",
        content: buildSkillMd({
          name: "billing",
          description: "Billing guidance",
          body: "See references/rates.md.",
        }),
        source: "plugin",
        files: { "references/rates.md": "Rates table", "notes.txt": "Notes" },
      },
    ]);
    expect(await skillReadFromTool(prisma as never, owner, { name: "billing" })).toMatchObject({
      name: "billing",
      files: ["notes.txt", "references/rates.md"],
    });
    expect(
      await skillReadFromTool(prisma as never, owner, {
        name: "billing",
        file: "./references/rates.md",
      }),
    ).toEqual({ name: "billing", file: "references/rates.md", content: "Rates table" });
    expect(
      await skillReadFromTool(prisma as never, owner, { name: "billing", file: "../secrets.md" }),
    ).toMatchObject({ error: expect.stringContaining("No file") });
  });

  it("preserves extra frontmatter keys on update", async () => {
    const content = buildSkillMd({
      name: "Review PR",
      description: "Review a pull request",
      body: "1. Read the diff.",
      frontmatter: { compatibility: "cursor", "allowed-tools": ["shell"] },
    });
    await skillCreateFromTool(prisma as never, owner, { content });
    await skillUpdateFromTool(prisma as never, owner, {
      name: "Review PR",
      body: "1. Read the diff.\n2. Leave comments.",
    });
    const read = await skillReadFromTool(prisma as never, owner, { name: "Review PR" });
    expect(String(read.content)).toContain("compatibility: cursor");
    expect(String(read.content)).toContain("Leave comments");
  });

  it("renames only via newName, not the name lookup key", async () => {
    const created = await skillCreateFromTool(prisma as never, owner, {
      name: "Original",
      description: "Keep name unless newName",
      body: "body",
    });
    const skillId = String(created.id);
    const mistyped = await skillUpdateFromTool(prisma as never, owner, {
      skillId,
      name: "Should not apply",
      description: "still original name",
    });
    expect(mistyped).toMatchObject({ ok: true, name: "Original" });

    const renamed = await skillUpdateFromTool(prisma as never, owner, {
      skillId,
      newName: "Renamed",
    });
    expect(renamed).toMatchObject({ ok: true, name: "Renamed" });
  });

  it("scopes list to the owner workspace and injects catalog lines", async () => {
    prisma = makePrisma([
      {
        id: "other-1",
        spaceId: "ws-2",
        userId: "user-2",
        name: "Other workspace skill",
        description: "not visible",
        content: buildSkillMd({
          name: "Other workspace skill",
          description: "not visible",
          body: "x",
        }),
        source: "user",
      },
    ]);
    await skillCreateFromTool(prisma as never, owner, {
      name: "Daily standup",
      description: "Prepare standup notes",
      body: "steps",
    });
    const records = await listAgentSkillRecords(prisma as never, owner);
    expect(records.map((row) => row.name)).toContain("Daily standup");
    expect(records.map((row) => row.name)).not.toContain("Other workspace skill");
    const catalog = formatSkillsCatalogInstruction(records);
    expect(catalog).toContain("- Daily standup: Prepare standup notes");
    expect(catalog).toContain("skill_read");
  });

  it("rejects update/delete for plugin and builtin skills", async () => {
    prisma = makePrisma([
      {
        id: "plugin-1",
        spaceId: owner.spaceId,
        userId: owner.userId,
        name: "Plugin recipe",
        description: "From a plugin",
        content: buildSkillMd({
          name: "Plugin recipe",
          description: "From a plugin",
          body: "do not edit",
        }),
        source: "plugin",
      },
    ]);
    expect(
      await skillUpdateFromTool(prisma as never, owner, {
        name: "Plugin recipe",
        description: "hijack",
      }),
    ).toEqual({ error: "Builtin and plugin skills are read-only." });
    expect(await skillDeleteFromTool(prisma as never, owner, { name: "Plugin recipe" })).toEqual({
      error: "Builtin and plugin skills are read-only.",
    });
  });

  it("ships builtin skills as valid, readable, read-only SKILL.md records", async () => {
    expect(BUILTIN_AGENT_SKILLS.map((skill) => skill.name)).toContain("Interrogate");
    for (const skill of BUILTIN_AGENT_SKILLS) {
      const parsed = parseSkillMd(skill.content);
      expect(parsed).toMatchObject({ name: skill.name, description: skill.description });
      // / picker truncates at 72; keep descriptions short so "review only" stays visible.
      expect(skill.description.length).toBeLessThanOrEqual(72);
    }

    const records = await listAgentSkillRecords(prisma as never, owner);
    const interrogate = records.find((row) => row.name === "Interrogate");
    expect(interrogate).toMatchObject({
      id: "builtin:Interrogate",
      source: "builtin",
      readOnly: true,
    });
    expect(formatSkillsCatalogInstruction(records)).toContain("- Interrogate:");
    expect(formatSkillsCatalogInstruction(records)).toContain("Review only");

    const read = await skillReadFromTool(prisma as never, owner, { name: "interrogate" });
    expect(read).toMatchObject({ name: "Interrogate", source: "builtin", readOnly: true });
    expect(String(read.content)).toContain("Do not modify files");

    expect(
      await skillCreateFromTool(prisma as never, owner, {
        name: "interrogate",
        description: "shadow the builtin",
        body: "steps",
      }),
    ).toEqual({ error: 'A skill named "Interrogate" already exists.' });
    expect(
      await skillUpdateFromTool(prisma as never, owner, {
        name: "Interrogate",
        description: "hijack",
      }),
    ).toEqual({ error: "Builtin and plugin skills are read-only." });
    expect(await skillDeleteFromTool(prisma as never, owner, { name: "Interrogate" })).toEqual({
      error: "Builtin and plugin skills are read-only.",
    });
  });

  it.each(["interrogate", " Interrogate "])("preserves a saved skill named %j", async (name) => {
    prisma = makePrisma([
      {
        id: "legacy-1",
        spaceId: owner.spaceId,
        userId: owner.userId,
        name,
        description: "my review recipe",
        content: buildSkillMd({
          name,
          description: "my review recipe",
          body: "my steps",
        }),
        source: "user",
      },
    ]);

    const records = await listAgentSkillRecords(prisma as never, owner);
    expect(records.filter((skill) => skill.name.trim().toLowerCase() === "interrogate")).toEqual([
      expect.objectContaining({ id: "legacy-1", source: "user", readOnly: false }),
    ]);
    expect(await skillReadFromTool(prisma as never, owner, { name: "Interrogate" })).toMatchObject({
      name,
      source: "user",
      readOnly: false,
    });
    expect(await skillReadFromTool(prisma as never, owner, { skillId: "legacy-1" })).toMatchObject({
      name,
      source: "user",
    });
    expect(
      await skillUpdateFromTool(prisma as never, owner, {
        name: "Interrogate",
        description: "still mine",
      }),
    ).toMatchObject({ ok: true });
    expect(await skillDeleteFromTool(prisma as never, owner, { name: "Interrogate" })).toEqual({
      ok: true,
      name: name.trim(),
    });
  });

  it("reads a builtin skill's reference files one at a time", async () => {
    const read = await skillReadFromTool(prisma as never, owner, { name: "ocsc-pdf-markup" });
    expect(read.files).toEqual([
      "civil.md",
      "design-intake.md",
      "drafting.md",
      "electrical.md",
      "mechanical.md",
      "review.md",
      "structural.md",
    ]);
    const core = String(read.content);
    for (const file of read.files as string[]) expect(core).toContain(file);
    expect(core).not.toContain("drainage_approval");

    const civil = await skillReadFromTool(prisma as never, owner, {
      name: "ocsc-pdf-markup",
      file: "civil.md",
    });
    expect(civil).toMatchObject({ name: "ocsc-pdf-markup", file: "civil.md" });
    expect(String(civil.content)).toContain("drainage_approval");
    expect(
      await skillReadFromTool(prisma as never, owner, { name: "ocsc-pdf-markup", file: "../x" }),
    ).toMatchObject({ error: 'No file "../x" in this skill.' });

    const word = await skillReadFromTool(prisma as never, owner, { name: "ocsc-word" });
    expect(word).not.toHaveProperty("files");
  });

  it("rejects oversized skill content", async () => {
    const body = "x".repeat(100_001);
    const created = await skillCreateFromTool(prisma as never, owner, {
      name: "Huge",
      description: "too big",
      body,
    });
    expect(created).toMatchObject({ error: expect.stringContaining("at most") });
  });

  it("rejects overlong skill names on structured create and rename", async () => {
    const longName = "N".repeat(81);
    expect(
      await skillCreateFromTool(prisma as never, owner, {
        name: longName,
        description: "ok description",
        body: "steps",
      }),
    ).toEqual({ error: "Skill name must be at most 80 characters." });

    await skillCreateFromTool(prisma as never, owner, {
      name: "Short",
      description: "ok description",
      body: "steps",
    });
    expect(
      await skillUpdateFromTool(prisma as never, owner, {
        name: "Short",
        newName: longName,
      }),
    ).toEqual({ error: "Skill name must be at most 80 characters." });
  });

  describe("company skills and default agent required skills", () => {
    const ASSISTANT_A = "11111111-1111-4111-8111-111111111111";
    const ASSISTANT_B = "22222222-2222-4222-8222-222222222222";

    afterEach(() => {
      setCompanyPolicy({ tools: null });
    });

    it("injects required skills in full, scopes attached skills to their default agent, and keeps company skills readable on non-owner turns", async () => {
      const styleSkill = {
        id: "style-1",
        name: "OCSC Writing Style",
        description: "Mandatory UK/IE spelling and concise lead-first style",
        content: buildSkillMd({
          name: "OCSC Writing Style",
          description: "Mandatory UK/IE spelling and concise lead-first style",
          body: "Always lead with the answer. Use British/Irish spelling.",
        }),
        availableToAll: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const allStaffSkill = {
        id: "global-1",
        name: "Company Signoff",
        description: "Standard signoff checklist",
        content: buildSkillMd({
          name: "Company Signoff",
          description: "Standard signoff checklist",
          body: "Confirm reviewer and revision date.",
        }),
        availableToAll: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      setCompanyPolicy({
        tools: {
          ...DEFAULT_COMPANY_TOOLS,
          companySkills: [styleSkill, allStaffSkill],
          assistantConfigs: {
            [ASSISTANT_A]: {
              standingInstructions: "Always cite BS/IS Eurocode clause numbers.",
              skills: [
                { skillKey: "company:style-1", mode: "required" },
                { skillKey: "builtin:Interrogate", mode: "required" },
              ],
              disabledSkills: ["ocsc-word"],
            },
          },
        },
      });

      // Required skills resolve both company and built-in attachments in order.
      const requiredA = resolveAssistantRequiredSkills(ASSISTANT_A);
      expect(requiredA.map((s) => s.id)).toEqual(["company:style-1", "builtin:Interrogate"]);
      expect(resolveAssistantRequiredSkills(ASSISTANT_B)).toEqual([]);

      const requiredText = formatRequiredSkillsInstruction(requiredA);
      expect(requiredText).toContain("Mandatory company skills for this agent");
      expect(requiredText).toContain("### Required skill: OCSC Writing Style");
      expect(requiredText).toContain("Always lead with the answer.");
      expect(requiredText).toContain("### Required skill: Interrogate");

      // System instructions include live standing instructions + mandatory skills right after house style.
      const prompt = userTurnInstructions({
        botInstructions: "You are Civil Intelligence.",
        assistantStandingInstructions: "Always cite BS/IS Eurocode clause numbers.",
        requiredSkillsInstruction: requiredText,
        groupContext: undefined,
        messagingContext: undefined,
        redactedMemoryContext: undefined,
        redactedScratchpadContext: undefined,
        hasHistoricalContext: false,
        computerInstruction: "",
        pageBrowserAllowed: false,
        workspaceInstruction: "",
        agentEnvironmentInstruction: undefined,
        botDirectory: undefined,
        pluginLine: undefined,
        agentSkillsLine: undefined,
        taughtSkillsLine: undefined,
        replyGuidance: "",
      })
        .filter(Boolean)
        .join("\n\n");
      expect(prompt).toContain("Company standing instructions for this default agent");
      expect(prompt).toContain("Always cite BS/IS Eurocode clause numbers.");
      expect(prompt).toContain("Mandatory company skills for this agent");

      // Scoped visibility: ASSISTANT_A sees style-1 + allStaffSkill and drops disabled ocsc-word;
      // ASSISTANT_B sees allStaffSkill + ocsc-word, NOT style-1.
      const baseLoaded = await listAgentSkillRecords(prisma as never, owner);
      const skillsA = applyAssistantSkillPolicy(baseLoaded, ASSISTANT_A);
      const skillsB = applyAssistantSkillPolicy(baseLoaded, ASSISTANT_B);
      expect(skillsA.some((s) => s.id === "company:style-1")).toBe(true);
      expect(skillsA.some((s) => s.id === "company:global-1")).toBe(true);
      expect(skillsA.some((s) => s.name === "ocsc-word")).toBe(false);
      expect(skillsB.some((s) => s.id === "company:style-1")).toBe(false);
      expect(skillsB.some((s) => s.id === "company:global-1")).toBe(true);
      expect(skillsB.some((s) => s.name === "ocsc-word")).toBe(true);

      // Non-owner / shared turns still get company skills attached to the default agent.
      const sharedA = sharedAgentSkillRecords(ASSISTANT_A);
      expect(sharedA.some((s) => s.id === "company:style-1")).toBe(true);
      const readOnShared = await skillReadFromTool(
        prisma as never,
        owner,
        { name: "OCSC Writing Style" },
        { assistantId: ASSISTANT_A, nonOwnerChatRun: true },
      );
      expect(readOnShared).toMatchObject({
        name: "OCSC Writing Style",
        source: "company",
        readOnly: true,
      });
      expect(String(readOnShared.content)).toContain("Always lead with the answer.");
    });
  });
});
