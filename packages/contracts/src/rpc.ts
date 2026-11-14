import type {
  AnyContractProcedure,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";
import {
  AgentImportCreateInput,
  AgentImportPlanSchema,
  AgentImportPreviewInput,
} from "./agent-import.js";
import { AgentImportSetupStateInput, AgentImportSetupStateSchema } from "./agent-import-setup.js";
import { AiConsentQuerySchema, AiConsentStatusSchema } from "./ai-consent.js";
import { AnalyticsScreenInput } from "./analytics.js";
import {
  AppAssetSchema,
  AppBuildProblemSchema,
  AppDataAccessSchema,
  AppDataChangeSchema,
  AppDataSchema,
  AppFilesSchema,
  AppRowIdSchema,
  AppRowSchema,
  AppRowValuesSchema,
  AppTableNameSchema,
  AppTableSchemaSchema,
  AppVersionSchema,
  AppWorkspaceSettingsInputSchema,
  AppWorkspaceSettingsSchema,
} from "./apps.js";
import {
  ARTIFACT_DESCRIPTION_MAX_LENGTH,
  ARTIFACT_NAME_MAX_LENGTH,
  ATTACHMENT_COUNT_CEILING,
} from "./attachments.js";
import { AuditEventListInputSchema, AuditEventPageSchema } from "./audit-events.js";
import {
  BoardEventSchema,
  BoardSchema,
  CommentTicketInput,
  CreateTicketInput,
  GetTicketInput,
  ListTicketsInput,
  ListTicketsOutput,
  MoveTicketInput,
  RenameBoardInput,
  TicketCommentSchema,
  TicketSchema,
  UpdateTicketInput,
} from "./board.js";
import { BotAvatarSetSchema } from "./bot-avatar.js";
import {
  BotSecretMetadata,
  BotSecretPutInput,
  CompanyVaultItemSchema,
  CompanyVaultPutInput,
  LOGIN_FIELD_LIMIT,
  LoginFieldInput,
  StoredBotSecretName,
  VaultPutInput,
  VaultRevealed,
  VaultRevealInput,
} from "./bot-secrets.js";
import {
  AccessGrantInputSchema,
  AccessGrantSchema,
  AccountItemSchema,
  ActionApprovalRuleSchema,
  ActionAutoReviewSettingsSchema,
  AgentSecretInputSchema,
  AgentSecretSchema,
  AgentSkillCatalogEntrySchema,
  AgentSkillSchema,
  AppBootstrapSchema,
  AppLocaleSchema,
  ApprovalModeSchema,
  ArtifactSchema,
  ArtifactVersionSchema,
  ArtifactWithContentSchema,
  AvailabilityKindSchema,
  AvatarStyleSchema,
  BillingClientSchema,
  BillingStatusSchema,
  BotMcpServerSchema,
  BotSchema,
  BotSectionName,
  BotSectionSchema,
  ByokIntervalSchema,
  ByokTierSchema,
  CapabilityInstallSchema,
  ChatAlertSchema,
  CONNECTION_LABEL_MAX_LENGTH,
  CompanyAdminStateSchema,
  CompanyAppSchema,
  CompanyFeaturesSchema,
  CompanyModelInputSchema,
  CompanyToolsSchema,
  ComputerAccessSchema,
  ComputerModeSchema,
  ComputerProviderSettingsSchema,
  ComputerProviderUpdateSchema,
  ComputerReleaseReasonSchema,
  ComputerStatusSchema,
  ComputerUpdateSchema,
  ConnectionCatalogItemSchema,
  ConnectionSchema,
  CreateAgentSkillInput,
  CreateBotInput,
  CreateGroupInput,
  CreateRoutineInput,
  CreateScratchpadItemInput,
  CreateTodoItemInput,
  DeploymentSettingsSchema,
  DirectoryPersonSchema,
  EvolveAssistantSchema,
  EvolveSafeguardsSchema,
  EvolveSafeguardsStateSchema,
  ExportManifestSchema,
  ExternalConversationPolicySchema,
  GroupDetailSchema,
  GroupPeopleSchema,
  GroupSchema,
  IncomingBotCallSchema,
  IntegrationCatalogResultSchema,
  LibraryAiAccessSchema,
  LibraryDocumentSchema,
  MAX_STORAGE_SELECTION,
  McpServerConfigInput,
  McpServerSchema,
  MemoryDocumentSchema,
  MemoryPromptBudgetSchema,
  MemoryScopeSchema,
  MeSchema,
  MessagingAgentConnectionSchema,
  MessagingChannelMembershipSchema,
  MessagingInstallationsStatusSchema,
  MessagingLinkedIdentitySchema,
  MessagingStatusSchema,
  ModelApiProtocolSchema,
  ModelBackupChoiceSchema,
  ModelBackupListSchema,
  ModelCatalogEntrySchema,
  ModelConnectInputSchema,
  ModelConnectionLabelSchema,
  ModelConnectionTargetSchema,
  ModelCredentialSchema,
  ModelCreditAmountSchema,
  ModelOAuthBeginSchema,
  MoveTodoItemInput,
  MyStorageStateSchema,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  PluginMarketplaceCatalogSchema,
  PluginPartSchema,
  PluginPreviewSchema,
  PluginSubmissionReviewSchema,
  PluginSubmissionSchema,
  PluginSubmissionStatusSchema,
  REPLY_QUOTE_MAX_LENGTH,
  ReorderBotsInput,
  ROUTINE_MENTION_BATCH_MAX,
  RoutineSchema,
  ScratchpadItemSchema,
  ScratchpadItemStatusSchema,
  ServerUpdateCheckSchema,
  ServerUpdateRequestSchema,
  ServerUpdateRunSchema,
  ServerUpdateStatusSchema,
  SHAREPOINT_FOLDER_LIMIT,
  SharedAppAdminSchema,
  SharedGroupSchema,
  SharePointBrowseEntrySchema,
  SharePointFolderSchema,
  SharePointLocationSchema,
  SignupSurveySchema,
  SkillPlaybookSchema,
  SpaceAvailabilitySchema,
  SpaceMemoryConfigSchema,
  SpaceNavigationSchema,
  SpaceSchema,
  STAFF_SPENDING_PERIODS,
  StaffSpendingSchema,
  StorageItemRefSchema,
  StoredFilesStateSchema,
  TaughtSkillSchema,
  TeachRecordingEventSchema,
  ThreadMessagePageSchema,
  ThreadSnapshotSchema,
  TimeZoneSchema,
  TodoItemSchema,
  UpdateAgentSkillInput,
  UpdateBotInput,
  UpdateExternalConversationPolicyInput,
  UpdateGroupInput,
  UpdateTodoItemInput,
  UsageRecordSchema,
  UsageSummarySchema,
  VoiceCatalogEntrySchema,
  VoiceCredentialSchema,
  VoiceInfoSchema,
  VoiceStatusSchema,
} from "./domain.js";
import {
  EmailDraftAttachmentSchema,
  EmailDraftEditSchema,
  EmailDraftSchema,
  EmailSignatureSchema,
} from "./email-draft.js";
import {
  ComputerCommandSchema,
  EvolveChangeEditsSchema,
  EvolveChangeOptionKindSchema,
  EvolveChangeOptionsSchema,
  ProductEventSchema,
} from "./events.js";
import {
  EvolveConversationMessagesSchema,
  EvolveConversationPageSchema,
  EvolveHistoryAssistantSchema,
} from "./evolve-history.js";
import {
  EvolveToolCatalogueSchema,
  LearningClinicInput,
  LearningClinicSchema,
  LearningModuleInput,
  LearningQuizInput,
  LearningQuizResultSchema,
} from "./evolve-learning.js";
import {
  EvolvePersonOptionSchema,
  EvolveProjectPageSchema,
  EvolveReferenceExemplarSchema,
  EvolveReferencesSchema,
  EvolveReferenceTabsSchema,
  hasEvolveReferences,
} from "./evolve-references.js";
import { Id, IsoDate, ThinkingLevelSchema } from "./ids.js";
import {
  IntegrationProviderConfigSchema,
  IntegrationSetupStateSchema,
} from "./integration-settings.js";
import { ModelHeadersSchema } from "./model-headers.js";
import { ModelRoleSchema, ModelRoleUpdateSchema, ModelRoleViewSchema } from "./model-roles.js";
import {
  PAGE_LIST_MAX_LIMIT,
  PageDetailSchema,
  PageStateKeySchema,
  PageStateValuesSchema,
  PageSummarySchema,
  PageTitleSchema,
  PageVisibilitySchema,
} from "./pages.js";
import { PaymentWalletStatusSchema } from "./payments.js";
import { MessageReactionSchema } from "./reactions.js";
import { RoutineWatchSchema } from "./routine-watch.js";
import {
  ROUTINE_HISTORY_PAGE_SIZE,
  RoutineHistorySchema,
  RoutineRunCursorSchema,
  RunsListOutputSchema,
} from "./runs.js";
import { SearchQueryOutputSchema } from "./search.js";
import { SecurityEventListInputSchema, SecurityEventSchema } from "./security-events.js";
import { SettingsScopeSchema, SpaceSettingSchema, settingsScopeInput } from "./settings-scope.js";
import {
  ROUTINE_ACTIVITY_PERIODS,
  RoutineActivitySchema,
  StaffLimitsSchema,
  StaffLimitsStateSchema,
  StaffPersonLimitsSchema,
} from "./staff-limits.js";

const botId = z.object({ botId: Id });
const groupId = z.object({ groupId: Id });

const threadTarget = z
  .object({
    botId: Id.optional(),
    groupId: Id.optional(),
  })
  .superRefine((input, ctx) => {
    const hasBot = Boolean(input.botId);
    const hasGroup = Boolean(input.groupId);
    if (hasBot === hasGroup) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of botId or groupId",
        path: ["botId"],
      });
    }
  });

const structuredMentionTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), id: Id }),
  z.object({ kind: z.literal("group"), id: Id }),
  z.object({ kind: z.literal("routine"), id: Id }),
  z.object({ kind: z.literal("connector"), id: Id }),
]);

const threadSendFields = threadTarget.safeExtend({
  imageHandling: z.enum(["confirm", "file"]).optional(),
  text: z.string().optional(),
  artifactIds: z.array(Id).max(ATTACHMENT_COUNT_CEILING).optional(),
  /** Bare bot ids (legacy) or typed mention chips from the composer. */
  mentions: z
    .array(z.union([Id, structuredMentionTarget]))
    .max(64)
    .optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().trim().min(1).max(REPLY_QUOTE_MAX_LENGTH).optional(),
  /** Sent from the open page: a reply to its card that quotes nothing. */
  fromPage: z.literal(true).optional(),
  clientNonce: z.string().min(1).max(200).optional(),
  /** Evolve projects, people and exemplars to add as context, as Evolve chat's References do. */
  evolveReferences: EvolveReferencesSchema.optional(),
});

const threadSendInput = threadSendFields.superRefine((input, ctx) => {
  const text = input.text?.trim() ?? "";
  const artifactIds = input.artifactIds ?? [];
  if (!text && artifactIds.length === 0 && !hasEvolveReferences(input.evolveReferences)) {
    ctx.addIssue({
      code: "custom",
      message: "Provide text or at least one attachment",
      path: ["text"],
    });
  }
  if (input.replyQuote && !input.replyToMessageId) {
    ctx.addIssue({
      code: "custom",
      message: "replyQuote requires replyToMessageId",
      path: ["replyQuote"],
    });
  }
});

const threadSendOutput = z.object({
  taskId: Id,
  runId: Id,
  seq: z.number().int(),
  runIds: z.array(Id).optional(),
});

/** Without text or attachments, only the routines run and no message is saved. */
const threadSendWithRoutinesInput = threadSendFields.safeExtend({
  clientNonce: z.string().min(1).max(200),
  routineIds: z.array(Id).min(1).max(64),
});

const spaceName = z.string().trim().min(1).max(60);
const organizationName = spaceName;
/** Every organization the signed-in user belongs to, and which one the current Space belongs to. */
export const OrganizationListSchema = z.object({
  activeOrganizationId: Id,
  organizations: z.array(
    z.object({
      id: Id,
      name: z.string(),
      defaultSpaceId: Id,
      spaceIds: z.array(Id),
      /** Whether the user owns it, so can rename or delete it. */
      canManage: z.boolean(),
      /** The company work space every person has; it can be renamed but not deleted. */
      permanent: z.boolean().optional(),
    }),
  ),
});
export type OrganizationList = z.infer<typeof OrganizationListSchema>;

export const appContract = {
  analytics: { screen: oc.input(AnalyticsScreenInput).output(z.object({ ok: z.literal(true) })) },
  aiConsent: {
    status: oc.input(AiConsentQuerySchema).output(AiConsentStatusSchema),
    allow: oc
      .input(
        z.object({
          scope: z.string(),
          version: z.string(),
          keys: z.array(z.string()).min(1).max(200),
          /** The settings copy the reviewed recipients came from, as in `status`. */
          settingsScope: SettingsScopeSchema.optional(),
        }),
      )
      .output(AiConsentStatusSchema),
    revoke: oc.input(z.object({ key: z.string().nullable() })).output(AiConsentStatusSchema),
  },
  health: oc.output(z.object({ ok: z.literal(true), version: z.string() })),
  me: oc.output(MeSchema),
  billing: {
    /** Claims an invite code first when one is sent, so the status already reflects it. */
    status: oc
      .input(z.object({ referralCode: z.string().min(1).max(64).optional() }).optional())
      .output(BillingStatusSchema),
    /** Re-reads the subscription from the provider, e.g. right after a mobile checkout. */
    refresh: oc.output(BillingStatusSchema),
    selectFunding: oc
      .input(
        z.object({
          funding: z.enum(["byok", "credits"]),
          client: BillingClientSchema,
          /** Billing period of the own-key plan's checkout; monthly when omitted. */
          interval: ByokIntervalSchema.optional(),
        }),
      )
      /** `url` is the checkout to pay for the own-key plan before it has access. */
      .output(z.object({ ok: z.literal(true), url: z.string().url().optional() })),
    purchaseCredits: oc
      .input(
        z.object({
          amountCents: ModelCreditAmountSchema,
          monthly: z.boolean(),
          client: BillingClientSchema,
        }),
      )
      .output(z.object({ url: z.string().url() })),
    setMonthlyCredits: oc
      .input(z.object({ amountCents: ModelCreditAmountSchema }))
      .output(z.object({ ok: z.literal(true) })),
    checkout: oc
      .input(
        z
          .object({
            client: BillingClientSchema,
            interval: ByokIntervalSchema.optional(),
            /** The own-key plan's tier; Standard when omitted. */
            tier: ByokTierSchema.optional(),
          })
          .optional(),
      )
      .output(z.object({ url: z.string().url() })),
    portal: oc
      .input(z.object({ client: BillingClientSchema }).optional())
      .output(z.object({ url: z.string().url() })),
    /** Owners only: ends the running trial and bills the first period now. */
    endTrial: oc.output(BillingStatusSchema),
    /** Owners only: moves a monthly own-key plan to yearly, charging the difference now. */
    switchToYearly: oc.output(BillingStatusSchema),
    /** Owners only: moves the own-key plan to another tier at the same interval, billing the difference now. */
    changeTier: oc.input(z.object({ tier: ByokTierSchema })).output(BillingStatusSchema),
    /** Records who invited this organization; ignored once it has subscribed. */
    claimReferral: oc
      .input(z.object({ code: z.string().min(1).max(64) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  /** Admins only: the model every account runs on and the company-wide feature switches. */
  companyAdmin: {
    get: oc.output(CompanyAdminStateSchema),
    setModel: oc.input(CompanyModelInputSchema).output(CompanyAdminStateSchema),
    clearModel: oc.output(CompanyAdminStateSchema),
    setThinkingLevel: oc
      .input(z.object({ thinkingLevel: ThinkingLevelSchema.nullable() }))
      .output(CompanyAdminStateSchema),
    setFeatures: oc.input(CompanyFeaturesSchema.partial()).output(CompanyAdminStateSchema),
    setTools: oc.input(CompanyToolsSchema.partial()).output(CompanyAdminStateSchema),
    /** Asks Evolve for its tool list now instead of waiting for the next check. */
    checkTools: oc.output(CompanyAdminStateSchema),
    /** One person's computer access; null returns them to the company default. */
    setComputerAccess: oc
      .input(z.object({ userId: z.string().min(1), access: ComputerAccessSchema.nullable() }))
      .output(CompanyAdminStateSchema),
    /** One person's computer storage limit; null returns them to the company default. */
    setStorageLimit: oc
      .input(
        z.object({
          userId: z.string().min(1),
          limitMb: z.number().int().min(100).max(10_000_000).nullable(),
        }),
      )
      .output(CompanyAdminStateSchema),
    /** Asks the worker to run file cleanup now instead of waiting for the schedule. */
    runFileCleanup: oc.output(CompanyAdminStateSchema),
    /** Shares the caller's own voice connection with everyone, or stops sharing it. */
    shareVoice: oc.input(z.object({ share: z.boolean() })).output(CompanyAdminStateSchema),
    /** Logins, API keys and command variables every member's assistants can use. */
    vault: {
      list: oc.output(z.array(BotSecretMetadata)),
      put: oc.input(CompanyVaultPutInput).output(BotSecretMetadata),
      remove: oc
        .input(z.object({ name: StoredBotSecretName }))
        .output(z.object({ ok: z.literal(true) })),
    },
    /** Model spending per person across every space. */
    spending: oc
      .input(z.object({ period: z.enum(STAFF_SPENDING_PERIODS).default("30d") }))
      .output(StaffSpendingSchema),
    /** Routine and spend limits for everyone, admins included, and each person's overrides. */
    staffLimits: {
      get: oc.output(StaffLimitsStateSchema),
      setDefaults: oc.input(StaffLimitsSchema.partial()).output(StaffLimitsStateSchema),
      setPerson: oc
        .input(StaffPersonLimitsSchema.partial().extend({ userId: z.string().min(1) }))
        .output(StaffLimitsStateSchema),
    },
    /** Routines created over time, per person. */
    routineActivity: oc
      .input(z.object({ period: z.enum(ROUTINE_ACTIVITY_PERIODS).default("30d") }))
      .output(RoutineActivitySchema),
    /**
     * What AI may do with each Evolve Document Library item, read and changed in Evolve as the
     * admin, who must also be an Evolve admin or Document Library manager.
     */
    documentLibrary: {
      list: oc.output(
        z.object({
          documents: z.array(LibraryDocumentSchema),
          /** The template new Word documents start from; null is the built-in OCSC report. */
          defaultTemplateId: z.string().nullable(),
        }),
      ),
      /** Makes a Library template the company's default Word template, or null for the built-in one. */
      setDefaultTemplate: oc
        .input(z.object({ id: z.string().uuid().nullable() }))
        .output(z.object({ defaultTemplateId: z.string().nullable() })),
      setAccess: oc
        .input(z.object({ id: z.string().uuid(), aiAccess: LibraryAiAccessSchema }))
        .output(z.object({ id: z.string(), aiAccess: LibraryAiAccessSchema })),
    },
    /**
     * Who may change Evolve deadlines and work packages through the AI and how many changes a
     * person may make, read and set in Evolve as the admin, who must also be an Evolve admin.
     */
    evolveSafeguards: {
      get: oc.output(EvolveSafeguardsStateSchema),
      set: oc.input(EvolveSafeguardsSchema).output(EvolveSafeguardsStateSchema),
    },
    /**
     * Every shared or published page and app on this server. Freezing one closes its link and its
     * Evolve plugin data and stops it being shared again, without changing the owner's copy.
     */
    sharedApps: {
      list: oc.output(z.array(SharedAppAdminSchema)),
      setFrozen: oc
        .input(z.object({ pageId: z.string().min(1).max(64), frozen: z.boolean() }))
        .output(SharedAppAdminSchema),
    },
  },
  /** Admins only, on deployments that sell model credits. */
  accessGrants: {
    list: oc.output(z.array(AccessGrantSchema)),
    create: oc.input(AccessGrantInputSchema).output(AccessGrantSchema),
    revoke: oc.input(z.object({ id: Id })).output(AccessGrantSchema),
  },
  preferences: {
    update: oc
      .input(
        z
          .object({
            avatarStyle: AvatarStyleSchema.optional(),
            /** Restyles every bot not pinned to another set, and is what new bots get. */
            botAvatarSet: BotAvatarSetSchema.optional(),
            timezone: TimeZoneSchema.nullable().optional(),
            /** The language the app runs in, so emails can be written in it. */
            locale: AppLocaleSchema.optional(),
          })
          .refine(
            (input) =>
              input.avatarStyle !== undefined ||
              input.botAvatarSet !== undefined ||
              input.timezone !== undefined ||
              input.locale !== undefined,
            { message: "Nothing to update" },
          ),
      )
      .output(MeSchema),
    /** Saves a detected timezone only while none is saved, so it never replaces a choice. */
    adoptTimezone: oc.input(z.object({ timezone: TimeZoneSchema })).output(MeSchema),
  },
  spaces: {
    list: oc.output(SpaceNavigationSchema),
    create: oc.input(z.object({ name: spaceName })).output(SpaceSchema),
    rename: oc
      .input(z.object({ spaceId: Id, name: spaceName }))
      .output(z.object({ id: Id, name: z.string() })),
    remove: oc
      .input(z.object({ spaceId: Id }))
      .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
  },
  organizations: {
    list: oc.output(OrganizationListSchema),
    create: oc
      .input(z.object({ name: organizationName }))
      .output(z.object({ id: Id, name: z.string(), defaultSpaceId: Id })),
    rename: oc
      .input(z.object({ organizationId: Id, name: organizationName }))
      .output(z.object({ id: Id, name: z.string() })),
    remove: oc
      .input(z.object({ organizationId: Id }))
      .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
  },
  bootstrap: oc.input(z.object({ botId: Id.optional() })).output(AppBootstrapSchema),
  deployment: {
    get: oc.output(DeploymentSettingsSchema),
    update: oc
      .input(
        z.object({
          signupsEnabled: z.boolean().optional(),
          signupAllowlist: z.array(z.string()).optional(),
          computerHost: z.enum(["docker", "this-mac"]).nullable().optional(),
        }),
      )
      .output(DeploymentSettingsSchema),
  },
  /** Admin choice of where new computers run, with that provider's connection settings. */
  computerProvider: {
    get: oc.output(ComputerProviderSettingsSchema),
    update: oc.input(ComputerProviderUpdateSchema).output(ComputerProviderSettingsSchema),
    /** The signed-in account's provider for Team Computers, over the default. */
    account: {
      get: oc.output(ComputerProviderSettingsSchema),
      update: oc.input(ComputerProviderUpdateSchema).output(ComputerProviderSettingsSchema),
    },
  },
  /** Deployment-owner view of the append-only security event log, newest first. */
  security: {
    events: oc.input(SecurityEventListInputSchema).output(z.array(SecurityEventSchema)),
  },
  /** The organization's audit log, newest first. Organization owners and admins only. */
  audit: {
    events: oc.input(AuditEventListInputSchema).output(AuditEventPageSchema),
  },
  /**
   * Deployment-owner product updates. When the Compose updater sidecar is reachable, these proxy
   * to its `/state` `/plan` `/apply` contract. Rollback stays on the sidecar for ops only and is
   * not exposed here. Never git-fetch from the API process.
   */
  updater: {
    status: oc.output(ServerUpdateStatusSchema),
    check: oc.input(ServerUpdateRequestSchema).output(ServerUpdateCheckSchema),
    apply: oc.input(ServerUpdateRequestSchema).output(ServerUpdateRunSchema),
  },
  models: {
    forRole: oc
      .input(z.object({ role: ModelRoleSchema, expectedUserId: Id.optional() }))
      .output(z.array(ModelCatalogEntrySchema)),
    role: oc
      .input(
        z.object({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    setRole: oc
      .input(
        ModelRoleUpdateSchema.extend({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    list: oc.output(z.array(ModelCatalogEntrySchema)),
    credentials: oc.output(z.array(ModelCredentialSchema)),
    backups: oc.output(z.array(ModelBackupChoiceSchema)),
    setBackups: oc.input(ModelBackupListSchema).output(z.object({ ok: z.literal(true) })),
    connect: oc.input(ModelConnectInputSchema).output(ModelCredentialSchema),
    probeOpenAiCompatible: oc
      .input(
        z.object({
          baseUrl: z.string(),
          credentialId: z.string().optional(),
          headers: ModelHeadersSchema.optional(),
          apiKey: z.string().optional(),
          apiProtocol: ModelApiProtocolSchema.optional(),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    probeCatalog: oc
      .input(
        z.object({
          provider: z.string().trim().min(1),
          apiKey: z.string().trim().min(8),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    beginOAuth: oc
      .input(
        z.object({
          provider: z.string(),
          label: z.string().optional(),
          /** Signs an existing connection in again; null adds another, as connect does. */
          credentialId: ModelConnectionTargetSchema,
          modelId: z.string().optional(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
          makeDefault: z.boolean().optional(),
          scope: SettingsScopeSchema.optional(),
          /** No loopback listener (web, mobile): the provider shows a code to paste instead. */
          codePage: z.boolean().optional(),
        }),
      )
      .output(ModelOAuthBeginSchema),
    submitOAuthCode: oc
      .input(z.object({ loginId: z.string(), code: z.string().trim().min(1).max(8_192) }))
      .output(z.object({ ok: z.literal(true) })),
    completeOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal("pending") }),
          z.object({ status: z.literal("ready") }),
          z.object({ status: z.literal("error"), error: z.string() }),
        ]),
      ),
    finishOAuth: oc.input(z.object({ loginId: z.string() })).output(ModelCredentialSchema),
    cancelOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    setDefault: oc
      .input(
        z.object({
          provider: z.string(),
          modelId: z.string(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    rename: oc
      .input(z.object({ credentialId: Id, label: ModelConnectionLabelSchema }))
      .output(z.object({ ok: z.literal(true) })),
    /** Removes one connection, or every connection of the provider when older apps omit it. */
    disconnect: oc
      .input(z.object({ provider: z.string().trim().min(1), credentialId: Id.optional() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  bots: {
    list: oc.output(z.array(BotSchema)),
    listArchived: oc.output(z.array(BotSchema)),
    get: oc.input(botId).output(BotSchema),
    create: oc.input(CreateBotInput).output(BotSchema),
    /** Evolve chat assistants this person may start a bot from; empty when Evolve is not linked. */
    evolveAssistants: oc.output(z.array(EvolveAssistantSchema)),
    importPreview: oc.input(AgentImportPreviewInput).output(AgentImportPlanSchema),
    importCreate: oc.input(AgentImportCreateInput).output(BotSchema),
    importSetupState: oc.input(AgentImportSetupStateInput).output(AgentImportSetupStateSchema),
    duplicate: oc.input(botId).output(BotSchema),
    reorder: oc.input(ReorderBotsInput).output(z.object({ ok: z.literal(true) })),
    update: oc.input(UpdateBotInput).output(BotSchema),
    restoreInstructions: oc
      .input(
        z.object({
          botId: Id,
          versionId: Id,
          expectedInstructions: z.string(),
          undo: z.boolean().optional(),
        }),
      )
      .output(BotSchema),
    setComputer: oc.input(z.object({ botId: Id, mode: ComputerModeSchema })).output(BotSchema),
    archive: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    remove: oc
      .input(z.object({ botId: Id, deleteMemories: z.boolean().default(false) }))
      .output(z.object({ ok: z.literal(true) })),
    rotateWebhookSecret: oc.input(botId).output(
      z.object({
        secret: z.string(),
        path: z.string(),
        webhookConfigured: z.literal(true),
      }),
    ),
  },
  groups: {
    create: oc.input(CreateGroupInput).output(GroupSchema),
    list: oc.output(z.array(GroupSchema)),
    listArchived: oc.output(z.array(GroupSchema)),
    get: oc.input(groupId).output(GroupDetailSchema),
    duplicate: oc.input(groupId).output(GroupSchema),
    update: oc.input(UpdateGroupInput).output(GroupSchema),
    archive: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    remove: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    people: oc.input(groupId).output(GroupPeopleSchema),
    addPerson: oc
      .input(groupId.safeExtend({ email: z.string().trim().toLowerCase().email().max(254) }))
      .output(GroupPeopleSchema),
    removePerson: oc
      .input(
        groupId.safeExtend({
          userId: Id.optional(),
          email: z.string().trim().toLowerCase().email().max(254).optional(),
        }),
      )
      .output(GroupPeopleSchema),
    /**
     * Active Evolve profiles to add; unavailable when this deployment is not linked to Evolve.
     * Without a group (while creating one) nobody is marked as already added.
     */
    searchDirectory: oc
      .input(z.object({ groupId: Id.optional(), query: z.string().trim().min(2).max(80) }))
      .output(z.object({ available: z.boolean(), people: z.array(DirectoryPersonSchema) })),
    /** Groups other people own that the signed-in user was added to, from any Space. */
    shared: oc.output(z.array(SharedGroupSchema)),
  },
  /** The composer's References dialog: Evolve's projects, people and exemplar responses. */
  evolveReferences: {
    /** Which tabs this bot offers; unavailable when this deployment is not linked to Evolve. */
    tabs: oc.input(z.object({ botId: Id.optional() })).output(EvolveReferenceTabsSchema),
    projects: oc
      .input(
        z.object({
          search: z.string().trim().max(200).default(""),
          page: z.number().int().min(0).max(10_000).default(0),
        }),
      )
      .output(EvolveProjectPageSchema),
    people: oc.output(z.object({ people: z.array(EvolvePersonOptionSchema) })),
    exemplars: oc.output(z.object({ exemplars: z.array(EvolveReferenceExemplarSchema) })),
  },
  /**
   * Evolve Learning Centre clinic cards. Each call is signed as the person clicking, so it loads and
   * saves only their own enrolment and quiz attempts; Evolve marks the quizzes.
   */
  evolveLearning: {
    card: oc.input(LearningClinicInput).output(LearningClinicSchema),
    enrol: oc.input(LearningClinicInput).output(LearningClinicSchema),
    /** Completes a module that has no quiz once its video was watched. */
    markWatched: oc.input(LearningModuleInput).output(LearningClinicSchema),
    submitQuiz: oc
      .input(LearningQuizInput)
      .output(z.object({ result: LearningQuizResultSchema, clinic: LearningClinicSchema })),
  },
  /** Every Evolve tool the company offers, with what it does and whether this person can use it. */
  evolveTools: {
    catalogue: oc.output(EvolveToolCatalogueSchema),
  },
  /** Render Studio: granular gpt-image-2 edits run on Evolve, as in Evolve's chat. */
  evolveImages: {
    /** Whether this deployment is linked to Evolve, so images can be edited. */
    available: oc.output(z.object({ available: z.boolean() })),
    edit: oc
      .input(
        z.object({
          /** The image to edit, as a base64 data URL. */
          image: z
            .string()
            .max(14_000_000)
            .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
          /** Same size as the image: a transparent overlay outlining the area to change. */
          markup: z
            .string()
            .max(14_000_000)
            .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
            .nullable()
            .default(null),
          prompt: z.string().trim().min(1).max(4000),
          size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024"),
          quality: z.enum(["low", "medium", "high"]).default("medium"),
        }),
      )
      .output(z.object({ image: z.string() })),
  },
  /** The signed-in person's own Evolve chats. Archived ones can be restored or deleted. */
  evolveHistory: {
    /** Assistants they have conversations with; unavailable when Evolve is not linked. */
    assistants: oc.output(
      z.object({
        available: z.boolean(),
        assistants: z.array(EvolveHistoryAssistantSchema),
        /** How many of their conversations they have continued in a chat here. */
        continued: z.number().int().nonnegative().default(0),
      }),
    ),
    conversations: oc
      .input(
        z.object({
          assistantId: z.string().uuid().optional(),
          search: z.string().trim().max(200).default(""),
          page: z.number().int().min(0).max(10_000).default(0),
          /** Archived Evolve chats. The sidebar lists these, with restore and delete. */
          archived: z.boolean().default(true),
        }),
      )
      .output(EvolveConversationPageSchema),
    /** Puts an archived Evolve chat back in Evolve. */
    restore: oc
      .input(z.object({ conversationId: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    /** Removes one of the person's Evolve chats, and its messages, from Evolve. */
    remove: oc
      .input(z.object({ conversationId: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    messages: oc
      .input(
        z.object({
          conversationId: z.string().uuid(),
          before: z.string().max(64).optional(),
        }),
      )
      .output(EvolveConversationMessagesSchema),
    /** Opens an archived chat as a chat of its own, made on first open with its history. */
    open: oc
      .input(z.object({ conversationId: z.string().uuid() }))
      .output(z.object({ botId: z.string().min(1).max(64), created: z.boolean() })),
  },
  botSections: {
    list: oc.output(z.array(BotSectionSchema)),
    create: oc.input(threadTarget.safeExtend({ name: BotSectionName })).output(BotSectionSchema),
    update: oc.input(z.object({ sectionId: Id, name: BotSectionName })).output(BotSectionSchema),
    remove: oc.input(z.object({ sectionId: Id })).output(
      z.object({
        id: Id,
        releasedBots: z.number().int().nonnegative(),
        releasedGroups: z.number().int().nonnegative(),
      }),
    ),
  },
  threads: {
    head: oc.input(threadTarget).output(
      z.object({
        threadId: Id,
        cursor: z.number().int().min(-1),
      }),
    ),
    get: oc.input(threadTarget).output(ThreadSnapshotSchema),
    messages: oc
      .input(
        threadTarget.safeExtend({
          before: z.number().int().nonnegative().optional(),
          includePeerRuns: z.boolean().optional(),
          includePeerReceipts: z.boolean().optional(),
          around: z
            .object({
              messageId: Id.optional(),
              seq: z.number().int().nonnegative().optional(),
            })
            .optional(),
        }),
      )
      .output(ThreadMessagePageSchema),
    subscribe: oc
      .input(threadTarget.safeExtend({ cursor: z.number().int().min(-1) }))
      .output(eventIterator(ProductEventSchema)),
    send: oc.input(threadSendInput).output(threadSendOutput),
    /**
     * A send that also test-runs the mentioned routines: the message and every run commit
     * together, keyed by the nonce. A separate procedure, because an API without it must
     * reject the call rather than strip the routines and send only the text.
     */
    /** Puts the person's own earlier Evolve conversation into a bot's chat to carry on from. */
    continueEvolveConversation: oc
      .input(
        botId.safeExtend({
          conversationId: z.string().uuid(),
          clientNonce: z.string().min(1).max(200),
        }),
      )
      .output(threadSendOutput),
    sendWithRoutines: oc
      .input(threadSendWithRoutinesInput)
      .output(z.object({ routineRunIds: z.array(Id), send: threadSendOutput.optional() })),
    react: oc
      .input(
        threadTarget.safeExtend({
          messageId: Id,
          reaction: MessageReactionSchema,
          clientNonce: z.string().min(1).max(200),
        }),
      )
      .output(z.object({ ok: z.literal(true), runIds: z.array(Id).optional() })),
    stop: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    followUp: oc
      .input(
        threadTarget.safeExtend({
          text: z.string().min(1),
          /** Carries the call id, so a turn taken mid-run stays in the call's card. */
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** The client hung up: close the call card and let the bot finish what was asked on it. */
    endCall: oc
      // ":" separates the call id from the nonce suffix, so it can never appear inside one.
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
          /** How long the call was connected, measured from pickup on the caller's client. */
          durationSeconds: z
            .number()
            .int()
            .nonnegative()
            .max(7 * 24 * 60 * 60)
            .optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** The user picked up the bot's call: returns what the bot opens with. */
    answerCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
        }),
      )
      .output(z.object({ opening: z.string(), reason: z.string() })),
    /** The user turned the bot's call down, asked for it later, or it rang out. */
    declineCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
          outcome: z.enum(["declined", "missed"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    clear: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    answer: oc
      .input(
        threadTarget
          .safeExtend({
            runId: Id,
            messageId: Id,
            answer: z.string(),
            /** Carries the call id for an answer spoken during a call. */
            clientNonce: z.string().min(1).max(200).optional(),
            /** A login card's answer, one per requested field; `answer` is then empty. */
            fields: z.array(LoginFieldInput).min(1).max(LOGIN_FIELD_LIMIT).optional(),
            /** A login card's answer from apps that predate `fields`; `answer` carries its password. */
            username: z.string().min(1).max(512).optional(),
            /** Only for a login card: use the login for this run only instead of saving it. */
            remember: z.literal(false).optional(),
            /** Turns down a pending secret request; `answer` is then empty. */
            dismiss: z.literal(true).optional(),
          })
          .refine(
            (input) => input.remember === undefined || Boolean(input.fields ?? input.username),
            {
              message: "Only a website login can be used without saving it",
              path: ["remember"],
            },
          )
          .refine(
            (input) =>
              input.dismiss
                ? input.answer === "" && !input.username && !input.fields && !input.clientNonce
                : input.fields
                  ? input.answer === "" && !input.username
                  : input.answer.length > 0,
            "Send either an answer or a dismissal",
          ),
      )
      .output(z.object({ ok: z.literal(true) })),
    /**
     * The run owner's edits to a pending deadline or work package card. Evolve previews the edited
     * change and the card is replaced with it; nothing is saved until the card is approved.
     */
    reviseEvolveChange: oc
      .input(threadTarget.safeExtend({ runId: Id, messageId: Id, edits: EvolveChangeEditsSchema }))
      .output(z.object({ ok: z.literal(true) })),
    /** Live Evolve projects, people or categories for a pending card's pickers. */
    evolveChangeOptions: oc
      .input(
        threadTarget.safeExtend({
          runId: Id,
          kind: EvolveChangeOptionKindSchema,
          query: z.string().trim().max(100).default(""),
        }),
      )
      .output(EvolveChangeOptionsSchema),
    /** `unreadAfterSeq`: the seq read up to before this call, null when nothing was unread. */
    markRead: oc
      .input(threadTarget)
      .output(z.object({ ok: z.literal(true), unreadAfterSeq: z.number().int().nullable() })),
    /** With `messageId`, the chat reads as unread from that message: the next open puts New above it. */
    markUnread: oc
      .input(threadTarget.and(z.object({ messageId: Id.optional() })))
      .output(z.object({ ok: z.literal(true) })),
  },
  computer: {
    status: oc.input(botId).output(ComputerStatusSchema),
    boot: oc.input(botId).output(ComputerStatusSchema),
    stop: oc.input(botId).output(ComputerStatusSchema),
    recover: oc.input(botId).output(ComputerUpdateSchema),
    reset: oc.input(botId).output(ComputerStatusSchema),
    update: oc.input(botId).output(ComputerUpdateSchema),
    updates: oc.output(z.array(ComputerUpdateSchema)),
    releaseInterrupted: oc
      .input(z.object({ id: Id, workersStopped: z.literal(true) }))
      .output(z.object({ ok: z.literal(true) })),
    dismissUpdate: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    dismissDiskWarning: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    takeover: oc.input(botId).output(z.object({ leaseId: Id, expiresAt: z.string() })),
    release: oc
      .input(
        z.object({
          botId: Id,
          reason: ComputerReleaseReasonSchema.optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    input: oc
      .input(
        z.object({
          botId: Id,
          kind: z.enum(["key", "pointer", "clipboard", "scroll"]),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    files: oc
      .input(z.object({ botId: Id, path: z.string().default("/") }))
      .output(
        z.array(z.object({ path: z.string(), kind: z.enum(["file", "dir"]), size: z.number() })),
      ),
    readFile: oc
      .input(z.object({ botId: Id, path: z.string() }))
      .output(z.object({ path: z.string(), content: z.string() })),
    downloadFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1) }))
      .output(z.object({ path: z.string(), contentBase64: z.string() })),
    uploadFile: oc
      .input(
        z.object({
          botId: Id,
          path: z.string().min(1),
          contentBase64: z.string(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** The bot's Files tab: what it made, when cleanup deletes each item, and storage used. */
    storedFiles: oc.input(botId).output(StoredFilesStateSchema),
    pinStoredFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1).max(1024), pinned: z.boolean() }))
      .output(StoredFilesStateSchema),
    deleteStoredFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1).max(1024) }))
      .output(StoredFilesStateSchema),
    downloadStoredFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1).max(1024) }))
      .output(z.object({ path: z.string(), contentBase64: z.string() })),
    /** Manage storage: everything counting against the caller's limit, across all their bots. */
    myStorage: oc.output(MyStorageStateSchema),
    deleteMyStorage: oc
      .input(z.object({ items: z.array(StorageItemRefSchema).min(1).max(MAX_STORAGE_SELECTION) }))
      .output(MyStorageStateSchema),
    pinMyStorage: oc
      .input(z.object({ botId: Id, path: z.string().min(1).max(1024), pinned: z.boolean() }))
      .output(MyStorageStateSchema),
    /** A one-time link to a zip of the chosen items, opened as a plain download. */
    myStorageDownload: oc
      .input(z.object({ items: z.array(StorageItemRefSchema).min(1).max(MAX_STORAGE_SELECTION) }))
      .output(z.object({ url: z.string() })),
    terminalUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    commands: oc
      .input(botId)
      .output(z.array(ComputerCommandSchema.extend({ createdAt: z.string() }))),
    screenUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    heartbeat: oc.input(botId).output(z.object({ ok: z.literal(true) })),
  },
  memory: {
    list: oc
      .input(z.object({ botId: Id.optional(), scope: z.enum(["bot", "user"]).optional() }))
      .output(z.array(MemoryDocumentSchema)),
    budget: oc.input(z.object({ botId: Id })).output(MemoryPromptBudgetSchema),
    create: oc
      .input(z.object({ name: z.string().min(1).max(200), content: z.string().min(1) }))
      .output(MemoryDocumentSchema),
    update: oc
      .input(
        z.object({
          documentId: Id,
          content: z.string(),
          expectedRevision: z.number().int().positive().optional(),
        }),
      )
      .output(MemoryDocumentSchema),
    remove: oc.input(z.object({ documentId: Id })).output(z.object({ ok: z.literal(true) })),
    exportMarkdown: oc.input(z.object({ botId: Id.optional() })).output(z.string()),
    providerConfig: oc.output(SpaceMemoryConfigSchema.nullable()),
    connectProvider: oc
      .input(
        z.object({
          provider: z.string().min(1),
          settings: z.record(z.string(), z.string()),
          credentials: z.record(z.string(), z.string()),
          defaultMemoryScope: MemoryScopeSchema.default("isolated"),
        }),
      )
      .output(SpaceMemoryConfigSchema),
    setDefaultScope: oc
      .input(z.object({ defaultMemoryScope: MemoryScopeSchema }))
      .output(SpaceMemoryConfigSchema),
    disconnectProvider: oc.output(z.object({ ok: z.literal(true) })),
  },
  routines: {
    listForMentions: oc
      .input(z.object({ botIds: z.array(Id).min(1).max(ROUTINE_MENTION_BATCH_MAX) }))
      .output(z.array(z.object({ botId: Id, routines: z.array(RoutineSchema) }))),
    list: oc.input(botId).output(z.array(RoutineSchema)),
    history: oc
      .input(
        z.object({
          routineId: Id,
          before: RoutineRunCursorSchema.optional(),
          limit: z.number().int().min(1).max(ROUTINE_HISTORY_PAGE_SIZE).optional(),
        }),
      )
      .output(RoutineHistorySchema),
    create: oc.input(CreateRoutineInput).output(RoutineSchema),
    update: oc
      .input(
        z
          .object({
            routineId: Id,
            name: z.string().optional(),
            prompt: z.string().optional(),
            crons: z.array(z.string().min(1)).optional(),
            timezone: TimeZoneSchema.optional(),
            active: z.boolean().optional(),
            notify: z.boolean().optional(),
            webhookEnabled: z.boolean().optional(),
            githubEnabled: z.boolean().optional(),
            messageProvider: z
              .string()
              .min(1)
              .max(50)
              .regex(/^[a-z0-9._-]+$/i)
              .nullable()
              .optional(),
            /** Null clears the routine's own model and runs it on the bot's. */
            modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
            modelId: z.string().trim().min(1).max(200).nullable().optional(),
            thinkingLevel: ThinkingLevelSchema.nullable().optional(),
            /** ISO datetime to arm a never-run one-shot. */
            runAt: IsoDate.optional(),
            /** Null removes the change trigger. */
            watch: RoutineWatchSchema.nullable().optional(),
          })
          .superRefine((value, ctx) => {
            if (
              value.crons &&
              value.crons.length === 0 &&
              value.webhookEnabled === false &&
              value.githubEnabled === false &&
              value.messageProvider === null &&
              value.watch === null
            ) {
              ctx.addIssue({
                code: "custom",
                message: "Add a schedule, webhook, GitHub, message, or change trigger",
                path: ["crons"],
              });
            }
          }),
      )
      .output(RoutineSchema),
    remove: oc.input(z.object({ routineId: Id })).output(z.object({ ok: z.literal(true) })),
    testRun: oc
      .input(
        z.object({
          routineId: Id,
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ runId: Id })),
  },
  scratchpad: {
    list: oc
      .input(
        z.object({
          botId: Id,
          status: ScratchpadItemStatusSchema.optional(),
          includeDone: z.boolean().optional(),
        }),
      )
      .output(z.array(ScratchpadItemSchema)),
    create: oc.input(CreateScratchpadItemInput).output(ScratchpadItemSchema),
    update: oc
      .input(
        z.object({
          itemId: Id,
          title: z.string().min(1).max(200).optional(),
          status: ScratchpadItemStatusSchema.optional(),
          notes: z.string().max(4_000).optional(),
        }),
      )
      .output(ScratchpadItemSchema),
    remove: oc.input(z.object({ itemId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /**
   * Outlook drafts an assistant made in its person's own chat. Only that person reads or edits
   * them, and only their own Send sends one; a bot has no route to sending.
   */
  emailDrafts: {
    get: oc.input(z.object({ id: Id })).output(EmailDraftSchema),
    update: oc.input(EmailDraftEditSchema).output(EmailDraftSchema),
    /** Sends exactly the version the person last saw; a draft sends at most once. */
    send: oc
      .input(z.object({ id: Id, version: z.number().int().positive() }))
      .output(EmailDraftSchema),
    discard: oc.input(z.object({ id: Id })).output(EmailDraftSchema),
    /** Files in the draft's chat that can be attached. */
    files: oc.input(z.object({ id: Id })).output(z.array(EmailDraftAttachmentSchema)),
    signature: {
      get: oc.input(z.object({})).output(EmailSignatureSchema),
      set: oc.input(EmailSignatureSchema).output(EmailSignatureSchema),
    },
  },
  todos: {
    list: oc
      .input(z.object({ includeArchived: z.boolean().optional() }))
      .output(z.array(TodoItemSchema)),
    create: oc.input(CreateTodoItemInput).output(TodoItemSchema),
    update: oc.input(UpdateTodoItemInput).output(TodoItemSchema),
    move: oc.input(MoveTodoItemInput).output(TodoItemSchema),
    archive: oc.input(z.object({ itemId: Id })).output(TodoItemSchema),
    restore: oc.input(z.object({ itemId: Id })).output(TodoItemSchema),
    remove: oc.input(z.object({ itemId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  boards: {
    list: oc.output(z.array(BoardSchema)),
    get: oc.output(BoardSchema),
    rename: oc.input(RenameBoardInput).output(BoardSchema),
    subscribe: oc.output(eventIterator(BoardEventSchema)),
  },
  tickets: {
    list: oc.input(ListTicketsInput).output(ListTicketsOutput),
    get: oc.input(GetTicketInput).output(TicketSchema),
    create: oc.input(CreateTicketInput).output(TicketSchema),
    update: oc.input(UpdateTicketInput).output(TicketSchema),
    move: oc.input(MoveTicketInput).output(TicketSchema),
    comment: oc.input(CommentTicketInput).output(TicketCommentSchema),
    comments: oc.input(z.object({ ticketId: Id })).output(z.array(TicketCommentSchema)),
  },
  skills: {
    list: oc.input(botId).output(z.array(TaughtSkillSchema)),
    get: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    start: oc
      .input(z.object({ botId: Id, goal: z.string().min(1).max(4000) }))
      .output(TaughtSkillSchema),
    appendEvent: oc
      .input(z.object({ skillId: Id, event: TeachRecordingEventSchema }))
      .output(TaughtSkillSchema),
    snapshot: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    stop: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    updateDraft: oc
      .input(
        z.object({
          skillId: Id,
          name: z.string().optional(),
          playbook: SkillPlaybookSchema,
        }),
      )
      .output(TaughtSkillSchema),
    save: oc
      .input(z.object({ skillId: Id, name: z.string().optional() }))
      .output(TaughtSkillSchema),
    testRun: oc
      .input(z.object({ skillId: Id, prompt: z.string().optional() }))
      .output(z.object({ runId: Id })),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /** Claude Agent Skills (SKILL.md recipes) shared across assistants (not taught/demo skills). */
  agentSkills: {
    list: oc.output(z.array(AgentSkillCatalogEntrySchema)),
    get: oc
      .input(
        z
          .object({ skillId: Id.optional(), name: z.string().min(1).max(80).optional() })
          .superRefine((input, ctx) => {
            if (!input.skillId && !input.name?.trim()) {
              ctx.addIssue({
                code: "custom",
                message: "Provide skillId or name",
                path: ["skillId"],
              });
            }
          }),
      )
      .output(AgentSkillSchema),
    create: oc.input(CreateAgentSkillInput).output(AgentSkillSchema),
    update: oc.input(UpdateAgentSkillInput).output(AgentSkillSchema),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  availability: {
    set: oc
      .input(z.object({ kind: AvailabilityKindSchema, id: Id }).and(SpaceAvailabilitySchema))
      .output(SpaceAvailabilitySchema),
    /** The user's own skills, MCP servers, plugins and tool sources across their spaces. */
    items: oc.output(z.array(AccountItemSchema)),
    /** Make exactly the listed items available in a space, keeping each one's other spaces. */
    chooseForSpace: oc
      .input(
        z.object({
          spaceId: Id,
          items: z.array(z.object({ kind: AvailabilityKindSchema, id: Id })).max(500),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  marketplace: {
    catalog: oc
      .input(
        z.object({
          query: z.string().trim().max(200).default(""),
          /** Admins see the list as staff do; staff always get it filtered. */
          staffView: z.boolean().default(false),
        }),
      )
      .output(PluginMarketplaceCatalogSchema),
    /** Admins only. */
    submissions: oc
      .input(z.object({ status: PluginSubmissionStatusSchema.default("pending") }))
      .output(z.array(PluginSubmissionSchema)),
    /** Admins only. */
    review: oc.input(PluginSubmissionReviewSchema).output(PluginSubmissionSchema),
  },
  capabilities: {
    list: oc.output(z.array(CapabilityInstallSchema)),
    catalogSearch: oc
      .input(
        z.object({
          query: z.string().trim().max(253).default(""),
          usePublicCatalog: z.boolean().default(false),
          /** Empty query lists the catalogue. A plain search still needs text. */
          browse: z.boolean().default(false),
          /** Company admin: return services that are still hidden. Admins only. */
          manage: z.boolean().default(false),
          offset: z.number().int().min(0).max(10_000).default(0),
          limit: z.number().int().min(1).max(100).default(8),
          kind: z.enum(["mcp", "openapi", "graphql", "cli"]).optional(),
        }),
      )
      .output(
        z.object({
          /** This person may see the catalogue. */
          enabled: z.boolean(),
          /** The deployment has a catalogue configured, whether or not this person may see it. */
          configured: z.boolean(),
          results: z.array(IntegrationCatalogResultSchema),
        }),
      ),
    install: oc
      .input(
        z.object({
          kind: z.enum(["skill", "plugin", "mcp", "api", "graphql"]),
          name: z.string().min(1).max(120),
          source: z.string().min(1).max(2048),
          config: z.record(z.string(), z.unknown()).default({}),
          credential: z.string().max(16_384).optional(),
          /** Required for plugins: confirms the exact previewed package content. */
          pluginDigest: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/)
            .optional(),
          /** Plugins only: which parts to add; all supported parts when omitted. */
          pluginParts: z.array(PluginPartSchema).min(1).max(2).optional(),
        }),
      )
      .output(CapabilityInstallSchema),
    /** Add or remove parts of an installed plugin at its pinned version; no parts removes it. */
    pluginParts: oc
      .input(z.object({ id: Id, parts: z.array(PluginPartSchema).max(2) }))
      .output(z.object({ install: CapabilityInstallSchema.nullable() })),
    /** Fetch and parse a plugin repo without installing: shows the skills,
     * MCP endpoints, variables, and skipped parts before confirmation. */
    pluginPreview: oc
      .input(z.object({ source: z.string().min(1).max(2048) }))
      .output(PluginPreviewSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  mcp: {
    servers: {
      list: oc.output(z.array(McpServerSchema)),
      create: oc.input(McpServerConfigInput).output(McpServerSchema),
      update: oc
        .input(
          z.union([
            z.object({ id: Id, config: McpServerConfigInput }),
            z.object({ id: Id, secret: z.string().min(1).max(16384) }),
          ]),
        )
        .output(McpServerSchema),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
      /** Launch the server once (installing a stdio package if needed), list its tools, close it. */
      test: oc.input(z.object({ id: Id })).output(McpServerSchema),
      /** Which agents can use the server: all of them, or only `botIds`. */
      agents: oc
        .input(z.object({ id: Id, allBots: z.boolean(), botIds: z.array(Id).max(500).default([]) }))
        .output(z.object({ server: McpServerSchema, assignments: z.array(BotMcpServerSchema) })),
    },
    assignments: {
      list: oc.input(botId).output(z.array(BotMcpServerSchema)),
      all: oc.output(z.array(BotMcpServerSchema)),
      approve: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(BotMcpServerSchema),
      dismiss: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(z.object({ ok: z.literal(true) })),
      replace: oc
        .input(
          z.object({
            botId: Id,
            assignments: z.array(
              z.object({
                serverId: Id,
                allowAllTools: z.boolean().default(true),
                allowedTools: z.array(z.string().min(1).max(200)).max(500).default([]),
              }),
            ),
          }),
        )
        .output(z.array(BotMcpServerSchema)),
    },
    oauth: {
      begin: oc.input(z.object({ serverId: Id, redirectUri: z.string().url().optional() })).output(
        z.discriminatedUnion("status", [
          z.object({
            status: z.literal("authorization_required"),
            sessionId: Id,
            authorizationUrl: z.string().url(),
          }),
          z.object({
            status: z.enum(["already_connected", "authorization_not_requested"]),
          }),
        ]),
      ),
      complete: oc
        .input(z.object({ sessionId: Id, code: z.string().min(1), state: z.string().min(1) }))
        .output(z.object({ ok: z.literal(true) })),
      disconnect: oc.input(z.object({ serverId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  onboarding: {
    /** Record the optional signup survey; an empty submission marks it skipped. */
    signupSurvey: oc.input(SignupSurveySchema).output(z.object({ ok: z.literal(true) })),
    /** Seed the first-run greeting into the bot's thread (focus card is separate). */
    start: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Post the focus choice card when the thread is still idle. */
    promptFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Answer the focus choice; posts the app cards. Does not rename the bot. */
    choose: oc
      .input(z.object({ botId: Id, optionId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    /** Dismiss the unanswered focus card without choosing an option. */
    dismissFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Flip an app_connect card to connected after authorization completes. */
    appConnected: oc
      .input(
        z.object({
          botId: Id,
          threadId: Id.optional(),
          /** The card's own message, so it is found however far back it is. */
          messageId: Id.optional(),
          provider: z.string(),
          connectorId: z.string().default("composio"),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  integrationSetup: {
    get: oc.output(IntegrationSetupStateSchema),
    save: oc.input(IntegrationProviderConfigSchema).output(z.object({ ok: z.literal(true) })),
  },
  connections: {
    catalog: oc
      .input(z.object({ query: z.string().optional(), connectorId: z.string().optional() }))
      .output(z.array(ConnectionCatalogItemSchema)),
    /** Staff get enabled and coming-soon apps; admins get every app with its state. */
    companyApps: oc.output(z.array(CompanyAppSchema)),
    list: oc.output(z.array(ConnectionSchema)),
    begin: oc
      .input(
        z.object({
          connectorId: z.string().default("composio"),
          provider: z.string(),
          displayName: z.string(),
        }),
      )
      .output(z.object({ connectionId: Id, authorizationUrl: z.string().nullable() })),
    complete: oc
      .input(z.object({ connectionId: Id, code: z.string().optional() }))
      .output(ConnectionSchema),
    rename: oc
      .input(
        z.object({
          connectionId: Id,
          displayName: z.string().trim().min(1).max(CONNECTION_LABEL_MAX_LENGTH),
        }),
      )
      .output(ConnectionSchema),
    revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Tools the connected provider exposes. Read-only; no per-tool allowlist yet. */
    tools: oc.input(z.object({ connectorId: z.string(), provider: z.string() })).output(
      z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      ),
    ),
    /** The SharePoint folders a person lets assistants read, browsed as that person. */
    sharePoint: {
      folders: oc.input(z.object({ connectionId: Id })).output(z.array(SharePointFolderSchema)),
      browse: oc
        .input(z.object({ connectionId: Id, location: SharePointLocationSchema }))
        .output(z.array(SharePointBrowseEntrySchema)),
      setFolders: oc
        .input(
          z.object({
            connectionId: Id,
            folders: z
              .array(
                z.object({
                  driveId: z.string().trim().min(1).max(512),
                  itemId: z.string().trim().min(1).max(512),
                }),
              )
              .max(SHAREPOINT_FOLDER_LIMIT),
          }),
        )
        .output(z.array(SharePointFolderSchema)),
    },
  },
  /** External messaging surface: link state, group channels, agent connections. */
  messaging: {
    installations: {
      list: oc.output(MessagingInstallationsStatusSchema),
      /** Without a bot, the workspace answers as the first bot in the user's default space. */
      start: oc.input(z.object({ botId: Id.optional() })).output(z.object({ url: z.string() })),
      complete: oc
        .input(z.object({ state: z.string().max(64), code: z.string().max(4096) }))
        .output(z.object({ ok: z.literal(true) })),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    },
    status: oc.output(MessagingStatusSchema),
    link: {
      /** Issue a short-lived code the user sends to the line from a chat app. */
      start: oc
        .input(z.object({ botId: Id }))
        .output(z.object({ code: z.string(), expiresAt: z.string() })),
    },
    identities: {
      setBot: oc
        .input(z.object({ identityId: Id, botId: Id }))
        .output(MessagingLinkedIdentitySchema),
      unlink: oc.input(z.object({ identityId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    channels: {
      list: oc.output(z.array(MessagingChannelMembershipSchema)),
      // Addressed by membership, not channel: one user can have two linked
      // chat apps in the same group, and each answers for its own agent.
      respond: oc
        .input(z.object({ membershipId: Id, accept: z.boolean() }))
        .output(MessagingChannelMembershipSchema),
      leave: oc.input(z.object({ membershipId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    connections: {
      list: oc.output(z.array(MessagingAgentConnectionSchema)),
      respond: oc
        .input(z.object({ connectionId: Id, accept: z.boolean() }))
        .output(MessagingAgentConnectionSchema),
      revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  approvalRules: {
    list: oc.input(settingsScopeInput.optional()).output(z.array(ActionApprovalRuleSchema)),
    set: oc
      .input(
        settingsScopeInput.extend({
          effect: z.enum(["always_allow", "require_approval", "deny"]),
          matchKind: z.enum(["tool", "connector", "site"]),
          matchValue: z.string().trim().min(1),
        }),
      )
      .output(ActionApprovalRuleSchema),
    remove: oc
      .input(settingsScopeInput.extend({ id: Id }))
      .output(z.object({ ok: z.literal(true) })),
  },
  /**
   * Sites the signed-in user opens from chat links without the external-link prompt, in every
   * space. The server computes each site from a link; bot fetches never read this list.
   */
  trustedLinkSites: {
    list: oc.output(z.array(z.string())),
    trust: oc
      .input(z.object({ url: z.string().min(1).max(8192) }))
      .output(z.object({ site: z.string() })),
    remove: oc
      .input(z.object({ site: z.string().min(1).max(253) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  autoReview: {
    get: oc.input(settingsScopeInput.optional()).output(ActionAutoReviewSettingsSchema),
    set: oc
      .input(
        settingsScopeInput.extend({
          mode: ApprovalModeSchema.optional(),
          enabled: z.boolean().optional(),
          skipApprovals: z.boolean().optional(),
        }),
      )
      .output(ActionAutoReviewSettingsSchema),
  },
  /** Which account settings the bound Space overrides for the member. */
  spaceSettings: {
    overrides: oc.output(z.array(SpaceSettingSchema)),
    /** Customizing copies the account's settings into the Space; ending it drops the copy. */
    setOverride: oc
      .input(z.object({ setting: SpaceSettingSchema, enabled: z.boolean() }))
      .output(z.array(SpaceSettingSchema)),
  },
  artifacts: {
    list: oc.input(botId).output(z.array(ArtifactSchema)),
    listSpace: oc
      .input(
        z.object({
          botId: Id.optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(60).optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(ArtifactSchema.extend({ versionCount: z.number().int() })),
          nextCursor: z.string().nullable(),
        }),
      ),
    listVersions: oc.input(z.object({ familyId: Id })).output(z.array(ArtifactVersionSchema)),
    create: oc
      .input(
        threadTarget.and(
          z.object({
            name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
            description: z.string().max(ARTIFACT_DESCRIPTION_MAX_LENGTH).optional(),
            mimeType: z.string().min(1),
            contentBase64: z.string().min(1),
            /** Unique per upload; a retry with the same nonce returns the artifact it created. */
            clientNonce: z.string().min(1).max(200).optional(),
          }),
        ),
      )
      .output(ArtifactSchema),
    get: oc.input(threadTarget.and(z.object({ artifactId: Id }))).output(ArtifactWithContentSchema),
    getById: oc.input(z.object({ artifactId: Id })).output(ArtifactWithContentSchema),
    /** Name, type and size only — for deciding whether a preview needs the file bytes. */
    meta: oc.input(z.object({ artifactId: Id })).output(ArtifactSchema),
    /**
     * A one-time token for `GET /api/artifacts/download?token=`, which streams the file as a
     * normal download. Keeps large files (PowerPoint, video) off the chat UI thread.
     */
    downloadToken: oc
      .input(
        z
          .object({
            artifactId: Id,
            botId: Id.optional(),
            groupId: Id.optional(),
          })
          .superRefine((input, ctx) => {
            if (input.botId && input.groupId) {
              ctx.addIssue({
                code: "custom",
                message: "Provide at most one of botId or groupId",
                path: ["botId"],
              });
            }
          }),
      )
      .output(z.object({ token: z.string(), url: z.string() })),
    remove: oc.input(z.object({ artifactId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /** Pages bots built for the caller in this Space. */
  pages: {
    /** Pinned first, then most recently updated. */
    list: oc
      .input(
        z.strictObject({
          botId: Id.optional(),
          groupId: Id.optional(),
          cursor: z.string().max(500).optional(),
          limit: z.number().int().min(1).max(PAGE_LIST_MAX_LIMIT).optional(),
          /** Titles containing this text, for the command palette. */
          query: z.string().trim().min(1).max(200).optional(),
        }),
      )
      .output(
        z.strictObject({ items: z.array(PageSummarySchema), nextCursor: z.string().nullable() }),
      ),
    /** `link` also reads the page's share link, which only the share controls need. */
    get: oc
      .input(
        z.strictObject({
          pageId: Id,
          version: z.number().int().positive().optional(),
          link: z.boolean().optional(),
        }),
      )
      .output(PageDetailSchema),
    rename: oc
      .input(z.strictObject({ pageId: Id, title: PageTitleSchema }))
      .output(PageSummarySchema),
    /**
     * Turning the link on returns the page's live link, or a new one when it has none it can
     * read; turning it off breaks the old link, so the next turn-on issues a new one.
     */
    setVisibility: oc
      .input(
        z.strictObject({
          pageId: Id,
          visibility: PageVisibilitySchema,
          /** With "public", replaces the password so the old one stops working. */
          renewPassword: z.boolean().optional(),
        }),
      )
      .output(
        z.strictObject({
          visibility: PageVisibilitySchema,
          shareUrl: z.string().nullable(),
          sharePassword: z.string().nullable(),
        }),
      ),
    pin: oc.input(z.strictObject({ pageId: Id, pinned: z.boolean() })).output(PageSummarySchema),
    remove: oc.input(z.strictObject({ pageId: Id })).output(z.object({ ok: z.literal(true) })),
    /** What the page saved for itself with usePageState. */
    state: oc
      .input(z.strictObject({ pageId: Id }))
      .output(z.strictObject({ values: PageStateValuesSchema })),
    saveState: oc
      .input(z.strictObject({ pageId: Id, key: PageStateKeySchema, value: z.unknown() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  /** Apps: pages built from several files with their own tables of data. Owner only. */
  apps: {
    /** Every table with its rows, what the app saved for itself and the data revision. */
    data: oc.input(z.strictObject({ pageId: Id })).output(AppDataSchema),
    /** Polled by open copies: fetch data again when it moves. */
    revision: oc
      .input(z.strictObject({ pageId: Id }))
      .output(z.object({ revision: z.number().int(), version: z.number().int() })),
    /** Draws the app's OCSC icon again with gpt-image-2, optionally of a chosen object. */
    redrawIcon: oc
      .input(z.strictObject({ pageId: Id, subject: z.string().trim().max(300).optional() }))
      .output(z.object({ icon: z.string() })),
    insertRow: oc
      .input(z.strictObject({ pageId: Id, table: AppTableNameSchema, row: AppRowValuesSchema }))
      .output(z.object({ row: AppRowSchema, revision: z.number().int() })),
    updateRow: oc
      .input(
        z.strictObject({
          pageId: Id,
          table: AppTableNameSchema,
          id: AppRowIdSchema,
          patch: AppRowValuesSchema,
        }),
      )
      .output(z.object({ row: AppRowSchema, revision: z.number().int() })),
    removeRow: oc
      .input(z.strictObject({ pageId: Id, table: AppTableNameSchema, id: AppRowIdSchema }))
      .output(z.object({ revision: z.number().int() })),
    /** Defines or changes a table (from the Studio's data grid), optionally replacing its rows. */
    defineTable: oc
      .input(
        z.strictObject({
          pageId: Id,
          schema: AppTableSchemaSchema,
          rows: z.array(AppRowValuesSchema).max(20_000).optional(),
        }),
      )
      .output(z.object({ table: z.string(), rows: z.number().int(), revision: z.number().int() })),
    dropTable: oc
      .input(z.strictObject({ pageId: Id, table: AppTableNameSchema }))
      .output(z.object({ revision: z.number().int() })),
    files: oc
      .input(z.strictObject({ pageId: Id, version: z.number().int().positive().optional() }))
      .output(z.object({ files: AppFilesSchema, version: z.number().int() })),
    /** Builds the files and saves them as a new version when they build; problems otherwise. */
    saveFiles: oc
      .input(
        z.strictObject({
          pageId: Id,
          files: AppFilesSchema,
          baseVersion: z.number().int().positive(),
        }),
      )
      .output(
        z.object({
          version: z.number().int().nullable(),
          problems: z.array(AppBuildProblemSchema),
        }),
      ),
    /** The current files (or the given ones) built for the Studio, with elements tagged by source line. */
    preview: oc
      .input(
        z.strictObject({
          pageId: Id,
          files: AppFilesSchema.optional(),
          version: z.number().int().positive().optional(),
        }),
      )
      .output(z.object({ html: z.string().nullable(), problems: z.array(AppBuildProblemSchema) })),
    versions: oc.input(z.strictObject({ pageId: Id })).output(z.array(AppVersionSchema)),
    /** Makes an earlier version current again, as a new version. */
    restore: oc
      .input(z.strictObject({ pageId: Id, version: z.number().int().positive() }))
      .output(z.object({ version: z.number().int() })),
    /** Recent changes to the app's data, newest first, each with whether it can be undone. */
    changes: oc.input(z.strictObject({ pageId: Id })).output(z.array(AppDataChangeSchema)),
    /** Undoes one data change, or with redo applies an undone one again, keeping their order. */
    undoChange: oc
      .input(z.strictObject({ pageId: Id, changeId: Id, redo: z.boolean().optional() }))
      .output(z.object({ revision: z.number().int() })),
    setDataAccess: oc
      .input(z.strictObject({ pageId: Id, access: AppDataAccessSchema }))
      .output(z.object({ access: AppDataAccessSchema })),
    workspaces: oc.input(z.strictObject({ pageId: Id })).output(AppWorkspaceSettingsSchema),
    setWorkspaces: oc.input(AppWorkspaceSettingsInputSchema.extend({ pageId: Id }).strict()).output(
      z.object({
        label: z.string().nullable(),
        create: z.enum(["anyone", "owner"]),
        filed: z.number().int(),
        unfiled: z.number().int(),
      }),
    ),
    assets: oc.input(z.strictObject({ pageId: Id })).output(z.array(AppAssetSchema)),
    asset: oc
      .input(z.strictObject({ pageId: Id, assetId: Id }))
      .output(z.object({ mime: z.string(), base64: z.string() })),
    addAsset: oc
      .input(
        z.strictObject({
          pageId: Id,
          name: z.string().min(1).max(200),
          mime: z.string().max(60),
          base64: z.string().max(9_000_000),
        }),
      )
      .output(AppAssetSchema),
    removeAsset: oc
      .input(z.strictObject({ pageId: Id, assetId: Id }))
      .output(z.object({ ok: z.literal(true) })),
    /** A table as a spreadsheet file. */
    export: oc
      .input(
        z.strictObject({ pageId: Id, table: AppTableNameSchema, format: z.enum(["xlsx", "csv"]) }),
      )
      .output(z.object({ filename: z.string(), mime: z.string(), base64: z.string() })),
    /** A newer copy of the workbook read into this app, matching rows by each table's key. */
    reimportWorkbook: oc
      .input(
        z.strictObject({
          pageId: Id,
          fileName: z.string().min(1).max(200),
          base64: z.string().max(14_000_000),
        }),
      )
      .output(z.object({ report: z.array(z.string()), revision: z.number().int() })),
    /** Whether this app can go to Evolve, and the plugin it was last published as. */
    evolvePublication: oc.input(z.strictObject({ pageId: Id })).output(
      z.object({
        available: z.boolean(),
        slug: z.string().nullable(),
        release: z.number().int(),
        /** The staff brief, and the AI review with the app version it was written for. */
        brief: z.string().nullable(),
        dossier: z.string().nullable(),
        dossierVersion: z.number().int().nullable(),
        currentVersion: z.number().int(),
      }),
    ),
    /** Changes the app's staff brief; an empty brief clears it. */
    saveBrief: oc
      .input(z.strictObject({ pageId: Id, brief: z.string().trim().max(2000) }))
      .output(z.object({ brief: z.string().nullable() })),
    /** Writes the AI review of the app's current version again. */
    writeDossier: oc
      .input(z.strictObject({ pageId: Id }))
      .output(z.object({ dossier: z.string(), dossierVersion: z.number().int() })),
    /**
     * Sends the app to Evolve as a staff plugin, a draft or for review; once Evolve publishes it,
     * it opens from Evolve's menu with this app's data.
     */
    publishToEvolve: oc
      .input(
        z.strictObject({
          pageId: Id,
          slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
          submitForReview: z.boolean(),
          purpose: z.string().trim().max(2000).optional(),
        }),
      )
      .output(
        z.object({
          slug: z.string(),
          version: z.string(),
          status: z.string(),
          checks: z
            .array(z.object({ label: z.string(), ok: z.boolean(), detail: z.string().optional() }))
            .optional(),
          previewUrl: z.string().optional(),
          myPluginsUrl: z.string().optional(),
          /** How many colleagues Evolve asked to peer review it. */
          peerReviewers: z.number().int().optional(),
        }),
      ),
    /** An app's `ai.ask`, answered on the company model for the signed-in owner. */
    ask: oc
      .input(
        z.strictObject({
          pageId: Id,
          prompt: z.string().min(1).max(8000),
          json: z.boolean().optional(),
        }),
      )
      .output(z.object({ answer: z.unknown() })),
    /** A new app made from a workbook: a table per sheet and screens built from them. */
    importWorkbook: oc
      .input(
        z.strictObject({
          title: z.string().trim().min(1).max(200).optional(),
          fileName: z.string().min(1).max(200),
          base64: z.string().max(14_000_000),
          botId: Id.optional(),
          groupId: Id.optional(),
        }),
      )
      .output(z.object({ pageId: Id, report: z.array(z.string()) })),
    /** A new app from one of the App Studio's starters, with its tables and no rows. */
    createFromTemplate: oc
      .input(
        z.strictObject({
          templateId: z.string().min(1).max(60),
          title: z.string().trim().min(1).max(200).optional(),
          botId: Id.optional(),
          groupId: Id.optional(),
        }),
      )
      .output(z.object({ pageId: Id })),
  },
  usage: {
    list: oc.output(z.array(UsageRecordSchema)),
    summary: oc.output(UsageSummarySchema),
  },
  export: {
    bot: oc.input(botId).output(ExportManifestSchema),
    /**
     * A one-time token for `GET /api/account/export?token=`, which streams the account zip. Needs
     * a recent identity confirmation on this session (IDENTITY_CONFIRMATION_REQUIRED).
     */
    accountToken: oc.output(z.object({ token: z.string() })),
  },
  notifications: {
    /** Run alerts for the signed-in user's chats in this space, live while connected. */
    subscribe: oc.output(
      eventIterator(
        z.object({
          type: z.enum(["alert", "heartbeat"]),
          alert: ChatAlertSchema.optional(),
        }),
      ),
    ),
    subscribeCalls: oc.output(
      eventIterator(
        z.object({
          type: z.enum(["incoming.calls", "heartbeat"]),
          payload: z.object({ calls: z.array(IncomingBotCallSchema) }).optional(),
        }),
      ),
    ),
    declineIncomingCall: oc
      .input(z.object({ callId: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    registerCallPush: oc
      .input(
        z
          .object({
            deviceId: z.string().uuid(),
            platform: z.enum(["ios", "android"]),
            expoToken: z.string().min(8).max(512).regex(/^\S+$/).optional(),
            voipToken: z
              .string()
              .regex(/^[a-fA-F0-9]{64,200}$/)
              .optional(),
          })
          .refine((value) =>
            Boolean(value.expoToken || (value.platform === "ios" && value.voipToken)),
          ),
      )
      .output(z.object({ ok: z.literal(true) })),
    registerPush: oc
      // No whitespace: the token store keeps the registering session on the next line.
      .input(
        z.object({
          token: z.string().min(8).max(512).regex(/^\S+$/),
          presentation: z.literal("android_sender").optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    unregisterPush: oc.output(z.object({ ok: z.literal(true) })),
  },
  search: {
    query: oc.input(z.object({ q: z.string().max(200) })).output(SearchQueryOutputSchema),
  },
  links: {
    /**
     * The site icon for a link's origin as a small data URL, resolved and cached by the server.
     * `retry` means the server was too busy to look; the origin may still have an icon.
     */
    favicon: oc
      // The longest origin: a scheme, a 253-character host name and a port.
      .input(z.object({ origin: z.string().max("https://".length + 253 + ":65535".length) }))
      .output(z.object({ icon: z.string().nullable(), retry: z.boolean().optional() })),
  },
  runs: {
    list: oc.input(z.object({ filter: z.enum(["active", "recent"]) })).output(RunsListOutputSchema),
  },
  /** The signed-in user's wallet; absent when the deployment offers none. */
  paymentWallet: {
    status: oc.output(PaymentWalletStatusSchema),
    /** Starts a sign-in the user finishes with the provider; `status` then reports it. */
    connect: oc.output(PaymentWalletStatusSchema),
    disconnect: oc.output(PaymentWalletStatusSchema),
  },
  voice: {
    catalog: oc.output(z.array(VoiceCatalogEntrySchema)),
    status: oc.input(settingsScopeInput.optional()).output(VoiceStatusSchema),
    credentials: oc.input(settingsScopeInput.optional()).output(z.array(VoiceCredentialSchema)),
    connect: oc
      .input(
        z
          .object({
            provider: z.string(),
            /** Optional for a self-hosted server and for providers without keys. */
            apiKey: z.string().max(4096).default(""),
            voiceId: z.string().max(120).optional(),
            speechModel: z.string().max(64).optional(),
            /** Self-hosted (OpenAI-compatible) server address and model ids. */
            baseUrl: z.string().max(2048).optional(),
            ttsModel: z.string().max(200).optional(),
            sttModel: z.string().max(200).optional(),
            /** Where the connection becomes the default voice. */
            scope: SettingsScopeSchema.optional(),
          })
          .superRefine((input, ctx) => {
            // Hosted keys are checked by the server, which knows which providers are keyless.
            if (input.provider === OPENAI_COMPATIBLE_PROVIDER_ID && !input.baseUrl?.trim()) {
              ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "Enter a server URL." });
            }
          }),
      )
      .output(VoiceCredentialSchema),
    disconnect: oc
      .input(z.object({ provider: z.string().min(1) }))
      .output(z.object({ ok: z.literal(true) })),
    setVoice: oc
      .input(
        settingsScopeInput.extend({
          voiceId: z.string().min(1).max(120),
          provider: z.string().optional(),
        }),
      )
      .output(VoiceStatusSchema),
    setSpeechModel: oc
      .input(
        settingsScopeInput.extend({
          provider: z.string().min(1),
          speechModel: z.string().max(64),
        }),
      )
      .output(VoiceCredentialSchema),
    voices: oc
      .input(settingsScopeInput.extend({ provider: z.string().optional() }))
      .output(z.array(VoiceInfoSchema)),
    prepare: oc
      .input(
        z.object({
          text: z.string().max(20000),
          voiceId: z.string().max(120).optional(),
          botId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(z.object({ ready: z.boolean(), utterances: z.array(z.string()) })),
  },
  externalConversations: {
    updatePolicy: oc
      .input(UpdateExternalConversationPolicyInput)
      .output(ExternalConversationPolicySchema),
  },
  agentSecrets: {
    list: oc.output(z.array(AgentSecretSchema)),
    put: oc.input(AgentSecretInputSchema).output(AgentSecretSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  vault: {
    list: oc.input(settingsScopeInput.optional()).output(z.array(BotSecretMetadata)),
    put: oc.input(VaultPutInput).output(BotSecretMetadata),
    /** Needs a recent identity confirmation on this session (IDENTITY_CONFIRMATION_REQUIRED). */
    reveal: oc.input(VaultRevealInput).output(VaultRevealed),
    remove: oc
      .input(settingsScopeInput.extend({ name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
    /** What the company vault holds, without values, so people know what their assistants can use. */
    company: oc.output(z.array(CompanyVaultItemSchema)),
  },
  /** The vault this Space uses, for apps that predate it. The bot only checks access. */
  botSecrets: {
    list: oc.input(z.object({ botId: Id })).output(z.array(BotSecretMetadata)),
    put: oc.input(BotSecretPutInput).output(BotSecretMetadata),
    remove: oc
      .input(z.object({ botId: Id, name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
  },
};

export type AppContract = typeof appContract;

type ProcedurePaths<Router, Prefix extends string = ""> = {
  [Key in keyof Router & string]: Router[Key] extends AnyContractProcedure
    ? `${Prefix}${Key}`
    : ProcedurePaths<Router[Key], `${Prefix}${Key}/`>;
}[keyof Router & string];

type AtPath<Tree, Path extends string> = Path extends `${infer Head}/${infer Rest}`
  ? Head extends keyof Tree
    ? AtPath<Tree[Head], Rest>
    : never
  : Path extends keyof Tree
    ? Tree[Path]
    : never;

/** A procedure's URL path under `/rpc/`, such as `bots/list`. */
export type RpcPath = ProcedurePaths<AppContract>;
type RpcInputs = { [Path in RpcPath]: AtPath<InferContractRouterInputs<AppContract>, Path> };
type RpcOutputs = { [Path in RpcPath]: AtPath<InferContractRouterOutputs<AppContract>, Path> };
export type RpcInput<Path extends RpcPath> = RpcInputs[Path];
export type RpcOutput<Path extends RpcPath> = RpcOutputs[Path];
