export function deriveMcpSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || `mcp-${Date.now()}`
  );
}

const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
const MAX_ENV_ENTRIES = 32;
const MAX_ENV_VALUE = 4096;

/** Parse KEY=value lines for stdio MCP env. Blank lines and # comments are ignored. */
export function parseMcpEnvLines(text: string): { env: Record<string, string>; error?: string } {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) return { env: {}, error: `Invalid environment line: ${line}` };
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (!ENV_KEY.test(key)) return { env: {}, error: `Invalid environment variable name: ${key}` };
    if (value.length > MAX_ENV_VALUE) {
      return { env: {}, error: `Environment value for ${key} is too long` };
    }
    env[key] = value;
  }
  if (Object.keys(env).length > MAX_ENV_ENTRIES) {
    return { env: {}, error: `At most ${MAX_ENV_ENTRIES} environment variables are allowed` };
  }
  return { env };
}
