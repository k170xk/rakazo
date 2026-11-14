import * as z from "zod";
import { AgentImportSetupItemSchema } from "./agent-import-setup.js";
import { botSecretDestinationSchema, LoginFieldLabels, OneTimeCodeTarget } from "./bot-secrets.js";
import { EvolveConversationBlockSchema } from "./evolve-history.js";
import { EvolveReferencesSchema } from "./evolve-references.js";
import { Id, ThinkingLevelSchema } from "./ids.js";
import { McpTransportSchema } from "./mcp.js";
import { PAGE_TITLE_MAX_LENGTH } from "./pages.js";
import { UiCard } from "./ui-cards.js";

export const ProductEventType = z.enum([
  "thread.message.created",
  "thread.cleared",
  "thread.message.updated",
  "thread.message.reaction",
  "thread.progress",
  "thread.artifact",
  "thread.ask",
  "thread.choice",
  "thread.meta",
  "thread.computer",
  "thread.subagent",
  "thread.cloud_agent",
  "thread.call.ended",
  "run.started",
  "run.steering.claimed",
  "run.checkpointed",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.status",
  "computer.takeover.requested",
  "computer.takeover.granted",
  "computer.takeover.released",
  "computer.command",
  "memory.revised",
  "routine.created",
  "routine.updated",
  "routine.fired",
  "skill.teaching.started",
  "skill.teaching.stopped",
  "skill.draft.created",
  "skill.saved",
  "effect.recorded",
  "agent.tool.called",
  "agent.tool.completed",
  "effect.reconciled",
  "usage.recorded",
  "bot.spawned",
  "bot.updated",
  "bot.archived",
  "bot.deleted",
  "group.created",
  "group.updated",
  "group.handoff",
  /** Liveness only: never persisted, never applied to a snapshot, always seq 0. */
  "heartbeat",
]);
export type ProductEventType = z.infer<typeof ProductEventType>;

export const MessageRole = z.enum(["user", "bot", "system"]);
export const BotMessageIntent = z.enum(["request", "result", "question", "status", "fyi"]);
export type BotMessageIntent = z.infer<typeof BotMessageIntent>;

export const MAX_CHART_DATA_ROWS = 5_000;

const ChartSpec = z.record(z.string(), z.any());

function embeddedChartRowCount(spec: Record<string, unknown>): number {
  const specData = Array.isArray(spec.data) ? spec.data.length : 0;
  const markData = Array.isArray(spec.marks)
    ? spec.marks.reduce((total, mark) => {
        if (!mark || typeof mark !== "object" || !Array.isArray(mark.data)) return total;
        return total + mark.data.length;
      }, 0)
    : 0;
  return specData + markData;
}

const ChartBlock = z
  .object({
    kind: z.literal("chart"),
    name: z.string(),
    /** Declarative Observable Plot spec, validated by render_plot before publish.
        z.any keeps the inferred type JSON-assignable for persistence. */
    spec: ChartSpec,
    data: z.array(z.any()).max(MAX_CHART_DATA_ROWS),
  })
  .superRefine((block, ctx) => {
    if (block.data.length + embeddedChartRowCount(block.spec) <= MAX_CHART_DATA_ROWS) return;
    ctx.addIssue({
      code: "custom",
      message: `Chart data exceeds the ${MAX_CHART_DATA_ROWS.toLocaleString("en-US")}-row limit`,
    });
  });

export const SecretAskPurpose = z.enum(["otp", "password", "api_key"]);
export type SecretAskPurpose = z.infer<typeof SecretAskPurpose>;

/** The settings a bot can change on itself from chat. */
export const BotSettingsValuesSchema = z.object({
  modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
  modelId: z.string().trim().min(1).max(200).nullable().optional(),
  thinkingLevel: ThinkingLevelSchema.nullable().optional(),
  autoSpeak: z.boolean().optional(),
  voiceId: z.string().max(120).nullable().optional(),
});
export type BotSettingsValues = z.infer<typeof BotSettingsValuesSchema>;

const ProjectDeadlineValues = z.object({
  name: z.string(),
  date: z.string().nullable(),
  hardDeadline: z.boolean(),
  completed: z.boolean(),
  comments: z.string().nullable(),
});

/** A deadline added to or changed on an Evolve project, as its approval card previews it. */
export const ProjectDeadlineChangeSchema = z.object({
  action: z.enum(["add", "update"]),
  project: z.object({
    jobNumber: z.string().nullable(),
    name: z.string().nullable(),
    client: z.string().nullable(),
  }),
  /** The deadline as it is now; only an update has one. */
  before: ProjectDeadlineValues.optional(),
  after: ProjectDeadlineValues,
  warnings: z.array(z.string()).optional(),
});
export type ProjectDeadlineChange = z.infer<typeof ProjectDeadlineChangeSchema>;

const WorkPackageValues = z.object({
  title: z.string(),
  category: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  assignee: z.string().nullable(),
  durationDays: z.number(),
  canStart: z.string().nullable(),
  mustStart: z.string().nullable(),
  due: z.string().nullable(),
  percentComplete: z.number(),
  notes: z.string().nullable(),
  links: z.array(z.object({ title: z.string(), url: z.string() })),
});

/** A work package added to, changed on or deleted from an Evolve project, as its approval card previews it. */
export const WorkPackageChangeSchema = z.object({
  action: z.enum(["add", "update", "delete"]),
  project: z.object({
    jobNumber: z.string().nullable(),
    name: z.string().nullable(),
    client: z.string().nullable(),
  }),
  /** The work package as it is now; an update and a delete have one. */
  before: WorkPackageValues.optional(),
  /** The work package once saved; a delete has none. */
  after: WorkPackageValues.optional(),
  /** The project an update moves it out of; `project` is then where it goes. */
  movedFrom: z
    .object({
      jobNumber: z.string().nullable(),
      name: z.string().nullable(),
      client: z.string().nullable(),
    })
    .optional(),
  requester: z.string().nullable().optional(),
  /** Who Evolve's work package email goes to once it is saved. */
  emails: z.array(z.string()).optional(),
  statusComment: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});
export type WorkPackageChange = z.infer<typeof WorkPackageChangeSchema>;

const ProjectCommentValues = z.object({ text: z.string(), category: z.string() });

/** A comment the run owner adds to, rewords on or deletes from an Evolve project, as its card previews it. */
export const ProjectCommentChangeSchema = z.object({
  action: z.enum(["add", "update", "delete"]),
  project: z.object({
    jobNumber: z.string().nullable(),
    name: z.string().nullable(),
    client: z.string().nullable(),
  }),
  author: z.string(),
  /** The comment as it is now; an update and a delete have one. */
  before: ProjectCommentValues.optional(),
  /** The comment once saved; a delete has none. */
  after: ProjectCommentValues.optional(),
  /** The day a deleted comment was written. */
  date: z.string().nullable().optional(),
});
export type ProjectCommentChange = z.infer<typeof ProjectCommentChangeSchema>;

/** The run owner joining or leaving an Evolve project's Design Team in one role. */
export const DesignTeamChangeSchema = z.object({
  action: z.enum(["add", "delete"]),
  project: z.object({
    jobNumber: z.string().nullable(),
    name: z.string().nullable(),
    client: z.string().nullable(),
  }),
  person: z.string(),
  role: z.string(),
  emoji: z.string().nullable().optional(),
  /** The roles they already hold on this team. */
  currentRoles: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});
export type DesignTeamChange = z.infer<typeof DesignTeamChangeSchema>;

/** The run owner going out to a site, or checking back in from one, as Evolve's Staff Check-in page records it. */
export const SiteVisitChangeSchema = z.object({
  action: z.enum(["check_out", "check_in"]),
  person: z.string(),
  siteLocation: z.string().nullable(),
  jobNumber: z.string().nullable(),
  projectName: z.string().nullable(),
  buddy: z.string().nullable(),
  /** A check-out's expected return as a UK/Irish clock time (HH:MM) and in words. */
  expectedReturnTime: z.string().nullable().optional(),
  expectedReturnLabel: z.string().nullable().optional(),
  /** When a check-in's visit began. */
  leftLabel: z.string().nullable().optional(),
  /** A check-in's return, as a UK/Irish day (YYYY-MM-DD) and time (HH:MM), and in words. */
  returnedDay: z.string().optional(),
  returnedTime: z.string().optional(),
  returnedLabel: z.string().optional(),
  everythingOk: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  /** The visit a check-out closes first because the person is still out on it. */
  closes: z.object({ siteLocation: z.string().nullable(), leftLabel: z.string() }).optional(),
  warnings: z.array(z.string()).optional(),
});
export type SiteVisitChange = z.infer<typeof SiteVisitChangeSchema>;

const EditDay = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]);
const EditText = (max: number) => z.string().max(max);

/**
 * What the run owner changed on a deadline or work package card before approving it. Evolve
 * previews the edited change again, so names, people and categories resolve as the tools resolve
 * them; an empty day or "unassigned"/"none" clears that field.
 */
export const EvolveChangeEditsSchema = z
  .object({
    project_id: z.number().int().positive(),
    name: EditText(200).min(1),
    date: EditDay,
    hard_deadline: z.boolean(),
    completed: z.boolean(),
    comments: EditText(2000),
    title: EditText(300).min(1),
    category: EditText(120).min(1),
    assignee: EditText(254).min(1),
    duration_days: z.number().int().min(1).max(365),
    can_start_date: EditDay,
    due_date: EditDay,
    status: z.enum(["pending", "in_progress", "on_hold", "completed", "cancelled"]),
    status_comment: EditText(2000),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    completion_percentage: z.number().int().min(0).max(100),
    notes: EditText(5000),
    text: EditText(2000).min(1),
    role: EditText(120).min(1),
    site_location: EditText(300).min(1),
    /** "none" checks out to no particular job. */
    job_number: EditText(60).min(1),
    buddy: EditText(254).min(1),
    expected_return: z.string().regex(/^\d{2}:\d{2}$/),
    returned_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    everything_ok: z.boolean(),
  })
  .partial()
  .refine((edits) => Object.keys(edits).length > 0, "Change at least one field");
export type EvolveChangeEdits = z.infer<typeof EvolveChangeEditsSchema>;

export const EvolveChangeOptionKindSchema = z.enum([
  "projects",
  "people",
  "categories",
  "comment_categories",
  "team_roles",
]);
export type EvolveChangeOptionKind = z.infer<typeof EvolveChangeOptionKindSchema>;

/** The live Evolve choices a card's project, assignee and category pickers offer. */
export const EvolveChangeOptionsSchema = z.object({
  projects: z
    .array(
      z.object({
        projectId: z.number().int(),
        jobNumber: z.string().nullable(),
        name: z.string().nullable(),
        client: z.string().nullable(),
      }),
    )
    .optional(),
  people: z.array(z.object({ name: z.string(), email: z.string() })).optional(),
  categories: z.array(z.string()).optional(),
});
export type EvolveChangeOptions = z.infer<typeof EvolveChangeOptionsSchema>;

export const MessageBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("card"),
    lines: z.array(z.object({ k: z.string(), v: z.string() })),
  }),
  z.object({
    kind: z.literal("ask"),
    text: z.string(),
    approvalEffectId: Id.optional(),
    instructionUpdate: z
      .object({
        botId: Id,
        before: z.string(),
        after: z.string(),
        reason: z.string(),
        undoVersionId: Id.optional(),
      })
      .optional(),
    /** A settings change made from chat; undo writes `before` back while `after` still holds. */
    settingsUpdate: z
      .object({ botId: Id, before: BotSettingsValuesSchema, after: BotSettingsValuesSchema })
      .optional(),
    deadlineChange: ProjectDeadlineChangeSchema.optional(),
    workPackageChange: WorkPackageChangeSchema.optional(),
    projectCommentChange: ProjectCommentChangeSchema.optional(),
    designTeamChange: DesignTeamChangeSchema.optional(),
    siteVisitChange: SiteVisitChangeSchema.optional(),
    detail: z.string().optional(),
    detailFormat: z.enum(["text", "code"]).optional(),
    input: z.enum(["text", "secret"]).optional(),
    /** Why the secret is needed; drives field label on the masked card. */
    purpose: SecretAskPurpose.optional(),
    // Records what the runtime could produce under either deployment mode, so
    // an ask persisted before an owner toggles the private-HTTP flag still
    // validates on replay.
    credential: botSecretDestinationSchema({ allowPrivateHttpOrigin: true }).optional(),
    /** A texted or emailed code for this site's page; answered once, never saved. */
    oneTimeCode: OneTimeCodeTarget.optional(),
    /** On a login card, the saved login this card replaces and the site it is saved for. */
    replaces: z.object({ id: z.string().max(64), origin: z.string().max(2048) }).optional(),
    /** The fields a login card asks for, by label; absent means DEFAULT_LOGIN_FIELD_LABELS. */
    loginFields: LoginFieldLabels.optional(),
    /** On a fetch approval, the site an "always" answer allows. */
    site: z.string().optional(),
    status: z.enum(["pending", "answered"]).optional(),
    answer: z.string().optional(),
    /** A secret request the user dismissed instead of answering. */
    dismissed: z.literal(true).optional(),
    /** A login the user used for this run only instead of saving it. */
    remembered: z.literal(false).optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          outcome: z.enum(["created", "cancelled"]).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    question: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({ id: z.string(), letter: z.string(), label: z.string() })),
    /** Set once the user picks an option; renders the picker as answered. */
    answerId: z.string().optional(),
  }),
  z.object({
    /** Inline app authorization card (Composio-backed): logo, name, one-line
        description, and an Authorize button that flips to connected. */
    kind: z.literal("app_connect"),
    connectorId: z.string().optional(),
    provider: z.string(),
    name: z.string(),
    description: z.string(),
    logo: z.string().nullable(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("connect"),
    name: z.string(),
    initial: z.string(),
    color: z.string(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("computer"),
    state: z.string(),
    text: z.string(),
  }),
  z.object({
    /** Transcript card left in the thread when the bot hangs up a voice call. */
    kind: z.literal("voice_call"),
    /** Absent when the call had no client nonce to derive an id from. */
    callId: z.string().optional(),
    title: z.string(),
    farewell: z.string(),
    /** Connected time the caller's client measured; absent when the bot hung up. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** The bot is calling the user; the card tracks the call from ringing to its outcome. */
    kind: z.literal("call_request"),
    callId: z.string(),
    /** Why the bot is calling, shown on the incoming call. */
    reason: z.string(),
    /** The bot's first spoken sentence once the user answers. */
    opening: z.string(),
    status: z.enum(["ringing", "answered", "declined", "missed"]),
    expiresAt: z.string(),
    /** Connected time the user's client measured after answering. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("meta"), text: z.string() }),
  z.object({
    kind: z.literal("progress"),
    text: z.string(),
    /** Provider-generated tool status rather than assistant-authored narration. */
    activity: z.literal(true).optional(),
    pendingToolNames: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("steps"),
    steps: z.array(
      z.object({
        label: z.string(),
        count: z.number().int().positive(),
        /** What the bot wrote just before this step, kept out of its reply. */
        note: z.string().optional(),
      }),
    ),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("subagent"),
    agentId: z.string(),
    name: z.string(),
    task: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    progress: z.string().optional(),
    result: z.string().optional(),
  }),
  z.object({
    kind: z.literal("child_bot"),
    botId: z.string(),
    name: z.string(),
    status: z.enum(["created", "archived", "deleted"]),
  }),
  z.object({
    /** Compact card for a remote cloud coding agent (not the bot computer). */
    kind: z.literal("cloud_agent"),
    agentId: z.string(),
    title: z.string(),
    status: z.enum(["running", "finished", "failed", "cancelled", "expired"]),
    url: z.string(),
    branch: z.string().optional(),
    prUrl: z.string().optional(),
    latestRunId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("skill_draft"),
    skillId: Id,
    name: z.string(),
    goal: z.string(),
    playbook: z.object({
      whenToUse: z.string(),
      inputs: z.array(z.string()),
      steps: z.array(z.string()),
      howToCheck: z.string(),
      whatToReturn: z.string(),
      approvalBoundaries: z.string(),
      failureHandling: z.string(),
    }),
    status: z.enum(["draft", "saved"]),
  }),
  ChartBlock,
  /** A card the bot drew with show_card: a record, figures, checklist, notice, table or quote. */
  z.object({ kind: z.literal("ui_card"), card: UiCard }),
  z.object({
    /** Approval card for an agent-created MCP server. The user completes the
        OAuth popup (or confirms no authorization is needed) in the UI. The
        status persists so the card renders its decision after a remount. */
    kind: z.literal("mcp_approval"),
    name: z.string(),
    serverId: Id,
    transport: McpTransportSchema,
    endpoint: z.string().nullable(),
    needsOAuth: z.boolean(),
    status: z.enum(["pending", "connected", "dismissed"]).default("pending"),
  }),
  z.object({
    kind: z.literal("import_setup"),
    items: z.array(AgentImportSetupItemSchema),
    /** Set on checklists an earlier Undo retired, with `items` emptied; it is then hidden. */
    undone: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    /** Explicit visual input requested by a confirmation-aware client. */
    imageHandling: z.literal("confirm").optional(),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("file"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  /** Projects, people and exemplar responses added from the composer's References dialog. */
  EvolveReferencesSchema.extend({ kind: z.literal("evolve_references") }),
  EvolveConversationBlockSchema.extend({ kind: z.literal("evolve_conversation") }),
  z.object({
    /** A page the bot saved. Title and version are as sent; read the page for its latest. */
    kind: z.literal("page"),
    pageId: Id,
    version: z.number().int().positive(),
    title: z.string().max(PAGE_TITLE_MAX_LENGTH),
  }),
  z.object({
    kind: z.literal("handoff"),
    fromBotId: Id,
    toBotId: Id,
    text: z.string(),
    /** Links ownership transfers in one user-started group turn. */
    hop: z.number().int().positive().optional(),
  }),
  z.object({
    /** A group-chat message delivered into a member bot's own thread. */
    kind: z.literal("channel_message"),
    provider: z.string(),
    /** Per-message network when a provider spans multiple transports. */
    transport: z.string().optional(),
    channelId: Id,
    fromAddress: z.string(),
    fromLabel: z.string(),
    text: z.string(),
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** Shown in the sending bot's own chat, so the user can see what it sent. */
    kind: z.literal("bot_message_sent"),
    toBotId: Id,
    toBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
  }),
  z.object({
    /** An Outlook draft its person edits and sends from the card; the bot never sends it. */
    kind: z.literal("email_draft"),
    draftId: Id,
  }),
  z.object({
    /**
     * An Evolve Learning Centre clinic the person enrols in, watches and takes the quizzes of on the
     * card; the card loads it live from Evolve as whoever views it, and only their clicks save anything.
     */
    kind: z.literal("learning_clinic"),
    clinicId: z.number().int().positive(),
    moduleId: z.number().int().positive().optional(),
    title: z.string(),
  }),
  z.object({
    /** Delivered into the receiving bot's own chat as the prompt that woke it. */
    kind: z.literal("bot_message_received"),
    fromBotId: Id,
    fromBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
    /** Sender-thread echo this delivery answers, when applicable. */
    returnToMessageId: Id.optional(),
    /** Links in a bot-started chain; absent when a person started it. */
    hop: z.number().int().nonnegative().optional(),
  }),
]);
export type MessageBlock = z.infer<typeof MessageBlock>;

/**
 * Something the bot did on its computer, shown in the terminal's Activity view: a shell
 * command (with a redacted output tail) or a file/app action, whose `command` is the path or
 * app name.
 */
export const COMPUTER_COMMAND_OUTPUT_MAX_CHARS = 16_000;
export const ComputerCommandKind = z.enum([
  "shell",
  "write_file",
  "attach_file",
  "open_path",
  "launch_app",
]);
export type ComputerCommandKind = z.infer<typeof ComputerCommandKind>;
export const ComputerCommandSchema = z.object({
  executionId: z.string(),
  kind: ComputerCommandKind,
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "done"]),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  /** Size written by write_file. */
  bytes: z.number().int().nonnegative().optional(),
});
export type ComputerCommand = z.infer<typeof ComputerCommandSchema>;

/**
 * Collapse running/done events into one entry per command, in start order. A finished
 * command stays finished, so history and live events can be merged in either order.
 */
export function foldComputerCommands<T extends ComputerCommand>(events: T[]): T[] {
  const byId = new Map<string, T>();
  for (const event of events) {
    if (byId.get(event.executionId)?.status === "done" && event.status === "running") continue;
    byId.set(event.executionId, event);
  }
  return [...byId.values()];
}

/** Coarse live run state. Never accepts provider reasoning content or partial messages. */
export const ThreadActivityPayloadSchema = z
  .object({
    activity: z.object({ thinking: z.boolean() }).strict(),
  })
  .strict();

/** Distinguish this live lifecycle subtype from unrelated thread metadata. */
export function hasThinkingActivityMarker(payload: Record<string, unknown>): payload is {
  activity: { thinking: unknown };
} {
  const activity = payload.activity;
  return activity !== null && typeof activity === "object" && "thinking" in activity;
}
export type ThreadActivityPayload = z.infer<typeof ThreadActivityPayloadSchema>;

export const ProductEventSchema = z
  .object({
    id: Id,
    spaceId: Id,
    threadId: Id,
    botId: Id,
    seq: z.number().int().nonnegative(),
    type: ProductEventType,
    runId: Id.optional(),
    createdAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((event, ctx) => {
    if (event.type !== "thread.meta" || !hasThinkingActivityMarker(event.payload)) return;
    if (!event.runId || !ThreadActivityPayloadSchema.safeParse(event.payload).success) {
      ctx.addIssue({ code: "custom", path: ["payload"], message: "Invalid run activity" });
    }
  });
export type ProductEvent = z.infer<typeof ProductEventSchema>;

export const ReplyPreviewSchema = z.object({
  role: MessageRole,
  /** The parent is a page card. */
  page: z.literal(true).optional(),
  botId: Id.optional(),
  text: z.string(),
  attachment: z
    .object({
      kind: z.enum(["image", "file"]),
      artifactId: Id,
      mimeType: z.string(),
      name: z.string(),
    })
    .optional(),
});
export type ReplyPreview = z.infer<typeof ReplyPreviewSchema>;

export const ThreadMessageSchema = z.object({
  id: Id,
  threadId: Id,
  seq: z.number().int().nonnegative(),
  role: MessageRole,
  blocks: z.array(MessageBlock),
  botId: Id.optional(),
  /** A colleague who wrote this in a shared group; unset for the owner. */
  authorUserId: Id.optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().optional(),
  replyPreview: ReplyPreviewSchema.nullable().optional(),
  runId: Id.optional(),
  /** Set when the message was sent from a live voice call; groups one call's transcript. */
  callId: z.string().optional(),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export function canReactToThreadMessage(message: Pick<ThreadMessage, "id" | "blocks">): boolean {
  return (
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:") &&
    !message.blocks.some((block) => block.kind === "channel_message")
  );
}
