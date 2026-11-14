import { describe, expect, it } from "vitest";
import { auditAppCraft, buildApp } from "../build/index.js";
import { checkSchema } from "../schema.js";
import { APP_TEMPLATES, findTemplate } from "./index.js";

describe("app templates", () => {
  it("have unique ids and valid tables", () => {
    expect(new Set(APP_TEMPLATES.map((template) => template.id)).size).toBe(APP_TEMPLATES.length);
    for (const template of APP_TEMPLATES) {
      for (const table of template.tables) expect(checkSchema(table)).toMatchObject({ ok: true });
    }
    expect(findTemplate("site-inspection")?.access).toBe("contribute");
  });

  it.each(APP_TEMPLATES.map((template) => [template.id, template] as const))(
    "%s builds cleanly and meets every craft rule",
    async (_id, template) => {
      expect(auditAppCraft(template.files)).toEqual([]);
      const built = await buildApp(template.files, { title: template.title });
      expect(built.ok ? [] : built.errors).toEqual([]);
    },
    60_000,
  );
});
