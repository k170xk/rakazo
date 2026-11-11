import { isMainPaBot, paBotInstructions, paBotTeamInstructions } from "@rakazo/core";
import { rpc } from "./rpc";

const MARKER = "OCSC QA agent";
const TEAM_MARKER = "Do not run the organisation agent setup";

/** Refresh standing instructions for an early Main PA that still has the short first version. */
export async function refreshMainPaInstructions(
  bot: {
    id: string;
    name: string;
    spawnKey?: string | null;
    instructions?: string | null;
  },
  options?: { team?: boolean },
): Promise<boolean> {
  if (!isMainPaBot(bot)) return false;
  const instructions = bot.instructions ?? "";
  if (options?.team) {
    if (instructions.includes(TEAM_MARKER)) return false;
    await rpc.bots.update({
      botId: bot.id,
      instructions: paBotTeamInstructions(bot.name),
    });
    return true;
  }
  if (instructions.includes(MARKER)) return false;
  await rpc.bots.update({
    botId: bot.id,
    instructions: paBotInstructions(bot.name),
  });
  return true;
}
