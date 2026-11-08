/** Short robot-style names offered for a new bot: three or four letters, easy to say and @mention. */
export const BOT_NAME_IDEAS: readonly string[] = [
  "Rex Dex Max Zed Kip Pip Bix Cog Jax Kit Orb Vex Zip Ozz Taz Rio Neo Ace Gus Hex Ion Jet",
  "Lux Mox Nix Pix Rok Sol Tek Vox Wiz Zak Arlo Axel Bolt Bree Chip Dash Echo Finn Juno Kade",
  "Koda Milo Nova Otto Remy Robo Rudy Sage Tito Volt Wren Zara Zeke Ziva Atom Beep Blip Byte",
  "Cody Flux Gear Iggy Kilo Lumo Nano Orbi Rivo Tobi Vega Zuri",
]
  .join(" ")
  .split(" ");

/**
 * A name from BOT_NAME_IDEAS that none of `taken` already uses (ignoring case), so a person's
 * bots stay easy to tell apart. When every idea is in use, a number is added.
 */
export function suggestBotName(taken: Iterable<string> = [], random: () => number = Math.random) {
  const used = new Set([...taken].map((name) => name.trim().toLowerCase()));
  const free = BOT_NAME_IDEAS.filter((name) => !used.has(name.toLowerCase()));
  if (free.length > 0) return free[Math.floor(random() * free.length)]!;
  const base = BOT_NAME_IDEAS[Math.floor(random() * BOT_NAME_IDEAS.length)]!;
  for (let number = 2; ; number += 1) {
    const name = `${base} ${number}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}
