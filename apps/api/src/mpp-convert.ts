import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0] as const;

/** True when the bytes look like a Microsoft Compound Document (`.mpp`). */
export function isMppBinary(bytes: Uint8Array): boolean {
  if (bytes.length < OLE_MAGIC.length) return false;
  return OLE_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Convert a Microsoft Project binary (`.mpp`) into MSPDI XML using MPXJ via `@byteink/mppjs`.
 * Throws when the platform binary is missing or the file cannot be read.
 */
export async function mppBytesToMsProjectXml(bytes: Uint8Array): Promise<string> {
  if (!isMppBinary(bytes)) {
    throw new Error("Not a Microsoft Project (.mpp) file.");
  }
  let convert: (input: string, output?: string) => Promise<{ outputPath: string }>;
  try {
    ({ convert } = await import("@byteink/mppjs"));
  } catch {
    throw new Error(
      "Microsoft Project conversion is not available on this server. Export XML from Project (File → Save As → XML Format) and upload that instead.",
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "rakazo-mpp-"));
  const input = join(dir, "programme.mpp");
  const output = join(dir, "programme.xml");
  try {
    await writeFile(input, bytes);
    await convert(input, output);
    return await readFile(output, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message.includes("not available") || message.includes("binary")
        ? message
        : `Couldn't read that Microsoft Project file (${message}). Try File → Save As → XML Format (.xml) in Project.`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
