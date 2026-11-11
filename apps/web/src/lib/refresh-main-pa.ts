import { isMainPaBot, paBotInstructions } from "@rakazo/core";
import { rpc } from "./rpc";

const MARKER = "Leave the spawn name empty";

/** Refresh standing instructions for an early Main PA that still has the short first version. */
export async function refreshMainPaInstructions(bot: {
  id: string;
  name: string;
  spawnKey?: string | null;
  instructions?: string | null;
}): Promise<boolean> {
  if (!isMainPaBot(bot)) return false;
  if ((bot.instructions ?? "").includes(MARKER)) return false;
  await rpc.bots.update({
    botId: bot.id,
    instructions: paBotInstructions(bot.name),
  });
  return true;
}
