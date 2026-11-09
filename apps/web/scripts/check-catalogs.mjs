// Fails when the app uses a message the catalogs lack. A production build strips the English from
// each message and shows only its id when the catalog has no entry, so the page shows random codes.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(path.join(tmpdir(), "rakazo-catalogs-"));
const msgids = (file) =>
  new Set(
    [...readFileSync(file, "utf8").matchAll(/^msgid "((?:[^"\\]|\\.)*)"$/gm)].map(
      (match) => match[1],
    ),
  );

try {
  cpSync(path.join(web, "src"), path.join(scratch, "src"), { recursive: true });
  cpSync(path.join(web, "lingui.config.ts"), path.join(scratch, "lingui.config.ts"));
  execFileSync(
    path.join(web, "node_modules", ".bin", "lingui"),
    ["extract", "--config", path.join(scratch, "lingui.config.ts"), "--locale", "en"],
    { cwd: web, stdio: "ignore" },
  );
  const used = msgids(path.join(scratch, "src/locales/en/messages.po"));
  const missing = new Set(used);
  for (const known of msgids(path.join(web, "src/locales/en/messages.po"))) missing.delete(known);
  missing.delete("");
  if (missing.size > 0) {
    console.error(
      `${missing.size} message(s) are missing from src/locales/*/messages.po and would show as codes:`,
    );
    for (const message of missing) console.error(`  ${message}`);
    console.error("Add an entry for each to every locale catalog (English text in en).");
    process.exit(1);
  }
  console.log("Translation catalogs cover every message.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
