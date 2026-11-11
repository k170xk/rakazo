import {
  EVOLVE_GENERAL_INTELLIGENCE_NAME,
  LEGACY_FIRST_BOT_NAMES,
  ONBOARDING_FIRST_BOT_SPAWN_KEY,
  paBotDescription,
  paBotInstructions,
  paBotTeamInstructions,
  suggestBotName,
} from "@rakazo/core";

export { EVOLVE_GENERAL_INTELLIGENCE_NAME, LEGACY_FIRST_BOT_NAMES, ONBOARDING_FIRST_BOT_SPAWN_KEY };

export function findFirstBot(
  bots: Array<{ id: string; name: string; spawnKey: string | null; pinned?: boolean }>,
): { id: string; pinned?: boolean } | undefined {
  const bySpawnKey = bots.find((bot) => bot.spawnKey === ONBOARDING_FIRST_BOT_SPAWN_KEY);
  if (bySpawnKey) return { id: bySpawnKey.id, pinned: bySpawnKey.pinned };
  const byName = bots.find((bot) => LEGACY_FIRST_BOT_NAMES.has(bot.name));
  return byName ? { id: byName.id, pinned: byName.pinned } : undefined;
}

/** Payload for a new Main PA; short robot name, PA description and standing instructions. */
export function firstPaBotCreateInput(input: {
  existingNames: Iterable<string>;
  userDisplayName: string;
  evolveAssistantId?: string;
  random?: () => number;
  /** A team inside an organisation skips the agent-setup interview. */
  team?: boolean;
}) {
  const name = suggestBotName(input.existingNames, input.random);
  return {
    name,
    description: paBotDescription(input.userDisplayName),
    instructions: input.team ? paBotTeamInstructions(name) : paBotInstructions(name),
    notifyOnFinish: true as const,
    spawnKey: ONBOARDING_FIRST_BOT_SPAWN_KEY,
    ...(input.evolveAssistantId ? { evolveAssistantId: input.evolveAssistantId } : {}),
  };
}
