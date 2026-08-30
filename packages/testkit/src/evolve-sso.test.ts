import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signEvolveComputerSsoToken } from "@rakazo/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type AppHandles = Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;
const ssoSecret = "evolve-computer-sso-testkit-secret-32ch";

describeWithDatabase("Evolve Computer SSO", () => {
  let handles: AppHandles;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-evolve-sso-"));

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      evolveSsoSecret: ssoSecret,
    });
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates a session from a valid Evolve token and rejects replay", async () => {
    const email = `evolve-sso-${Date.now()}@example.com`;
    const { token } = signEvolveComputerSsoToken(ssoSecret, {
      email,
      evolveProfileId: 99,
      fullName: "Evolve Tester",
    });

    const first = await handles.app.request(`/api/auth/evolve?token=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toMatch(/\/onboarding$/);
    const cookie = sessionCookieHeader(first);
    expect(cookie).toMatch(/better-auth\.session_token=/);

    const me = await handles.app.request("/rpc/me", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ json: {} }),
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { json?: { userId?: string } };
    expect(body.json?.userId).toBeTruthy();
    const user = await handles.prisma.user.findUnique({ where: { email } });
    expect(user?.id).toBe(body.json?.userId);
    expect(user?.name).toBe("Evolve Tester");
    expect(user?.emailVerified).toBe(true);

    const replay = await handles.app.request(`/api/auth/evolve?token=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toMatch(/error=evolve_sso/);
  });

  it("returns 404 when the SSO secret is not configured", async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    const closedDir = mkdtempSync(path.join(tmpdir(), "rakazo-evolve-sso-off-"));
    const closed = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir: closedDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      evolveSsoSecret: undefined,
    });
    try {
      const res = await closed.app.request("/api/auth/evolve?token=nope");
      expect(res.status).toBe(404);
    } finally {
      await closed.stop();
      rmSync(closedDir, { recursive: true, force: true });
    }
  });
});
