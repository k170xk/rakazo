import { describe, expect, it } from "vitest";
import {
  CompanyToolsSchema,
  companyMcpEndpoints,
  companyToolsFrom,
  pluginStaffKey,
  staffAppKey,
  staffAppState,
  staffMayUseConnection,
  staffPluginEnabled,
} from "./domain.js";

describe("staff apps", () => {
  it("hides apps an admin has not listed once the list is saved", () => {
    expect(staffAppState({}, "sharepoint")).toBe("hidden");
    expect(staffAppState({ outlook: "soon" }, "gmail")).toBe("hidden");
  });

  it("keeps catalog apps open and company apps hidden before the list is saved", () => {
    expect(staffAppState(undefined, "gmail")).toBe("enabled");
    expect(staffAppState(undefined, "share_point")).toBe("hidden");
  });

  it("reads catalog slugs through the company app aliases", () => {
    expect(staffAppKey("share_point")).toBe("sharepoint");
    expect(staffAppKey("MICROSOFT_TEAMS")).toBe("microsoft-teams");
    expect(staffAppKey("gmail")).toBe("gmail");
    expect(staffAppState({ sharepoint: "enabled" }, "share_point")).toBe("enabled");
  });

  it("runs the company's MCP apps only while they are enabled for staff", () => {
    const infragrid = "https://qtmriibdnwhabfwmcfst.supabase.co/functions/v1/mcp";
    expect(companyMcpEndpoints({ infragrid3d: "enabled" })).toEqual([infragrid]);
    expect(companyMcpEndpoints({ infragrid3d: "soon" })).toEqual([]);
    expect(companyMcpEndpoints({ outlook: "enabled" })).toEqual([]);
    expect(companyMcpEndpoints(undefined)).toEqual([]);
  });

  it("lets staff use only enabled app connections", () => {
    const staffApps = { sharepoint: "enabled", outlook: "soon" } as const;
    expect(
      staffMayUseConnection(staffApps, { connectorId: "composio", provider: "share_point" }),
    ).toBe(true);
    expect(staffMayUseConnection(staffApps, { connectorId: "composio", provider: "outlook" })).toBe(
      false,
    );
    expect(staffMayUseConnection(staffApps, { connectorId: "pipedream", provider: "slack" })).toBe(
      false,
    );
    expect(staffMayUseConnection(staffApps, { connectorId: "mcp", provider: "anything" })).toBe(
      true,
    );
  });

  it("shows staff every plugin until the list is saved, then only enabled ones", () => {
    const source = "https://github.com/example/plugins#figma";
    expect(staffPluginEnabled(undefined, source)).toBe(true);
    expect(staffPluginEnabled(null, source)).toBe(true);
    expect(staffPluginEnabled({ sharepoint: "enabled" }, source)).toBe(false);
    expect(staffPluginEnabled({ [pluginStaffKey(source)]: "enabled" }, source)).toBe(true);
    expect(
      CompanyToolsSchema.partial().safeParse({ staffApps: { [pluginStaffKey(source)]: "enabled" } })
        .success,
    ).toBe(true);
  });

  it("keeps stored company tools when the app setting is missing or invalid", () => {
    expect(companyToolsFrom({ fileRetentionDays: 10 }).staffApps).toBeUndefined();
    expect(
      CompanyToolsSchema.partial().safeParse({ staffApps: { sharepoint: "on" } }).success,
    ).toBe(false);
    expect(companyToolsFrom({ staffApps: { sharepoint: "soon" } }).staffApps).toEqual({
      sharepoint: "soon",
    });
  });
});
