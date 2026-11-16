import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The ocsc-pdf-studio serve host's /api/decisions forward, run as the real script.
const CLI = fileURLToPath(
  new URL("../../../infra/sandboxes/computer/ocsc/pdf-studio/ocsc-pdf-studio.mjs", import.meta.url),
);
const TOKEN = "pdfd1.test-token.signature";

let workspace: string;
let serveProcess: ChildProcess;
let studio: string;
let api: Server;
let apiUrl: string;
const received: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
let hang = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  api = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      if (hang) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: "shadow", answers: [{ name: "r0" }], costUsd: 0 }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/api/pdf/decisions`;

  workspace = mkdtempSync(join(tmpdir(), "pdf-decisions-forward-"));
  const app = join(workspace, "app");
  mkdirSync(app);
  writeFileSync(join(app, "index.html"), "<!doctype html>");
  const env: NodeJS.ProcessEnv = { ...process.env, WORKSPACE_DIR: workspace, PDF_STUDIO_APP: app };
  delete env.RAKAZO_PDF_DECISIONS_URL;
  delete env.RAKAZO_PDF_DECISIONS_TOKEN;
  serveProcess = spawn(process.execPath, [CLI, "serve"], { env, stdio: "ignore" });
  const serverFile = join(workspace, ".openbot", "pdf-studio", "server.json");
  for (let i = 0; i < 100 && !studio; i++) {
    await sleep(50);
    try {
      studio = `http://127.0.0.1:${JSON.parse(readFileSync(serverFile, "utf8")).port}`;
    } catch {}
  }
  if (!studio) throw new Error("serve did not start");
});

afterAll(async () => {
  serveProcess?.kill();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  api.closeAllConnections();
  rmSync(workspace, { recursive: true, force: true });
});

const ask = (headers: Record<string, string> = {}) =>
  fetch(`${studio}/api/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ point: "rooms", input: "x", questions: [{ type: "predicate", name: "q" }] }),
  });

const credentialFile = () => join(workspace, ".openbot", "pdf-studio", "decisions.json");

describe("ocsc-pdf-studio /api/decisions forward", () => {
  it("answers unavailable at once when no api URL or token is set", async () => {
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable" });
    expect(received).toHaveLength(0);
  });

  it("forwards the body with the computer's token, which the page never sees", async () => {
    writeFileSync(credentialFile(), JSON.stringify({ url: apiUrl, token: TOKEN }));
    const response = await ask({ origin: studio });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, mode: "shadow" });
    expect(text).not.toContain(TOKEN);
    expect(received).toHaveLength(1);
    expect(received[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(received[0]!.body)).toEqual({
      point: "rooms",
      input: "x",
      questions: [{ type: "predicate", name: "q" }],
    });
  });

  it("refuses another origin and non-JSON posts without forwarding", async () => {
    const before = received.length;
    expect((await ask({ origin: "https://evil.example" })).status).toBe(403);
    expect((await ask({ "content-type": "text/plain" })).status).toBe(400);
    expect(received).toHaveLength(before);
  });

  it("gives up after about 2.5 s with reason timeout", async () => {
    hang = true;
    const started = Date.now();
    const response = await ask();
    hang = false;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 10_000);

  it("a CLI call saves the credential privately for the running server", async () => {
    rmSync(credentialFile(), { force: true });
    const env = {
      ...process.env,
      WORKSPACE_DIR: workspace,
      PDF_STUDIO_APP: join(workspace, "app"),
      RAKAZO_PDF_DECISIONS_URL: apiUrl,
      RAKAZO_PDF_DECISIONS_TOKEN: `${TOKEN}-2`,
    };
    await new Promise<void>((resolve) => {
      spawn(process.execPath, [CLI, "unknown-command"], { env, stdio: "ignore" }).on("exit", () =>
        resolve(),
      );
    });
    expect(JSON.parse(readFileSync(credentialFile(), "utf8"))).toEqual({
      url: apiUrl,
      token: `${TOKEN}-2`,
    });
    expect(statSync(credentialFile()).mode & 0o077).toBe(0);
    await ask();
    expect(received.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN}-2`);
  });
});
