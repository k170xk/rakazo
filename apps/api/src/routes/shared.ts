import {
  companyFeatureOpenTo,
  companyFeatures,
  companyFeaturesFor,
  companyModel,
  deploymentModelRole,
  effectiveComputerAccess,
  findConnectedModelCredential,
  hasHostedModelCredits,
  hostCredentialSource,
  mcpStdioAvailable,
  resolveMemberMainModel,
  selectConfiguredModel,
} from "@rakazo/adapters";
import type { Actor, Me } from "@rakazo/contracts";
import {
  attachmentMaxBytes,
  attachmentMaxCount,
  canonicalPiProviderId,
  ModelAccessSchema,
  resolveBotAvatarSet,
} from "@rakazo/contracts";
import { provenEmail } from "@rakazo/core";
import { isAdmin } from "../admins.js";
import { effectiveSandboxProvider } from "../computer-provider-config.js";
import { syncEvolvePhoto } from "../evolve-photo.js";
import type { RouterDeps } from "../router.js";

export { createAdapterContext as computerContext } from "@rakazo/adapter-kit";

function hostCredentials(active: boolean, provider: string) {
  return active
    ? { hostCredentialProvider: provider, hostCredentialSource: hostCredentialSource(provider) }
    : { hostCredentialProvider: null, hostCredentialSource: null };
}

export async function meDto(deps: RouterDeps, actor: Actor): Promise<Me> {
  const [user, setup, admin] = await Promise.all([
    deps.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: {
        email: true,
        emailVerified: true,
        name: true,
        image: true,
        timezone: true,
        locale: true,
        botAvatarSet: true,
        computerAccess: true,
        modelAccess: true,
        allowedModels: true,
        signupSurvey: { select: { userId: true } },
      },
    }),
    modelSetup(deps, actor),
    isAdmin(deps, actor.userId),
  ]);
  const evolveEmail = provenEmail(user);
  if (evolveEmail)
    void syncEvolvePhoto(deps, { id: actor.userId, email: evolveEmail, image: user.image });
  // Where the deployment runs computers once an admin's choice in Settings applies.
  // The app treats "none" as computers being unavailable, which is what the company switch
  // means, and so is a person without full access: their bots' computers only run OCSC tools.
  const computerAccess = effectiveComputerAccess(user.computerAccess);
  const sandboxProvider =
    computerAccess === "full"
      ? effectiveSandboxProvider(setup.settings, deps.env.sandboxProvider)
      : "none";
  const voiceOn = companyFeatures().voice;
  const phoneCallsEnabled = deps.env.phoneCallsEnabled === true && voiceOn;
  // Composer mic: company voice (calls/STT) OR Evolve Whisper via plugins. Do not require
  // companyFeatures.voice for the Evolve path — that switch is the company voice connection,
  // and OCSC keeps it off while still wanting dictation through Evolve's OpenAI key.
  const dictationEnabled = phoneCallsEnabled || Boolean(deps.evolvePlugins);
  // The app reads model choice from features, so it reports this person's own access.
  const modelAccess = ModelAccessSchema.safeParse(user.modelAccess);
  return {
    features: {
      ...companyFeaturesFor(actor.userId, admin),
      // The app's MCP menus follow the switch's chosen people and groups, for admins too.
      mcpServers: companyFeatureOpenTo("mcpServers", actor.userId),
      memberModels: modelAccess.success
        ? modelAccess.data === "choose"
        : companyFeatures().memberModels,
    },
    allowedModels: user.allowedModels,
    companyModelReady: Boolean(companyModel()),
    computerAccess,
    ticketBoardEnabled: deps.env.ticketBoardEnabled === true,
    phoneCallsEnabled,
    dictationEnabled,
    navLinks: deps.env.navLinks ?? [],
    maxUploadSizeBytes: attachmentMaxBytes(deps.env),
    maxAttachmentsPerMessage: attachmentMaxCount(deps.env),
    userId: actor.userId,
    email: user.email,
    name: user.name,
    spaceId: actor.spaceId,
    isDeploymentOwner: false,
    isAdmin: admin,
    needsModel: setup.needsModel,
    defaultProvider: canonicalPiProviderId(setup.model?.provider ?? deps.env.defaultProvider),
    defaultModel: setup.model?.modelId ?? deps.env.defaultModel,
    // Set only while the active default is the deployment's own, running on host credentials.
    ...hostCredentials(
      !setup.main &&
        !setup.settings?.defaultModelProvider &&
        Boolean(deps.env.deploymentModelHostCredentials),
      deps.env.defaultProvider,
    ),
    computerHost: computerHostFor(setup.settings?.computerHost, sandboxProvider),
    canChooseHostComputer:
      Boolean(deps.env.desktopHostChoiceEnabled) && sandboxProvider === "docker",
    // The deployment's provider: an account's own choice covers only its Team Computers.
    sandboxProvider,
    mcpStdioEnabled:
      admin &&
      mcpStdioAvailable({
        stdioEnabled: deps.env.mcpStdioEnabled,
        allowedCommands: deps.env.mcpStdioAllowedCommands,
      }),
    avatarStyle: "organic",
    botAvatarSet: resolveBotAvatarSet(user.botAvatarSet),
    timezone: user.timezone ?? null,
    locale: user.locale ?? null,
    billingEnabled: Boolean(deps.billing),
    // Only billing deployments ask; self-hosted installs never see the survey.
    needsSignupSurvey: Boolean(deps.billing) && !user.signupSurvey,
    paymentWalletProvider: deps.paymentWallet
      ? { id: deps.paymentWallet.describe().id, name: deps.paymentWallet.displayName }
      : null,
  };
}

function computerHostFor(
  stored: string | null | undefined,
  sandboxProvider: string,
): "docker" | "this-mac" | null {
  if (sandboxProvider === "desktop") return "this-mac";
  if (sandboxProvider !== "docker") return null;
  if (stored === "this-mac" || stored === "docker") return stored;
  return null;
}

/** The main model chat runs: the member's while it can run, else the deployment's. */
export async function modelSetup(deps: RouterDeps, actor: Actor) {
  const [member, settings] = await Promise.all([
    resolveMemberMainModel({ prisma: deps.prisma, secretStore: deps.secrets }, actor),
    deps.prisma.deploymentSettings.findUnique({ where: { id: "default" } }),
  ]);
  const main =
    member &&
    (member.credential ||
      (deps.billing?.modelCreditsEnabled &&
        (await hasHostedModelCredits(deps.prisma, actor, member.provider))))
      ? member
      : null;
  const funding = deps.billing ? await deps.billing.status(actor) : null;
  // A balance keeps paying for the deployment model after switching to an own key.
  const creditsAvailable = funding?.funding === "credits" || (funding?.balanceUsd ?? 0) > 0;
  const hasDeployment =
    Boolean(deps.env.deploymentModelConfigured) &&
    (!funding?.creditPurchasesEnabled || creditsAvailable);
  return {
    main,
    model:
      main ??
      deploymentModelRole("main", {
        settings,
        deployment: { provider: deps.env.defaultProvider, model: deps.env.defaultModel },
      }).primary,
    settings,
    funding,
    creditsAvailable,
    hasDeployment,
    needsModel: deps.env.agentRuntime !== "scripted" && !main && !hasDeployment,
  };
}

/** Whether every bot runs its own model on one of the member's connections, as a run selects it. */
export async function botsRunOwnModels(deps: RouterDeps, actor: Actor, botIds: string[]) {
  const bots = await deps.prisma.bot.findMany({
    where: { id: { in: botIds }, userId: actor.userId, spaceId: actor.spaceId },
    select: { modelProvider: true, modelId: true, thinkingLevel: true },
  });
  const credentials = await Promise.all(
    bots.map(async (bot) => {
      const overrideCredential = bot.modelProvider
        ? await findConnectedModelCredential(
            deps.prisma,
            deps.secrets,
            actor,
            bot.modelProvider,
            bot.modelId,
          )
        : null;
      return selectConfiguredModel({ override: bot, overrideCredential, main: null, defaults: {} })
        .credential;
    }),
  );
  return credentials.every(Boolean);
}

export const THREAD_MESSAGE_PAGE_SIZE = 100;

/** Silence longer than this on a thread stream is indistinguishable from a dead socket. */
export const HEARTBEAT_MS = 20_000;

/** A thread stream re-checks its session at least this often while it delivers. */
export const SESSION_RECHECK_MS = 10_000;

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isRecordNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2025");
}
