import type { Hono } from "hono";
import type { Actor } from "@rakazo/contracts";
import { isMppBinary, mppBytesToMsProjectXml } from "./mpp-convert.js";

export const PLANS_FROM_MPP_PATH = "/api/v1/plans/from-mpp";

/**
 * `POST /api/v1/plans/from-mpp` — body is raw `.mpp` bytes; answers MSPDI XML so the browser can
 * finish the import with `@jantt/interop` without shipping the native converter to the client.
 */
export function mountMppConvertRoute(
  app: Hono,
  authenticate: (request: Request) => Promise<Actor | null>,
): void {
  app.post(PLANS_FROM_MPP_PATH, async (c) => {
    const request = c.req.raw;
    const actor = await authenticate(request);
    if (!actor) {
      await request.body?.cancel().catch(() => undefined);
      return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!isMppBinary(bytes)) {
      return c.json(
        {
          error:
            "Send a Microsoft Project binary (.mpp) file. If you already have XML, upload that directly.",
          code: "UNSUPPORTED_MEDIA_TYPE",
        },
        415,
      );
    }
    try {
      const xml = await mppBytesToMsProjectXml(bytes);
      return c.text(xml, 200, { "content-type": "application/xml; charset=utf-8" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't convert that .mpp file.";
      return c.json({ error: message, code: "MPP_CONVERT_FAILED" }, 422);
    }
  });
}
