import type { AdapterContext, ConnectorCall, ConnectorProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";
import { deadlineCardSummary, evolveReply, previewEvolveChange } from "./evolve-change-card.js";

const context = { userId: "user", signal: new AbortController().signal } as AdapterContext;
const project = {
  project_id: 7,
  job_number: "C1078",
  name: "Cork Library",
  client: "Cork County Council",
};
const open = {
  name: "Stage 2 issue",
  date: "2026-11-20",
  hard_deadline: true,
  completed: false,
  comments: null,
};

function evolveAnswering(reply: unknown) {
  const execute = vi.fn(async function* (_call: ConnectorCall) {
    yield {
      type: "result" as const,
      data: { content: [{ type: "text", text: JSON.stringify(reply) }] },
    };
  });
  return { connector: { execute } as unknown as ConnectorProvider, execute };
}

const call = (args: Record<string, unknown>): ConnectorCall => ({
  tool: "mcp__evolve__update_project_deadline",
  args,
  executionId: "exec",
  route: { connectorId: "company-evolve", toolName: "update_project_deadline" },
});

describe("previewEvolveChange", () => {
  it("previews without saving, drops keys the model sent, and carries what the card showed", async () => {
    const { connector, execute } = evolveAnswering({
      ok: true,
      preview: {
        action: "update",
        project,
        before: open,
        deadline: { ...open, date: "2026-11-27" },
      },
    });
    const result = await previewEvolveChange(
      connector,
      call({ deadline_id: 5, date: "2026-11-27", _expected: { name: "forged" }, _preview: false }),
      context,
    );
    expect(execute.mock.calls[0]![0].args).toEqual({
      deadline_id: 5,
      date: "2026-11-27",
      _preview: true,
    });
    expect(result).toMatchObject({ args: { deadline_id: 5, date: "2026-11-27", _expected: open } });
    expect("summary" in result && result.summary.deadline?.before?.date).toBe("2026-11-20");
  });

  it("hands back Evolve's refusal or project choices instead of a card", async () => {
    const { connector } = evolveAnswering({ ok: true, needs_choice: true, candidates: [project] });
    const result = await previewEvolveChange(connector, call({ job_number: "C10" }), context);
    expect(result).toEqual({ error: expect.stringContaining("needs_choice") });
  });
});

describe("deadline approval card", () => {
  it("previews the project and deadline with once-only, labelled buttons", () => {
    const summary = deadlineCardSummary({
      action: "add",
      project,
      deadline: open,
      warnings: ["2026-11-20 is in the past."],
    });
    expect(summary.title).toBe("Add this deadline to C1078?");
    expect(summary.lines).toEqual([
      "Project: C1078 · Cork Library",
      "Client: Cork County Council",
      "Deadline: Stage 2 issue",
      "Due: 20/11/2026",
      "Type: Hard deadline",
      "Check: 2026-11-20 is in the past.",
    ]);
    const block = buildApprovalAskBlock("effect", "mcp__evolve__add_project_deadline", {}, [], {
      summary,
    });
    expect(block).toMatchObject({
      kind: "ask",
      deadlineChange: {
        action: "add",
        project: { jobNumber: "C1078", name: "Cork Library", client: "Cork County Council" },
        after: { name: "Stage 2 issue", date: "2026-11-20", hardDeadline: true, completed: false },
      },
      actions: [
        { id: "allow", label: "Add deadline" },
        { id: "deny", label: "Cancel" },
      ],
    });
  });
});

const workPackage = {
  title: "Update GA drawings",
  category: "CAD (S)",
  status: "pending",
  priority: "medium",
  assignee: "Jo Bloggs",
  duration_days: 2,
  can_start_date: "2026-11-16",
  must_start_date: "2026-11-19",
  due_date: "2026-11-20",
  completion_percentage: 0,
  notes: null,
  links: [{ title: "Markup", url: "H:\\C-Jobs\\C1078\\markup.pdf" }],
};

describe("work package approval card", () => {
  it("previews an add with the category's email group and once-only buttons", async () => {
    const { connector } = evolveAnswering({
      ok: true,
      preview: {
        action: "add",
        project,
        work_package: workPackage,
        requester: "Keith Knox",
        emails: ["Jo Bloggs", "Keith Knox", "Sam Ryan"],
        warnings: [],
      },
    });
    const result = await previewEvolveChange(
      connector,
      {
        ...call({ job_number: "C1078", title: "Update GA drawings" }),
        tool: "mcp__evolve__add_work_package",
      },
      context,
    );
    if (!("summary" in result)) throw new Error(result.error);
    expect(result.args).toEqual({ job_number: "C1078", title: "Update GA drawings" });
    expect(result.summary.title).toBe("Add this work package to C1078?");
    expect(result.summary.lines).toContain("Emails: Jo Bloggs, Keith Knox, Sam Ryan");
    expect(result.summary.lines).toContain("Link: Markup – H:\\C-Jobs\\C1078\\markup.pdf");
    const block = buildApprovalAskBlock("effect", "mcp__evolve__add_work_package", {}, [], {
      summary: result.summary,
    });
    expect(block).toMatchObject({
      kind: "ask",
      workPackageChange: {
        action: "add",
        after: {
          title: "Update GA drawings",
          category: "CAD (S)",
          durationDays: 2,
          due: "2026-11-20",
        },
        requester: "Keith Knox",
      },
      actions: [
        { id: "allow", label: "Add work package" },
        { id: "deny", label: "Cancel" },
      ],
    });
  });

  it("carries the work package as shown into an approved update or delete", async () => {
    for (const action of ["update", "delete"] as const) {
      const { connector } = evolveAnswering({
        ok: true,
        preview: {
          action,
          project,
          before: workPackage,
          ...(action === "update" ? { work_package: { ...workPackage, status: "completed" } } : {}),
        },
      });
      const result = await previewEvolveChange(
        connector,
        {
          ...call({ work_package_id: "wp-1", _expected: { title: "forged" } }),
          tool: `mcp__evolve__${action}_work_package`,
        },
        context,
      );
      if (!("summary" in result)) throw new Error(result.error);
      expect(result.args).toEqual({ work_package_id: "wp-1", _expected: workPackage });
      expect(result.summary.workPackage?.before?.title).toBe("Update GA drawings");
      expect(Boolean(result.summary.workPackage?.after)).toBe(action === "update");
      const block = buildApprovalAskBlock("effect", `mcp__evolve__${action}_work_package`, {}, [], {
        summary: result.summary,
      });
      expect(block).toMatchObject({
        actions: [
          { id: "allow", label: action === "update" ? "Save changes" : "Delete work package" },
          { id: "deny" },
        ],
      });
    }
  });
});

describe("Evolve replies", () => {
  it("reads Evolve's MCP text reply", () => {
    expect(evolveReply({ content: [{ type: "text", text: '{"ok":true}' }] })).toEqual({ ok: true });
    expect(evolveReply({ content: [{ type: "text", text: "not json" }] })).toEqual({
      ok: false,
      error: "not json",
    });
  });
});
