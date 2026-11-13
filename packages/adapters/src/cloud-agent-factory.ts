import { createHash } from "node:crypto";
import type { CloudAgentProvider } from "@rakazo/adapter-kit";
import { EmulatorCloudAgentProvider } from "./cloud-agent-emulator.js";
import { resolveCloudAgentProvider } from "./cloud-agent-provider-env.js";
import { companyFeatures } from "./company-policy.js";
import { CursorCloudAgentProvider } from "./cursor-cloud-agent.js";

/**
 * The composition root binds a credential to one authorized Space, or to every Space while the
 * company's "Cursor cloud agents" switch is on.
 */
export interface CloudAgentConnection {
  provider: CloudAgentProvider;
  /** Opaque credential binding. Rotation fails closed for existing agents. */
  key: string;
  /** The one Space allowed while the company switch is off. */
  spaceId?: string;
  /** Launches allowed per calendar month (UTC) across the company; 0 means no cap. */
  monthlyLaunchLimit?: number;
}

export function cloudAgentsEnabled(
  connection: CloudAgentConnection | null | undefined,
  spaceId: string,
  /** Whether the company switch admits this person; defaults to the switch alone. */
  companyOpen: boolean = companyFeatures().cursorAgents,
) {
  if (!connection) return false;
  if (connection.provider.describe().capabilities.offline) {
    return !connection.spaceId || connection.spaceId === spaceId;
  }
  return connection.spaceId === spaceId || companyOpen;
}

export const DEFAULT_CLOUD_AGENT_MONTHLY_LAUNCHES = 100;

export function createCloudAgentConnection(
  source: NodeJS.ProcessEnv = process.env,
): CloudAgentConnection | null {
  const kind = resolveCloudAgentProvider(source);
  if (kind === "emulator") {
    return { provider: new EmulatorCloudAgentProvider(), key: "emulator" };
  }
  if (kind !== "cursor") return null;
  const apiKey = source.CURSOR_API_KEY!.trim();
  const spaceId = source.CLOUD_AGENT_SPACE_ID?.trim();
  const limit = Number(
    source.CLOUD_AGENT_MONTHLY_LAUNCHES?.trim() || DEFAULT_CLOUD_AGENT_MONTHLY_LAUNCHES,
  );
  return {
    provider: new CursorCloudAgentProvider({ apiKey }),
    key: `cursor:${createHash("sha256").update(apiKey).digest("hex")}`,
    ...(spaceId ? { spaceId } : {}),
    monthlyLaunchLimit:
      Number.isFinite(limit) && limit >= 0
        ? Math.floor(limit)
        : DEFAULT_CLOUD_AGENT_MONTHLY_LAUNCHES,
  };
}
