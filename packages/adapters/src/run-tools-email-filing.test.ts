import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { toolResultTaintsRun } from "@rakazo/core";
import { afterEach, describe, expect, it } from "vitest";
import { setCompanyPolicy } from "./company-policy.js";
import {
  emailFilingTools,
  FILING_CANDIDATES_TOOL,
  PROPOSE_FILING_TOOL,
} from "./run-tools-email-filing.js";

function context(options: {
  offered: boolean;
  outlook: boolean;
  owner?: string;
  enabled?: boolean;
  reader?: boolean;
}) {
  const ctx = {
    deps: {
      prisma: {
        user: { findUnique: async () => null },
        deploymentSettings: { findUnique: async () => null },
        emailFilingProfile: {
          findFirst: async () =>
            options.enabled === false
              ? { id: "p1", version: 1, content: { settings: { enabled: false } } }
              : null,
        },
        emailFilingBatch: {
          create: async () => {
            throw new Error("must not create a batch");
          },
        },
      },
      connectors: {
        managed: () => ({
          outlookReader: async () => {
            if (options.reader === false) return null;
            throw new Error("must not read mail");
          },
        }),
      },
    },
    run: { id: "r1", spaceId: "s1", userId: "u1", trigger: "routine" },
    bot: { id: "b1", userId: options.owner ?? "u1" },
    thread: { id: "t1", userId: "u1", botId: "b1", groupId: null, externalConversationId: null },
    tools: {
      offered: options.offered
        ? [{ name: FILING_CANDIDATES_TOOL }, { name: PROPOSE_FILING_TOOL }]
        : [],
    },
    state: {},
    context: {
      connectedConnections: options.outlook
        ? [{ connectorId: "microsoft", externalId: "outlook" }]
        : [],
    },
  } as never;
  const call = (name: string) =>
    ({
      name,
      args: { items: [{ message_id: "m1", confidence: 99, reason: "x" }] },
      finish: (result: unknown) => result,
    }) as never;
  return { ctx, call };
}

const unavailable = { error: "Filing Outlook email is not available here." };

describe("Outlook filing tools", () => {
  afterEach(() => setCompanyPolicy({ features: null }));
  const allow = () =>
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, outlookFiling: true } });

  it("do not taint the run for the card they write", () => {
    expect(toolResultTaintsRun(PROPOSE_FILING_TOOL)).toBe(false);
  });

  it.each([FILING_CANDIDATES_TOOL, PROPOSE_FILING_TOOL])(
    "%s refuses unless offered, connected, in the owner's chat and switched on",
    async (name) => {
      const handler = emailFilingTools[name]!;
      for (const options of [
        { offered: false, outlook: true },
        { offered: true, outlook: false },
        { offered: true, outlook: true, owner: "someone-else" },
        { offered: true, outlook: true },
      ]) {
        const { ctx, call } = context(options);
        await expect(handler(ctx, call(name))).resolves.toEqual(unavailable);
      }
    },
  );

  it("respects the person's own off switch and a missing Outlook token", async () => {
    allow();
    const off = context({ offered: true, outlook: true, enabled: false });
    await expect(
      emailFilingTools[FILING_CANDIDATES_TOOL]!(off.ctx, off.call(FILING_CANDIDATES_TOOL)),
    ).resolves.toEqual({ error: "The person turned email filing off in Settings → Email." });
    const noReader = context({ offered: true, outlook: true, reader: false });
    await expect(
      emailFilingTools[PROPOSE_FILING_TOOL]!(noReader.ctx, noReader.call(PROPOSE_FILING_TOOL)),
    ).resolves.toEqual({ error: "Outlook is not connected. Ask the person to reconnect it." });
  });
});
