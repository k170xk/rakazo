import type { PrismaClient } from "@rakazo/db";
import { runAsSystem, setAppIcon } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { OCSC_ICON_REFERENCE } from "./app-icon-reference.js";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveAssistants } from "./evolve-plugins.js";

/** Stored and shown size; apps draw it at about 36–64px. */
export const APP_ICON_SIZE = 256;
const ICON_TIMEOUT_MS = 170_000;

/** What the icon shows: the assistant's chosen object, or one that fits the app's title. */
export function appIconSubject(title: string, subject?: string | null): string {
  const chosen = subject?.replace(/\s+/g, " ").trim().slice(0, 300);
  if (chosen) return chosen;
  return `one simple, recognisable object that stands for an app called "${title.slice(0, 120)}"`;
}

/** The OCSC icon recipe, drawn over a flat magenta backdrop that is cut out afterwards. */
export function appIconPrompt(subject: string): string {
  return [
    "Keep the same lighting, material, OCSC green and 3D style as this reference icon, but replace the house with the subject below.",
    "Square product icon for the OCSC app. 3D render, three-quarter isometric, camera looking down from the front-left at about 30 degrees. Soft even studio light, highlights on the material only. Subject centered with generous padding. Smooth simple materials, slightly rounded edges. Not a photograph, not a blueprint, not a flat vector.",
    "Background: one flat, even magenta #FF00FF everywhere behind the subject. No glow, no bloom, no vignette, no halo, no gradient, no floor, no ground plane, no shadow, no room. Do not use magenta anywhere on the subject.",
    "No text, no letters, no numbers, no logo, no watermark, no people.",
    "Colour: one accent only, OCSC brand green #76BF43, with lighter highlight #9AD36A and deeper shade #4E8F28 for form. Neutrals are white, #E8E8E8 and #6F6F6F. Do not use blue. Do not use purple.",
    `Subject: ${subject}`,
  ].join("\n\n");
}

/** Draws an app's icon with gpt-image-2 on Evolve's key; a 256px PNG with a transparent backdrop. */
export async function generateAppIcon(
  connection: EvolvePluginsConnection,
  email: string,
  input: { title: string; subject?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<Buffer> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    {
      action: "images.edit",
      model: "gpt-image-2",
      image: OCSC_ICON_REFERENCE,
      markup: null,
      prompt: appIconPrompt(appIconSubject(input.title, input.subject)),
      size: "1024x1024",
      quality: "medium",
    },
    { ...options, timeoutMs: ICON_TIMEOUT_MS },
  );
  const image = typeof payload.image === "string" ? payload.image : "";
  const match = image.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match?.[1]) throw new Error("No icon came back.");
  return cutOutBackdrop(Buffer.from(match[1], "base64"));
}

/** Makes the magenta backdrop transparent, softening the edge and the magenta spill on it. */
export async function cutOutBackdrop(png: Uint8Array): Promise<Buffer> {
  // sharp is a native addon; load it only when an image is processed.
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(png)
    .resize(APP_ICON_SIZE, APP_ICON_SIZE, { fit: "contain", background: "#FF00FF" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    // How magenta the pixel is: red and blue high together, above its green.
    const magenta = Math.min(r, b) - g;
    if (magenta <= 40) continue;
    const alpha = magenta >= 150 ? 0 : 1 - (magenta - 40) / 110;
    data[i + 3] = Math.round((data[i + 3] ?? 255) * alpha);
    // Pull the leftover pink out of the edge towards the pixel's own green.
    const spill = Math.min(r, b) - g;
    data[i] = r - Math.round(spill * (1 - alpha));
    data[i + 2] = b - Math.round(spill * (1 - alpha));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const drawing = new Set<string>();

/**
 * Draws and keeps an app's icon without holding up whoever made the app. Nothing happens when
 * Evolve is not linked, the owner has no email, or an icon for this app is already being drawn;
 * a failure leaves the app with its default mark.
 */
export function drawAppIconLater(
  deps: { prisma: PrismaClient; connection: EvolvePluginsConnection | null | undefined },
  input: { pageId: string; userId: string; title: string; subject?: string | null },
): Promise<string | null> {
  const { connection, prisma } = deps;
  if (!connection || drawing.has(input.pageId)) return Promise.resolve(null);
  drawing.add(input.pageId);
  return (async () => {
    try {
      const user = await runAsSystem("read the app owner's email for its icon", () =>
        prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }),
      );
      if (!user?.email) return null;
      const png = await generateAppIcon(connection, user.email, input);
      return await runAsSystem("keep an app's generated icon", () =>
        setAppIcon(prisma, input.pageId, png),
      );
    } catch (error) {
      getLogger().warn("app icon", { pageId: input.pageId, error: String(error) });
      return null;
    } finally {
      drawing.delete(input.pageId);
    }
  })();
}
