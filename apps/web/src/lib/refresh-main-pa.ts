import { isMainPaBot, paBotInstructions, paBotTeamInstructions } from "@rakazo/core";
import { rpc } from "./rpc";

const MARKER = "set up my own team and agents";
const TEAM_MARKER = "Do not run the organisation agent setup";
/** Early Main PAs stored a short first prompt. A prompt the person has written is longer. */
const EARLY_PA_INSTRUCTIONS = 2_000;

/** True only for the short first prompt, so a prompt the person wrote is left as they saved it. */
function earlyPaPrompt(instructions: string, marker: string): boolean {
  const text = instructions.trim();
  if (!text || text.includes(marker)) return false;
  return text.length <= EARLY_PA_INSTRUCTIONS;
}

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
    if (!earlyPaPrompt(instructions, TEAM_MARKER)) return false;
    await rpc.bots.update({
      botId: bot.id,
      instructions: paBotTeamInstructions(bot.name),
    });
    return true;
  }
  if (!earlyPaPrompt(instructions, MARKER)) return false;
  await rpc.bots.update({
    botId: bot.id,
    instructions: paBotInstructions(bot.name),
  });
  return true;
}
