import { ORPCError } from "@orpc/server";
import type {
  FilingGraph,
  FolderNode,
  StoredFilingBatch,
  StoredFilingItem,
} from "@rakazo/adapters";
import {
  batchStatus,
  blockedFolderIds,
  companyEmailFilingPolicy,
  createFilingGraph,
  ensureChildFolder,
  fileableFolders,
  folderForJob,
  folderJobKey,
  jobKeyOf,
  learnRule,
  listEvolveReferenceProjects,
  listMailFolders,
  loadFilingProfile,
  moveOutlookMessage,
  OutlookFilingError,
  presentFilingBatch,
  projectFolderName,
  publicRule,
  readMessageState,
  resolveEvolveJob,
  storedFilingBatch,
  updateFilingProfile,
  wellKnownFolderIds,
} from "@rakazo/adapters";
import type {
  Actor,
  EmailFilingBatch,
  EmailFilingProfile,
  EmailFilingSettings,
} from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { IsolationError, recordAuditEvent, runAsTenant } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { companyFeatureOnFor, requireCompanyFeature } from "../company-admin.js";
import { actorEmail } from "./bots.js";
import type { RouterContext } from "./context.js";

type BatchRow = {
  id: string;
  threadId: string;
  content: Prisma.JsonValue;
  version: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const MOVE_CONCURRENCY = 4;
const STUCK_FILING_MS = 5 * 60_000;
const INTERRUPTED =
  "Filing was interrupted. Check the email in Outlook; pressing File again only moves it if it is still where it was.";
const CHANGED = "This filing card changed elsewhere. Reload it and try again.";

const own = (actor: Actor) => ({ spaceId: actor.spaceId, userId: actor.userId });

async function eachLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Each person's Outlook filing cards. Runs only propose; these routes, called by the person's own
 * press of File, Skip or Undo, are the only place mail moves or folders are created.
 */
export function emailFilingRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;

  const load = async (actor: Actor, id: string): Promise<BatchRow> => {
    const row = await runAsTenant(own(actor), () =>
      deps.prisma.emailFilingBatch.findFirst({
        where: { id, spaceId: actor.spaceId, userId: actor.userId },
      }),
    );
    if (!row) throw new IsolationError();
    return row;
  };

  /** Writes the card only if nobody changed it since `row` was read. */
  const save = (actor: Actor, row: BatchRow, content: StoredFilingBatch) =>
    runAsTenant(own(actor), async () => {
      const { count } = await deps.prisma.emailFilingBatch.updateMany({
        where: { id: row.id, userId: actor.userId, version: row.version },
        data: {
          content: content as Prisma.InputJsonValue,
          status: batchStatus(content.items),
          version: { increment: 1 },
        },
      });
      return count === 1;
    });

  /** Replaces the given items in the latest card, retrying if another change raced this one. */
  const merge = async (actor: Actor, id: string, items: readonly StoredFilingItem[]) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await load(actor, id);
      const content = storedFilingBatch(row.content);
      const next = {
        ...content,
        items: content.items.map((item) => byId.get(item.id) ?? item),
      };
      if (await save(actor, row, next)) return;
    }
    throw new ORPCError("CONFLICT", { message: CHANGED });
  };

  const stale = (row: BatchRow) => Date.now() - row.updatedAt.getTime() > STUCK_FILING_MS;

  const cannotFile = async (actor: Actor): Promise<string | null> => {
    if (!(await companyFeatureOnFor(deps, actor, "outlookFiling"))) {
      return "Outlook email filing is not turned on for you.";
    }
    if (!deps.microsoft) return "Outlook is not set up here.";
    const account = await deps.microsoft.outlookAccount(own(actor)).catch(() => null);
    return account ? null : "Connect Outlook in Connectors to file these emails.";
  };

  const present = async (actor: Actor, row: BatchRow): Promise<EmailFilingBatch> => {
    const content = storedFilingBatch(row.content);
    const shown = stale(row)
      ? {
          ...content,
          items: content.items.map((item) =>
            item.status === "filing"
              ? { ...item, status: "failed" as const, error: INTERRUPTED }
              : item,
          ),
        }
      : content;
    const expired = row.expiresAt.getTime() < Date.now();
    return presentFilingBatch(
      { ...row, content: shown },
      expired ? "This filing card has expired. Ask for a new one." : await cannotFile(actor),
    );
  };

  const reader = async (actor: Actor) => {
    const graph = deps.microsoft ? await deps.microsoft.outlookReader(own(actor)) : null;
    if (!graph) {
      throw new ORPCError("BAD_REQUEST", { message: "Connect Outlook in Connectors first." });
    }
    return graph;
  };

  const mailbox = async (actor: Actor, settings: EmailFilingSettings) => {
    const graph = await reader(actor);
    const [folders, known] = await Promise.all([listMailFolders(graph), wellKnownFolderIds(graph)]);
    return { folders, known, targets: fileableFolders(folders, known, settings) };
  };

  const evolve = async (actor: Actor) => {
    const email = await actorEmail(deps, actor);
    if (!deps.evolvePlugins || !email) {
      throw new ORPCError("BAD_REQUEST", { message: "Evolve projects are not available to you." });
    }
    return { connection: deps.evolvePlugins, email };
  };

  const editable = (item: StoredFilingItem, row: BatchRow) =>
    item.status === "proposed" ||
    item.status === "failed" ||
    (item.status === "filing" && stale(row));

  const profileView = async (actor: Actor): Promise<EmailFilingProfile> => {
    const profile = await loadFilingProfile(deps.prisma, own(actor));
    const account = deps.microsoft
      ? await deps.microsoft.outlookAccount(own(actor)).catch(() => null)
      : null;
    return {
      settings: profile.settings,
      rules: profile.rules.map(publicRule),
      policy: companyEmailFilingPolicy(),
      outlookConnected: Boolean(account),
    };
  };

  /**
   * The person's press of File: claims the chosen emails, then for each one checks it is still where
   * the card found it before moving it. Project folders are found or created under the parent.
   */
  const file = async (actor: Actor, id: string, itemIds: readonly string[]) => {
    await requireCompanyFeature(deps, actor, "outlookFiling");
    const microsoft = deps.microsoft;
    if (!microsoft) throw new ORPCError("BAD_REQUEST", { message: "Outlook is not set up here." });
    const row = await load(actor, id);
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This filing card has expired. Ask for a new one.",
      });
    }
    const content = storedFilingBatch(row.content);
    const wanted = new Set(itemIds);
    const chosen = content.items.filter(
      (item) => wanted.has(item.id) && item.target !== null && editable(item, row),
    );
    if (chosen.length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "None of these emails can be filed now." });
    }
    const claimed = new Set(chosen.map((item) => item.id));
    const claim = {
      ...content,
      items: content.items.map((item) =>
        claimed.has(item.id) ? { ...item, status: "filing" as const, error: null } : item,
      ),
    };
    if (!(await save(actor, row, claim))) throw new ORPCError("CONFLICT", { message: CHANGED });

    const putBack = async (message: string) => {
      await merge(
        actor,
        id,
        chosen.map((item) => ({ ...item, status: "proposed" as const, error: message })),
      );
      return present(actor, await load(actor, id));
    };

    const grant = await microsoft.outlookFilingToken(own(actor)).catch(() => null);
    if (!grant) return putBack("Outlook could not be reached. Nothing was moved; try again.");
    if ("reconnect" in grant) return putBack(grant.reconnect);
    const writer: FilingGraph = createFilingGraph(grant.token);
    const profile = await loadFilingProfile(deps.prisma, own(actor));
    const policy = companyEmailFilingPolicy();
    let view: Awaited<ReturnType<typeof mailbox>>;
    try {
      view = await mailbox(actor, profile.settings);
    } catch {
      return putBack("Outlook could not list your folders. Nothing was moved; try again.");
    }
    const blocked = blockedFolderIds(view.folders, view.known);
    const byId = new Map(view.folders.map((folder) => [folder.id, folder]));
    const canFileInto = (folderId: string) => byId.has(folderId) && !blocked.has(folderId);
    let foldersCreated = 0;

    let parent: Promise<{ id: string; path: string }> | null = null;
    const parentFolder = () => {
      parent ??= (async () => {
        const chosenParent = profile.settings.parentFolderId;
        if (chosenParent && canFileInto(chosenParent)) {
          return { id: chosenParent, path: byId.get(chosenParent)?.path ?? "" };
        }
        const inbox = view.known.inbox;
        if (!inbox) throw new OutlookFilingError("Outlook did not show your Inbox.");
        const name = policy.defaultParentFolder;
        const { folder, created } = await ensureChildFolder(writer, inbox, name, (entry) =>
          sameName(entry.displayName, name),
        );
        if (created) foldersCreated++;
        return {
          id: folder.id,
          path: `${byId.get(inbox)?.path ?? "Inbox"} › ${folder.displayName}`,
        };
      })();
      return parent;
    };

    const projectFolders = new Map<string, Promise<{ id: string; path: string }>>();
    const projectFolder = (target: Extract<StoredFilingItem["target"], { kind: "project" }>) => {
      let pending = projectFolders.get(target.jobKey);
      if (!pending) {
        pending = (async () => {
          if (!policy.allowFolderCreation) {
            throw new OutlookFilingError("New project folders are turned off by your company.");
          }
          const remembered = await runAsTenant(own(actor), () =>
            deps.prisma.emailFilingFolder.findFirst({
              where: { spaceId: actor.spaceId, userId: actor.userId, jobKey: target.jobKey },
            }),
          );
          if (remembered && canFileInto(remembered.folderId)) {
            return { id: remembered.folderId, path: byId.get(remembered.folderId)?.path ?? "" };
          }
          const home = await parentFolder();
          const job = jobKeyOf(target.jobKey);
          const existing = job ? folderForJob(view.targets, job, home.id) : null;
          let folder: { id: string; path: string };
          if (existing) {
            folder = { id: existing.id, path: existing.path };
          } else {
            const ensured = await ensureChildFolder(
              writer,
              home.id,
              target.folderName,
              (entry) =>
                folderJobKey(entry.displayName)?.key === target.jobKey ||
                sameName(entry.displayName, target.folderName),
            );
            if (ensured.created) foldersCreated++;
            folder = {
              id: ensured.folder.id,
              path: `${home.path} › ${ensured.folder.displayName}`,
            };
          }
          byId.set(folder.id, {
            id: folder.id,
            name: folder.path.split(" › ").pop() ?? "",
            path: folder.path,
            parentId: home.id,
            depth: 0,
            job,
          } satisfies FolderNode);
          await runAsTenant(own(actor), () =>
            deps.prisma.emailFilingFolder.upsert({
              where: {
                spaceId_userId_jobKey: {
                  spaceId: actor.spaceId,
                  userId: actor.userId,
                  jobKey: target.jobKey,
                },
              },
              create: {
                spaceId: actor.spaceId,
                userId: actor.userId,
                jobKey: target.jobKey,
                folderId: folder.id,
              },
              update: { folderId: folder.id },
            }),
          );
          return folder;
        })();
        projectFolders.set(target.jobKey, pending);
      }
      return pending;
    };

    const done = await eachLimited(
      chosen,
      MOVE_CONCURRENCY,
      async (item): Promise<StoredFilingItem> => {
        try {
          const now = await readMessageState(writer, item.messageId);
          if (!now || now.parentFolderId !== item.sourceFolderId) {
            return {
              ...item,
              status: "gone",
              error: now
                ? "This email was moved in Outlook since the card was made, so it was left where it is."
                : "This email is no longer in your mailbox.",
            };
          }
          const target = item.target;
          if (!target) return { ...item, status: "proposed", error: "Choose a folder first." };
          const destination =
            target.kind === "folder"
              ? { id: target.folderId, path: byId.get(target.folderId)?.path ?? target.path }
              : await projectFolder(target);
          if (!canFileInto(destination.id) || destination.id === item.sourceFolderId) {
            return {
              ...item,
              status: "failed",
              error: "That folder cannot be filed into. Choose another.",
            };
          }
          const moved = await moveOutlookMessage(writer, item.messageId, destination.id);
          return {
            ...item,
            status: "filed",
            error: null,
            webLink: moved.webLink ?? item.webLink,
            movedMessageId: moved.id,
            filedFolderId: destination.id,
            filedPath: destination.path,
            filedAt: new Date().toISOString(),
          };
        } catch (error) {
          if (!(error instanceof OutlookFilingError)) {
            getLogger().error("email filing move failed", { error: String(error), batchId: id });
          }
          return {
            ...item,
            status: "failed",
            error:
              error instanceof OutlookFilingError
                ? error.message
                : "Outlook stopped answering. Check the email in Outlook before trying again.",
          };
        }
      },
    );

    await merge(actor, id, done);

    const lessons = done.filter(
      (item) => item.status === "filed" && item.remember !== "none" && item.filedFolderId,
    );
    if (lessons.length > 0) {
      await updateFilingProfile(deps.prisma, own(actor), (current) => ({
        ...current,
        rules: lessons.reduce(
          (rules, item) =>
            learnRule(rules, item, item.remember as Exclude<StoredFilingItem["remember"], "none">, {
              id: item.filedFolderId ?? "",
              path: item.filedPath ?? "",
            }),
          current.rules,
        ),
      })).catch((error: unknown) =>
        getLogger().warn("email filing rule not saved", { error: String(error) }),
      );
    }

    const count = (status: StoredFilingItem["status"]) =>
      done.filter((item) => item.status === status).length;
    await recordAuditEvent({
      action: "email_filing.filed",
      actor: { type: "user", id: actor.userId },
      spaceId: actor.spaceId,
      threadId: row.threadId,
      target: { type: "email_filing_batch", id },
      outcome: count("filed") > 0 ? "success" : "failure",
      metadata: {
        filed: count("filed"),
        failed: count("failed"),
        gone: count("gone"),
        foldersCreated,
      },
    });
    return present(actor, await load(actor, id));
  };

  /** The person's press of Undo: moves each filed email back where it came from. */
  const undo = async (actor: Actor, id: string, itemIds: readonly string[]) => {
    await requireCompanyFeature(deps, actor, "outlookFiling");
    const microsoft = deps.microsoft;
    if (!microsoft) throw new ORPCError("BAD_REQUEST", { message: "Outlook is not set up here." });
    const row = await load(actor, id);
    const content = storedFilingBatch(row.content);
    const wanted = new Set(itemIds);
    const chosen = content.items.filter(
      (item) => wanted.has(item.id) && item.status === "filed" && item.movedMessageId,
    );
    if (chosen.length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "None of these emails can be put back." });
    }
    const claimed = new Set(chosen.map((item) => item.id));
    const claim = {
      ...content,
      items: content.items.map((item) =>
        claimed.has(item.id) ? { ...item, status: "filing" as const, error: null } : item,
      ),
    };
    if (!(await save(actor, row, claim))) throw new ORPCError("CONFLICT", { message: CHANGED });

    const keepFiled = (message: string) =>
      chosen.map((item) => ({ ...item, status: "filed" as const, error: message }));
    const grant = await microsoft.outlookFilingToken(own(actor)).catch(() => null);
    if (!grant || "reconnect" in grant) {
      await merge(
        actor,
        id,
        keepFiled(
          grant?.reconnect ?? "Outlook could not be reached. Nothing was moved; try again.",
        ),
      );
      return present(actor, await load(actor, id));
    }
    const writer = createFilingGraph(grant.token);
    const done = await eachLimited(
      chosen,
      MOVE_CONCURRENCY,
      async (item): Promise<StoredFilingItem> => {
        try {
          const movedId = item.movedMessageId ?? "";
          const now = await readMessageState(writer, movedId);
          if (!now || now.parentFolderId !== item.filedFolderId) {
            return {
              ...item,
              status: "filed",
              movedMessageId: null,
              error:
                "This email was moved or deleted in Outlook since, so it was left where it is.",
            };
          }
          const back = await moveOutlookMessage(writer, movedId, item.sourceFolderId);
          return {
            ...item,
            messageId: back.id,
            webLink: back.webLink ?? item.webLink,
            status: "proposed",
            error: null,
            movedMessageId: null,
            filedFolderId: null,
            filedPath: null,
            filedAt: null,
          };
        } catch (error) {
          return {
            ...item,
            status: "filed",
            error:
              error instanceof OutlookFilingError
                ? error.message
                : "Outlook stopped answering. Check the email in Outlook before trying again.",
          };
        }
      },
    );
    await merge(actor, id, done);
    await recordAuditEvent({
      action: "email_filing.undone",
      actor: { type: "user", id: actor.userId },
      spaceId: actor.spaceId,
      threadId: row.threadId,
      target: { type: "email_filing_batch", id },
      metadata: { restored: done.filter((item) => item.status === "proposed").length },
    });
    return present(actor, await load(actor, id));
  };

  return {
    emailFiling: {
      get: authed.emailFiling.get.handler(async ({ context, input }) =>
        present(context.actor, await load(context.actor, input.id)),
      ),

      folders: authed.emailFiling.folders.handler(async ({ context }) => {
        await requireCompanyFeature(deps, context.actor, "outlookFiling");
        const profile = await loadFilingProfile(deps.prisma, own(context.actor));
        const { targets } = await mailbox(context.actor, {
          ...profile.settings,
          excludedFolderIds: [],
        });
        return {
          folders: targets.map((folder) => ({
            id: folder.id,
            name: folder.name,
            path: folder.path,
            depth: folder.depth,
          })),
        };
      }),

      searchProjects: authed.emailFiling.searchProjects.handler(async ({ context, input }) => {
        await requireCompanyFeature(deps, context.actor, "outlookFiling");
        const { connection, email } = await evolve(context.actor);
        const profile = await loadFilingProfile(deps.prisma, own(context.actor));
        const [page, view] = await Promise.all([
          listEvolveReferenceProjects(connection, email, { search: input.search, page: 0 }),
          mailbox(context.actor, profile.settings).catch(() => null),
        ]);
        return {
          projects: page.projects.slice(0, 25).flatMap((project) => {
            const job = project.jobNumber ? jobKeyOf(project.jobNumber) : null;
            if (!job || !project.jobNumber) return [];
            const folder = view
              ? folderForJob(view.targets, job, profile.settings.parentFolderId)
              : null;
            return [
              {
                jobNumber: project.jobNumber,
                title: project.name,
                client: project.client,
                folderId: folder?.id ?? null,
                folderPath: folder?.path ?? null,
              },
            ];
          }),
        };
      }),

      retarget: authed.emailFiling.retarget.handler(async ({ context, input }) => {
        const actor = context.actor;
        await requireCompanyFeature(deps, actor, "outlookFiling");
        const row = await load(actor, input.id);
        const content = storedFilingBatch(row.content);
        const item = content.items.find((entry) => entry.id === input.itemId);
        if (!item || !editable(item, row)) {
          throw new ORPCError("BAD_REQUEST", { message: "This email can no longer be changed." });
        }
        const profile = await loadFilingProfile(deps.prisma, own(actor));
        const view = await mailbox(actor, { ...profile.settings, excludedFolderIds: [] });
        let target: StoredFilingItem["target"];
        if (input.target.kind === "folder") {
          const folderId = input.target.folderId;
          const folder = view.targets.find((entry) => entry.id === folderId);
          if (!folder || folder.id === item.sourceFolderId) {
            throw new ORPCError("BAD_REQUEST", { message: "That folder cannot be filed into." });
          }
          target = { kind: "folder", folderId: folder.id, path: folder.path };
        } else {
          const { connection, email } = await evolve(actor);
          const project = await resolveEvolveJob(connection, email, input.target.jobNumber);
          if (!project) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Evolve has no project with that job number that you can see.",
            });
          }
          const policy = companyEmailFilingPolicy();
          const existing = folderForJob(view.targets, project.job, profile.settings.parentFolderId);
          if (existing) {
            target = { kind: "folder", folderId: existing.id, path: existing.path };
          } else if (!policy.allowFolderCreation) {
            throw new ORPCError("BAD_REQUEST", {
              message: "There is no folder for this project, and new folders are turned off.",
            });
          } else {
            target = {
              kind: "project",
              jobNumber: project.jobNumber,
              jobKey: project.job.key,
              title: project.title,
              folderName: projectFolderName(project.jobNumber, project.title),
              parentPath:
                profile.settings.parentFolderPath ??
                `${view.folders.find((entry) => entry.id === view.known.inbox)?.path ?? "Inbox"} › ${policy.defaultParentFolder}`,
            };
          }
        }
        const next = {
          ...content,
          items: content.items.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  target,
                  chosen: true,
                  remember: input.remember,
                  status: entry.status === "filing" ? ("failed" as const) : entry.status,
                  error: null,
                }
              : entry,
          ),
        };
        if (!(await save(actor, row, next))) throw new ORPCError("CONFLICT", { message: CHANGED });
        return present(actor, await load(actor, row.id));
      }),

      file: authed.emailFiling.file.handler(({ context, input }) =>
        file(context.actor, input.id, input.itemIds),
      ),

      skip: authed.emailFiling.skip.handler(async ({ context, input }) => {
        const actor = context.actor;
        await requireCompanyFeature(deps, actor, "outlookFiling");
        const row = await load(actor, input.id);
        const content = storedFilingBatch(row.content);
        const wanted = new Set(input.itemIds);
        const next = {
          ...content,
          items: content.items.map((item) =>
            wanted.has(item.id) && editable(item, row)
              ? { ...item, status: "skipped" as const, error: null }
              : item,
          ),
        };
        if (!(await save(actor, row, next))) throw new ORPCError("CONFLICT", { message: CHANGED });
        return present(actor, await load(actor, row.id));
      }),

      undo: authed.emailFiling.undo.handler(({ context, input }) =>
        undo(context.actor, input.id, input.itemIds),
      ),

      settings: {
        get: authed.emailFiling.settings.get.handler(async ({ context }) => {
          await requireCompanyFeature(deps, context.actor, "outlookFiling");
          return profileView(context.actor);
        }),

        set: authed.emailFiling.settings.set.handler(async ({ context, input }) => {
          const actor = context.actor;
          await requireCompanyFeature(deps, actor, "outlookFiling");
          const policy = companyEmailFilingPolicy();
          let parent: { id: string | null; path: string | null } | undefined;
          if (input.parentFolderId !== undefined) {
            if (input.parentFolderId === null) {
              parent = { id: null, path: null };
            } else {
              const parentId = input.parentFolderId;
              const view = await mailbox(actor, {
                ...(await loadFilingProfile(deps.prisma, own(actor))).settings,
                excludedFolderIds: [],
              });
              const folder = view.targets.find((entry) => entry.id === parentId);
              if (!folder) {
                throw new ORPCError("BAD_REQUEST", {
                  message: "New project folders cannot go in that folder.",
                });
              }
              parent = { id: folder.id, path: folder.path };
            }
          }
          await updateFilingProfile(deps.prisma, own(actor), (current) => {
            const settings: EmailFilingSettings = { ...current.settings };
            if (input.enabled !== undefined) settings.enabled = input.enabled;
            if (input.confidence !== undefined) settings.confidence = input.confidence;
            settings.confidence = Math.max(settings.confidence, policy.minConfidence);
            if (input.includeSentItems !== undefined) {
              settings.includeSentItems = input.includeSentItems;
            }
            if (parent) {
              settings.parentFolderId = parent.id;
              settings.parentFolderPath = parent.path;
            }
            if (input.excludedFolderIds) {
              settings.excludedFolderIds = [...new Set(input.excludedFolderIds)];
            }
            if (input.excludedSenders) {
              settings.excludedSenders = [...new Set(input.excludedSenders)];
            }
            return { ...current, settings };
          });
          return profileView(actor);
        }),

        removeRule: authed.emailFiling.settings.removeRule.handler(async ({ context, input }) => {
          await requireCompanyFeature(deps, context.actor, "outlookFiling");
          await updateFilingProfile(deps.prisma, own(context.actor), (current) => ({
            ...current,
            rules: current.rules.filter((rule) => rule.id !== input.ruleId),
          }));
          return profileView(context.actor);
        }),
      },
    },
  };
}
