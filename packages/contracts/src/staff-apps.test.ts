import { describe, expect, it } from "vitest";
import {
  CompanyToolsSchema,
  catalogEndpointOpenTo,
  catalogItemOpenTo,
  companyMcpEndpoints,
  companyMcpEndpointsFor,
  companyToolsFrom,
  inAudience,
  pluginStaffKey,
  staffAppKey,
  staffAppState,
  staffAppStateFor,
  staffMayUseConnection,
  staffMayUseConnectionFor,
  staffPluginEnabled,
  staffPluginEnabledFor,
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

  it("opens an audience to its people and the members of its groups", () => {
    const groups = [{ id: "dev", name: "Developers", userIds: ["ann"] }];
    expect(inAudience(undefined, groups, "anyone")).toBe(true);
    expect(inAudience({ userIds: ["bob"], groupIds: [] }, groups, "bob")).toBe(true);
    expect(inAudience({ userIds: [], groupIds: ["dev"] }, groups, "ann")).toBe(true);
    expect(inAudience({ userIds: [], groupIds: ["dev"] }, groups, "bob")).toBe(false);
    expect(inAudience({ userIds: [], groupIds: [] }, groups, "ann")).toBe(false);
    // A deleted group admits nobody rather than everyone.
    expect(inAudience({ userIds: [], groupIds: ["gone"] }, groups, "ann")).toBe(false);
  });

  it("hides an enabled app from people outside its audience", () => {
    const infragrid = "https://qtmriibdnwhabfwmcfst.supabase.co/functions/v1/mcp";
    const source = "https://github.com/example/plugins#figma";
    const policy = {
      staffApps: {
        sharepoint: "enabled",
        infragrid3d: "enabled",
        outlook: "soon",
        [pluginStaffKey(source)]: "enabled",
      } as const,
      accessGroups: [{ id: "dev", name: "Developers", userIds: ["ann"] }],
      appAudiences: {
        sharepoint: { userIds: [], groupIds: ["dev"] },
        infragrid3d: { userIds: ["bob"], groupIds: [] },
        outlook: { userIds: ["bob"], groupIds: [] },
        [pluginStaffKey(source)]: { userIds: [], groupIds: ["dev"] },
      },
    };
    expect(staffAppStateFor(policy, "share_point", "ann")).toBe("enabled");
    expect(staffAppStateFor(policy, "share_point", "bob")).toBe("hidden");
    // An audience never turns a coming-soon app into an enabled one.
    expect(staffAppStateFor(policy, "outlook", "bob")).toBe("soon");
    expect(
      staffMayUseConnectionFor(policy, { connectorId: "microsoft", provider: "sharepoint" }, "bob"),
    ).toBe(false);
    expect(staffMayUseConnectionFor(policy, { connectorId: "mcp", provider: "x" }, "bob")).toBe(
      true,
    );
    expect(companyMcpEndpointsFor(policy, "bob")).toEqual([infragrid]);
    expect(companyMcpEndpointsFor(policy, "ann")).toEqual([]);
    expect(staffPluginEnabledFor(policy, source, "ann")).toBe(true);
    expect(staffPluginEnabledFor(policy, source, "bob")).toBe(false);
  });

  it("shows a directory service only after an admin enables it for that person", () => {
    const tools = {
      catalogItems: { "canva.com": "enabled" as const },
      appAudiences: { "catalog:canva.com": { userIds: [], groupIds: ["design"] } },
      accessGroups: [{ id: "design", name: "Design", userIds: ["ann"] }],
    };
    expect(catalogItemOpenTo(tools, "Canva.com", "ann", false)).toBe(true);
    expect(catalogItemOpenTo(tools, "canva.com", "bob", false)).toBe(false);
    expect(catalogItemOpenTo(tools, "canva.com", "bob", true)).toBe(true);
    expect(catalogItemOpenTo(tools, "clay.com", "ann", true)).toBe(false);
  });

  it("matches an MCP address to the directory service it belongs to", () => {
    const tools = {
      catalogItems: { "canva.com": "enabled" as const },
      appAudiences: { "catalog:canva.com": { userIds: ["ann"], groupIds: [] } },
      accessGroups: [],
    };
    expect(catalogEndpointOpenTo(tools, "https://mcp.canva.com/mcp", "ann", false)).toBe(true);
    expect(catalogEndpointOpenTo(tools, "https://canva.com/mcp", "ann", false)).toBe(true);
    expect(catalogEndpointOpenTo(tools, "https://mcp.canva.com/mcp", "bob", false)).toBe(false);
    expect(catalogEndpointOpenTo(tools, "https://notcanva.com/mcp", "ann", false)).toBe(false);
    expect(catalogEndpointOpenTo(tools, "https://evil.test/?u=canva.com", "ann", true)).toBe(false);
    expect(catalogEndpointOpenTo(tools, "not a url", "ann", true)).toBe(false);
  });

  it("accepts audiences only for switches that can be limited", () => {
    const audience = { userIds: ["ann"], groupIds: [] };
    expect(
      CompanyToolsSchema.partial().safeParse({ featureAudiences: { cursorAgents: audience } })
        .success,
    ).toBe(true);
    expect(
      CompanyToolsSchema.partial().safeParse({ featureAudiences: { computers: audience } }).success,
    ).toBe(false);
  });
});
