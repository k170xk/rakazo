import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const CLI = new URL("./ocsc-python.mjs", import.meta.url).pathname;

function runCli(workspace, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: workspace,
    env: { ...process.env, WORKSPACE_DIR: workspace },
    encoding: "utf8",
  });
  return { status: res.status, json: JSON.parse(res.stdout), stderr: res.stderr };
}

test("ocsc-python merges workspace CSVs and reports newly created files", () => {
  const ws = mkdtempSync(join(tmpdir(), "ocsc-python-test-"));
  try {
    mkdirSync(join(ws, "work"), { recursive: true });
    writeFileSync(join(ws, "work/a.csv"), "item,qty\nSteel,10\n", "utf8");
    writeFileSync(join(ws, "work/b.csv"), "item,qty\nConcrete,25\n", "utf8");

    const script = `
import csv, json
rows = []
for name in ("work/a.csv", "work/b.csv"):
    with open(name) as f:
        rows.extend(list(csv.DictReader(f)))
total = sum(int(r["qty"]) for r in rows)
with open("work/merged.json", "w") as out:
    json.dump({"rows": rows, "total": total}, out)
print(f"TOTAL={total}")
`;
    const { status, json } = runCli(ws, ["run", "--code", script]);
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.match(json.stdout, /TOTAL=35/);
    assert.ok(json.filesCreated.some((f) => f.path === "work/merged.json"));
    assert.equal(JSON.parse(readFileSync(join(ws, "work/merged.json"), "utf8")).total, 35);
    assert.ok(existsSync(join(ws, "work/merged.json")));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ocsc-python rejects scripts outside the workspace", () => {
  const ws = mkdtempSync(join(tmpdir(), "ocsc-python-escape-"));
  try {
    const { status, json } = runCli(ws, ["run", "--script", "../../etc/hosts"]);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /inside the workspace/i);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ocsc-python libs reports python version and libraries", () => {
  const ws = mkdtempSync(join(tmpdir(), "ocsc-python-libs-"));
  try {
    const { status, json } = runCli(ws, ["libs"]);
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.match(json.python, /^3\./);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
