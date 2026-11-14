import type { AdapterContext, ConnectorCall, ConnectorProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";
import {
  deadlineCardSummary,
  editedEvolveChangeArgs,
  evolveChangeToolName,
  evolveReply,
  previewEvolveChange,
} from "./evolve-change-card.js";

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

describe("editing a pending card", () => {
  it("applies the owner's edits and lets a chosen project replace the model's", () => {
    expect(
      editedEvolveChangeArgs(
        "mcp__evolve__add_work_package",
        { job_number: "C1078", project_name: "Cork", title: "GA", _preview: true, _expected: {} },
        { project_id: 9, assignee: "unassigned", category: "none" },
      ),
    ).toEqual({ args: { title: "GA", project_id: 9, assignee: "unassigned", category: "none" } });
  });

  it("refuses fields a card cannot change, and delete cards entirely", () => {
    expect(
      editedEvolveChangeArgs(
        "mcp__evolve__update_project_deadline",
        { deadline_id: "d" },
        {
          project_id: 9,
        },
      ),
    ).toEqual({ error: "This card cannot change project id." });
    expect(
      editedEvolveChangeArgs(
        "mcp__evolve__delete_work_package",
        { work_package_id: "w" },
        {
          title: "x",
        },
      ),
    ).toEqual({ error: "This card cannot be edited." });
    expect(evolveChangeToolName("mcp__evolve__search_projects")).toBeNull();
  });

  it("shows the project a work package moves out of", async () => {
    const { connector } = evolveAnswering({
      ok: true,
      preview: {
        action: "update",
        project,
        moved_from: { job_number: "C1001", name: "Old job", client: null },
        before: workPackage,
        work_package: workPackage,
        changed: ["project"],
      },
    });
    const result = await previewEvolveChange(
      connector,
      {
        ...call({ work_package_id: "wp-1", project_id: 7 }),
        tool: "mcp__evolve__update_work_package",
      },
      context,
    );
    if (!("summary" in result)) throw new Error(result.error);
    expect(result.summary.workPackage?.movedFrom).toEqual({
      jobNumber: "C1001",
      name: "Old job",
      client: null,
    });
    expect(result.summary.lines).toContain("Moved from: C1001 · Old job");
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

describe("project comment and Design Team cards", () => {
  it("shows a comment deletion on a plain card and carries the comment it showed", async () => {
    const { connector } = evolveAnswering({
      ok: true,
      preview: {
        action: "delete",
        comment_id: 41,
        project,
        before: { text: "Drainage layout issued", author: "Keith Knox", date: "2026-11-10" },
      },
    });
    const result = await previewEvolveChange(
      connector,
      { ...call({ comment_id: 41 }), tool: "mcp__evolve__delete_project_comment" },
      context,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.summary.workPackage).toBeUndefined();
    expect(result.summary.title).toBe("Delete your comment on C1078?");
    expect(result.summary.lines).toContain("Comment (10/11/2026): Drainage layout issued");
    expect(result.args).toEqual({
      comment_id: 41,
      _expected: { text: "Drainage layout issued", author: "Keith Knox", date: "2026-11-10" },
    });
    const block = buildApprovalAskBlock(
      "effect",
      "mcp__evolve__delete_project_comment",
      result.args,
      [],
      {
        summary: result.summary,
      },
    );
    expect(block).toMatchObject({ kind: "ask", status: "pending" });
    expect((block as { actions: { id: string }[] }).actions.map((action) => action.id)).toEqual([
      "allow",
      "deny",
    ]);
  });

  it("shows a new comment and a Design Team join with what Evolve resolved", async () => {
    const comment = evolveAnswering({
      ok: true,
      preview: { action: "add", project, comment: { text: "Survey booked", author: "Keith Knox" } },
    });
    const added = await previewEvolveChange(
      comment.connector,
      call({ project_id: 7, text: "Survey booked" }),
      context,
    );
    if ("error" in added) throw new Error(added.error);
    expect(added.summary.title).toBe("Add this comment to C1078?");
    expect(added.summary.lines).toContain("Comment: Survey booked");
    expect(added.args).toEqual({ project_id: 7, text: "Survey booked" });

    const team = evolveAnswering({
      ok: true,
      preview: {
        action: "add",
        project,
        member: { name: "Keith Knox", role: "Drainage Civil Engineer" },
        current_roles: ["Structural Engineer"],
        warnings: ["Design Team members can change this project's deadlines and work packages."],
      },
    });
    const joined = await previewEvolveChange(
      team.connector,
      call({ project_id: 7, role: "drainage" }),
      context,
    );
    if ("error" in joined) throw new Error(joined.error);
    expect(joined.summary.title).toBe("Join C1078's Design Team as Drainage Civil Engineer?");
    expect(joined.summary.lines).toContain("Other roles on this team: Structural Engineer");
    expect(joined.summary.lines.some((line) => line.startsWith("Check: "))).toBe(true);
  });

  it("hands a role choice back to the model without a card", async () => {
    const { connector } = evolveAnswering({
      ok: true,
      needs_choice: true,
      roles: ["Electrical Engineer"],
    });
    const result = await previewEvolveChange(
      connector,
      call({ project_id: 7, role: "engineer" }),
      context,
    );
    expect(result).toEqual({ error: expect.stringContaining("needs_choice") });
  });
});
