import type { ComputerAccess } from "@rakazo/contracts";
import {
  disabledBuiltinToolSet,
  FLEET_TOOL_NAMES,
  FLEET_WRITE_TOOL_NAMES,
} from "@rakazo/contracts";
import { isBackgroundRunTrigger, isOwnerStartedRun } from "@rakazo/core";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectCloudAgentTools } from "./cloud-agent-tools-select.js";
import { selectMemoryTools } from "./memory-tools.js";
import { filterImageReturningComputerTools } from "./model-vision.js";
import { withOcscProgramsOffered } from "./ocsc-tool.js";
import {
  EVOLVE_PLUGIN_COMPUTER_TOOLS,
  EVOLVE_PLUGIN_TOOL_NAMES,
} from "./run-tools-evolve-plugins.js";
import { USER_COMPUTER_SCREEN_TOOLS } from "./run-tools-user-computer.js";
import {
  filterBuiltinToolsForRun,
  filterBuiltinToolsForThread,
  SCHEDULE_TOOL_NAMES,
} from "./schedule-tools.js";
import { SKILL_TOOL_NAMES } from "./skill-tools.js";
import {
  USER_COMPUTER_ACT_TOOL,
  USER_COMPUTER_OBSERVE_TOOL,
  USER_COMPUTER_SHELL_TOOL,
} from "./user-computer-tools.js";

const OUTLOOK_FILING_TOOLS: ReadonlySet<string> = new Set([
  "outlook_filing_candidates",
  "outlook_filing_remember",
  "outlook_propose_filing",
]);

export const READ_ONLY_AGENT_TOOLS = new Set([
  "computer_observe",
  "list_files",
  "list_fleet",
  "read_file",
  "read_history",
  "search_history",
  "request_takeover",
  "run_subagent",
  "task_catalog",
  "recall_memory",
  "schedule_list",
  "scratchpad_list",
  "board_tickets",
  "ticket_get",
  "skill_read",
  "web_search",
  "web_fetch",
  "browser_snapshot",
  "list_secrets",
  "cloud_agent_status",
  "purchase_status",
  "evolve_knowledge_search",
  "evolve_plugin_status",
  "evolve_plugin_scopes",
  "outlook_filing_candidates",
]);

/** Offered only to a user who connected a wallet. */
const PURCHASE_TOOL_NAMES = new Set(["request_purchase", "purchase_status", "paid_request"]);

/** Tools that work on the bot's own computer, offered only while the company allows computers. */
export const COMPUTER_TOOL_NAMES: ReadonlySet<string> = new Set([
  "computer_observe",
  "computer_act",
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
  "list_files",
  "read_file",
  "write_file",
  "attach_file",
  "copy_file",
  "fetch_file",
  "shell",
  "ocsc",
  "open_path",
  "launch_app",
  "request_takeover",
]);

/** A "Tools only" computer: the OCSC commands and the bot's own files, nothing that drives the machine. */
export const TOOLS_ONLY_COMPUTER_TOOLS: ReadonlySet<string> = new Set([
  "list_files",
  "read_file",
  "write_file",
  "attach_file",
  "fetch_file",
  "ocsc",
]);

/** Offered only when the run has conversation files to work on. */
const CONVERSATION_FILE_TOOLS: ReadonlySet<string> = new Set([
  "fetch_file",
  "note_file",
  "list_conversation_files",
]);

const USER_COMPUTER_TOOL_NAMES: ReadonlySet<string> = new Set([
  USER_COMPUTER_SHELL_TOOL,
  USER_COMPUTER_OBSERVE_TOOL,
  USER_COMPUTER_ACT_TOOL,
]);

function computerToolAllowed(name: string, access: ComputerAccess): boolean {
  if (!COMPUTER_TOOL_NAMES.has(name) || access === "full") return true;
  return access === "tools" && TOOLS_ONLY_COMPUTER_TOOLS.has(name);
}

export function drivesComputer(name: string): boolean {
  return (
    COMPUTER_TOOL_NAMES.has(name) ||
    EVOLVE_PLUGIN_COMPUTER_TOOLS.has(name) ||
    USER_COMPUTER_TOOL_NAMES.has(name)
  );
}

/** Why this run may not call a tool that drives the computer, or undefined when it may. */
export function computerAccessRefusal(name: string, access: ComputerAccess): string | undefined {
  if (!drivesComputer(name) || access === "full") return undefined;
  if (access === "tools" && TOOLS_ONLY_COMPUTER_TOOLS.has(name)) return undefined;
  return access === "none"
    ? "This person has no computer access. Document files still use the ocsc tool and file tools when the company document runners are available; shell, screen and browser do not."
    : "This computer only runs the OCSC tools (the ocsc tool) and files in the agent's folder.";
}

export const BUILTIN_AGENT_TOOL_NAMES = new Set(builtinAgentTools.map((tool) => tool.name));

const FLEET_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_TOOL_NAMES);

export const FLEET_WRITE_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_WRITE_TOOL_NAMES);

/**
 * The creation intro asks what the bot is for and records the answer on its own profile.
 * It must not act (shell, computer, scheduling, spawning another bot, ...) before the user
 * has said what it is for. Answering its question resumes it as the user's turn, with
 * every tool (see commitAnswerRunInput).
 */
const CREATED_RUN_TOOL_NAMES = new Set(["ask_user", "update_bot"]);

export function selectBuiltinToolsForRun(options: {
  ticketBoardEnabled?: boolean;
  /** The person's own private chat or routine, where their to-do list may be used. */
  personalTodos?: boolean;
  phoneCallsEnabled?: boolean;
  historyRetrievalEnabled?: boolean;
  graphicalToolsAllowed: boolean;
  /** Page browser tools need a graphical computer (Chrome), not model vision. */
  pageBrowserAllowed?: boolean;
  groupId: string | null;
  trigger: string;
  semanticMemoryEnabled: boolean;
  /** The configured provider can forget individual facts. */
  semanticMemoryForgets?: boolean;
  cloudAgentEnabled?: boolean;
  /** The run's user connected a payment wallet. */
  paymentWalletEnabled?: boolean;
  mediaImagesEnabled?: boolean;
  messagingChannelRun: boolean;
  /**
   * People besides the owner can read this conversation, so even the owner's turns there get
   * no tool that reads notes kept from their private chats.
   */
  sharedConversation?: boolean;
  /** Hanging up is only offered to a turn the caller spoke on a live call. */
  voiceCall?: boolean;
  /** Built-in names this bot turned off. Unknown names are ignored. */
  disabledBuiltinTools?: readonly string[];
  fleetManagement?: boolean;
  /** A follow-up run whose source message the user wrote. */
  followUpFromUser?: boolean;
  /** The person who started this run has their desktop connected (see userComputerOwner). */
  userComputer?: boolean;
  /** That desktop can look at and drive its apps. */
  userComputerScreen?: boolean;
  /** Company-wide switches; each defaults to on. */
  computersEnabled?: boolean;
  /** What the bot owner may do on their computer; defaults to everything. */
  computerAccess?: ComputerAccess;
  /** The person's documents are kept apart from their computer, so copy_file can move files between them. */
  documentsApart?: boolean;
  /** The run lists the person's conversation files, which fetch_file and note_file work on. */
  conversationFiles?: boolean;
  /** At least one of those files is indexed, so search_conversation_files can find passages. */
  conversationFileSearch?: boolean;
  connectedAppsEnabled?: boolean;
  mcpServersEnabled?: boolean;
  routinesEnabled?: boolean;
  /** Evolve is connected and the company turned Evolve plugins on. */
  evolvePluginsEnabled?: boolean;
  /** Evolve is connected and this bot was started from an Evolve assistant. */
  evolveKnowledgeEnabled?: boolean;
  evolveInfographicsEnabled?: boolean;
  evolveProfileEnabled?: boolean;
  /** Cursor agents are on and a plugins repository is set up, so their branches can be imported. */
  pluginBranchImportEnabled?: boolean;
  /**
   * The owner may send Outlook email, has Outlook connected and this is their private chat.
   * Without it the draft tool is not offered, so the model never learns sending exists.
   */
  outlookDrafts?: boolean;
  /**
   * The owner may file Outlook email, has Outlook connected and filing on, and this is their
   * private chat, live or a routine. The tools only read mail and make a card.
   */
  outlookFiling?: boolean;
}) {
  const disabled = disabledBuiltinToolSet(options.disabledBuiltinTools);
  const computerAccess: ComputerAccess =
    options.computersEnabled === false ? "none" : (options.computerAccess ?? "full");
  const ownerStartedRun = isOwnerStartedRun(options.trigger, Boolean(options.followUpFromUser));
  const selected = selectCloudAgentTools(
    selectMemoryTools(
      filterBuiltinToolsForRun(
        filterBuiltinToolsForThread(
          filterPageBrowserTools(
            filterImageReturningComputerTools(builtinAgentTools, options.graphicalToolsAllowed),
            options.pageBrowserAllowed ?? options.graphicalToolsAllowed,
          ),
          options.groupId,
        ),
        options.trigger,
      ),
      options.semanticMemoryEnabled,
      Boolean(options.semanticMemoryForgets),
    ),
    Boolean(options.cloudAgentEnabled),
  ).filter(
    (tool) =>
      !disabled.has(tool.name) &&
      computerToolAllowed(tool.name, computerAccess) &&
      (tool.name !== "copy_file" || Boolean(options.documentsApart)) &&
      (!CONVERSATION_FILE_TOOLS.has(tool.name) || Boolean(options.conversationFiles)) &&
      (tool.name !== "search_conversation_files" ||
        (Boolean(options.conversationFiles) && Boolean(options.conversationFileSearch))) &&
      (options.connectedAppsEnabled !== false || tool.name !== "connect_app") &&
      (options.mcpServersEnabled !== false || tool.name !== "add_mcp_server") &&
      (tool.name !== "evolve_knowledge_search" || Boolean(options.evolveKnowledgeEnabled)) &&
      (tool.name !== "evolve_infographics" || Boolean(options.evolveInfographicsEnabled)) &&
      (tool.name !== "evolve_my_profile" || Boolean(options.evolveProfileEnabled)) &&
      // Plugin tools act as the person in Evolve, so only their own direct turns get them.
      (!EVOLVE_PLUGIN_TOOL_NAMES.has(tool.name) ||
        (Boolean(options.evolvePluginsEnabled) &&
          ownerStartedRun &&
          !options.messagingChannelRun &&
          (computerAccess === "full" || !EVOLVE_PLUGIN_COMPUTER_TOOLS.has(tool.name)) &&
          (tool.name !== "evolve_plugin_import_branch" ||
            Boolean(options.pluginBranchImportEnabled)))) &&
      (options.routinesEnabled !== false ||
        (!SCHEDULE_TOOL_NAMES.has(tool.name) && tool.name !== "create_child_routine")) &&
      (options.trigger !== "created" || CREATED_RUN_TOOL_NAMES.has(tool.name)) &&
      (!FLEET_TOOL_NAMES_SET.has(tool.name) ||
        (Boolean(options.fleetManagement) && ownerStartedRun)) &&
      (ownerStartedRun || (tool.name !== "update_preferences" && tool.name !== "feedback")) &&
      (options.paymentWalletEnabled || !PURCHASE_TOOL_NAMES.has(tool.name)) &&
      (options.mediaImagesEnabled || tool.name !== "generate_image") &&
      (options.ticketBoardEnabled ||
        (tool.name !== "board_tickets" && !tool.name.startsWith("ticket_"))) &&
      (Boolean(options.personalTodos) || !tool.name.startsWith("todo_")) &&
      (tool.name !== "outlook_draft_email" ||
        (Boolean(options.outlookDrafts) &&
          ownerStartedRun &&
          !options.groupId &&
          !options.messagingChannelRun &&
          !isBackgroundRunTrigger(options.trigger))) &&
      (!OUTLOOK_FILING_TOOLS.has(tool.name) ||
        (Boolean(options.outlookFiling) &&
          !options.groupId &&
          !options.messagingChannelRun &&
          !isBackgroundRunTrigger(options.trigger))) &&
      (!isBackgroundRunTrigger(options.trigger) ||
        ![
          "message_user",
          "message_bot",
          "handoff_to_bot",
          "message_agent",
          "generate_image",
        ].includes(tool.name)) &&
      (options.voiceCall || tool.name !== "end_call") &&
      (options.userComputer || tool.name !== "user_computer_shell") &&
      ((options.userComputer && options.userComputerScreen) ||
        !USER_COMPUTER_SCREEN_TOOLS.has(tool.name)) &&
      // Already on a call, or reached through a messaging channel that cannot ring.
      ((options.phoneCallsEnabled &&
        !options.groupId &&
        !options.voiceCall &&
        !options.messagingChannelRun &&
        !isBackgroundRunTrigger(options.trigger)) ||
        tool.name !== "call_user") &&
      (options.historyRetrievalEnabled ||
        !["search_history", "read_history"].includes(tool.name)) &&
      (!options.sharedConversation ||
        (tool.name !== "recall_memory" && !tool.name.startsWith("scratchpad_"))) &&
      (!options.messagingChannelRun ||
        (!SCHEDULE_TOOL_NAMES.has(tool.name) &&
          !SKILL_TOOL_NAMES.has(tool.name) &&
          ![
            "remember",
            "save_shared_memory",
            "save_memory",
            "recall_memory",
            "forget_memory",
            "task_catalog",
            "board_tickets",
          ].includes(tool.name) &&
          !tool.name.startsWith("scratchpad_") &&
          !tool.name.startsWith("ticket_"))),
  );
  // Apps are built only in the App Studio; save_page stays for routines refreshing a page they name.
  const appsOffered = selected.some((tool) => tool.name === "save_app");
  return withOcscProgramsOffered(
    appsOffered && options.trigger !== "routine"
      ? selected.filter((tool) => tool.name !== "save_page")
      : selected,
  );
}

export const PAGE_BROWSER_TOOL_NAMES = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
]);

export function filterPageBrowserTools<T extends { name: string }>(
  tools: T[],
  pageBrowserAllowed: boolean,
): T[] {
  if (pageBrowserAllowed) return tools;
  return tools.filter((tool) => !PAGE_BROWSER_TOOL_NAMES.has(tool.name));
}

/** The fleet tools this run was offered, the same decision as tool selection. */
export function offeredFleetTools(tools: readonly { name: string }[]): string[] {
  return tools.map((tool) => tool.name).filter((name) => FLEET_TOOL_NAMES_SET.has(name));
}

const FOLLOW_UP_TOOL_NAMES = [
  "scratchpad_add",
  "scratchpad_complete",
  "schedule_create",
  "schedule_cancel",
];

/**
 * Whether this run can set its own follow-ups. Only a run the owner started can tell what is
 * still open with them; routines, webhooks, channels, subagents and hand-offs from other bots
 * are not, and some of them would need approval for every schedule.
 */
export function followUpsOffered(
  tools: readonly { name: string }[],
  ownerStartedRun: boolean,
): boolean {
  return (
    ownerStartedRun &&
    FOLLOW_UP_TOOL_NAMES.every((name) => tools.some((tool) => tool.name === name))
  );
}

/** Whether this run can build Evolve plugins (company switch on, owner's direct turn). */
export function evolvePluginsOffered(tools: readonly { name: string }[]): boolean {
  return tools.some((tool) => tool.name === "evolve_plugin_status");
}
