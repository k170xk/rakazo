import { setCompanyPolicy } from "@rakazo/adapters";
import { DEFAULT_COMPANY_FEATURES, DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { RouterContext } from "./context.js";
import { emailDraftsRoutes } from "./email-drafts.js";

/** Procedures become their plain handlers, so a route can be called without the oRPC stack. */
function handlers(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "handler" ? (fn: unknown) => fn : (handlers() as Record<string, unknown>),
    },
  );
}

type Handler = (call: { context: { actor: unknown }; input: unknown }) => Promise<unknown>;

function routes() {
  const ctx = {
    deps: {
      env: { adminEmails: [] },
      prisma: {
        user: { findUnique: async () => ({ email: "staff@ocsc.co.uk", emailVerified: true }) },
        emailDraft: {
          findFirst: async () => {
            throw new Error("the draft must not be read while the switch refuses");
          },
        },
      },
      microsoft: {
        outlookDraftToken: async () => {
          throw new Error("no Outlook token may be fetched while the switch refuses");
        },
      },
    },
    authed: handlers(),
  } as unknown as RouterContext;
  return emailDraftsRoutes(ctx).emailDrafts as unknown as Record<string, Handler> & {
    signature: Record<string, Handler>;
  };
}

const actor = { spaceId: "space-1", userId: "staff" };

afterEach(() => {
  setCompanyPolicy({ features: null, tools: null });
});

describe("Outlook draft routes", () => {
  const calls: Array<[string, (r: ReturnType<typeof routes>) => Promise<unknown>]> = [
    ["createDraft", (r) => r.createDraft!({ context: { actor }, input: { id: "d1", version: 1 } })],
    ["send", (r) => r.send!({ context: { actor }, input: { id: "d1", version: 1 } })],
    [
      "update",
      (r) =>
        r.update!({
          context: { actor },
          input: { id: "d1", version: 1, to: [], cc: [], bcc: [], subject: "", bodyHtml: "" },
        }),
    ],
    ["files", (r) => r.files!({ context: { actor }, input: { id: "d1" } })],
    ["signature.set", (r) => r.signature.set!({ context: { actor }, input: { html: "<p>x</p>" } })],
  ];

  it.each(calls)("%s refuses while the send / draft switch is off", async (_name, call) => {
    await expect(call(routes())).rejects.toThrow("Outlook email drafts are not turned on for you.");
  });

  it.each(calls)("%s refuses a person outside the switch's audience", async (_name, call) => {
    setCompanyPolicy({
      features: { ...DEFAULT_COMPANY_FEATURES, outlookSend: true },
      tools: {
        ...DEFAULT_COMPANY_TOOLS,
        featureAudiences: { outlookSend: { userIds: ["someone-else"], groupIds: [] } },
      },
    });
    await expect(call(routes())).rejects.toThrow(
      "Your administrator has not turned this on for you.",
    );
  });
});
