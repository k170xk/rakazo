/** The chat an app opens in: its group, the agent that built it, or another of the person's agents. */
export function chatForPage(
  page: { botId: string | null; groupId: string | null },
  bots: readonly { id: string; archivedAt: string | null }[],
): string | null {
  if (page.groupId) return `/app/g/${page.groupId}`;
  const live = bots.filter((bot) => bot.archivedAt === null);
  const creator = page.botId && live.some((bot) => bot.id === page.botId) ? page.botId : null;
  const botId = creator ?? live[0]?.id ?? null;
  return botId ? `/app/${botId}` : null;
}
