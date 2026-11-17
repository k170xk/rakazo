import { describe, expect, it } from "vitest";
import { APP_KIT_GUIDE } from "../guide.js";
import {
  auditAppCraft,
  buildApp,
  checkFiles,
  classCandidates,
  FIX_APP_BEFORE_READY,
  inlineScript,
  keptAppLook,
  pluginBundle,
  shellShowsScreens,
} from "./index.js";

const APP = `
import { AppShell, KpiCard, DataTable } from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { Briefcase } from "lucide-react";
import { motion } from "motion/react";
import { title } from "./lib/copy";
export default function App() {
  const jobs = useTable("jobs");
  return (
    <AppShell title={title}>
      <motion.div className="grid gap-4 bg-[hsl(95_49%_51%/0.1)]">
        <KpiCard label="Jobs" value={jobs.rows.length} icon={<Briefcase />} />
        <DataTable rows={jobs.rows} schema={jobs.schema} />
      </motion.div>
    </AppShell>
  );
}`;

describe("buildApp", () => {
  it("builds the example the agent's guide teaches, so the guide matches the kit", async () => {
    const example = /## Example\n```tsx\n([\s\S]*?)```/.exec(APP_KIT_GUIDE)?.[1];
    expect(example).toBeTruthy();
    expect(auditAppCraft({ "App.tsx": example! })).toEqual([]);
    const built = await buildApp({ "App.tsx": example! }, { title: "Example" });
    expect(built.ok ? [] : built.errors).toEqual([]);
  });

  it("bundles an app with the kit into one document", async () => {
    const result = await buildApp({ "App.tsx": APP, "lib/copy.ts": 'export const title = "Jobs";' }, { title: "Jobs </title>" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html.startsWith("<!doctype html>")).toBe(true);
    expect(result.html).toContain("<title>Jobs &#60;/title&#62;</title>");
    expect(result.html).toContain("Urbanist Variable");
    expect(result.css).toContain("bg-\\[hsl\\(95_49\\%_51\\%\\/0\\.1\\)\\]");
    expect(result.css).not.toContain(".bg-red-500");
    expect(result.bytes).toBeLessThan(1_200_000);
    expect(result.html).not.toMatch(/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/);
  }, 30_000);

  it("tags the app's own elements with their source line in previews only", async () => {
    const files = { "App.tsx": 'export default function App() {\n  return <section className="p-4">Hi</section>;\n}' };
    const preview = await buildApp(files, { mode: "preview" });
    const published = await buildApp(files);
    expect(preview.ok && preview.js).toContain("data-loc");
    expect(preview.ok && preview.js).toContain('"app:App.tsx"');
    expect(published.ok && published.js).not.toContain("app:App.tsx");
  }, 30_000);

  it("resolves framer-motion as an alias for motion/react", async () => {
    const result = await buildApp({
      "App.tsx": 'import { motion } from "framer-motion";\nexport default function App() { return <motion.div whileHover={{ y: -2 }}>Hi</motion.div>; }',
    });
    expect(result.ok ? [] : result.errors).toEqual([]);
  }, 30_000);

  it("refuses imports outside the allowlist", async () => {
    const result = await buildApp({ "App.tsx": 'import fs from "node:fs"; export default () => fs;' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('Apps cannot import "node:fs"');
    expect(result.errors[0]?.file).toBe("App.tsx");
  });

  it("refuses relative paths that leave the app", async () => {
    const result = await buildApp({ "App.tsx": 'import x from "../../package.json"; export default () => x;' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("Cannot find");
  });

  it("points syntax errors at the file and line", async () => {
    const result = await buildApp({ "App.tsx": "export default function App() {\n  return <div>;\n}" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.file).toBe("App.tsx");
    expect(result.errors[0]?.line).toBeGreaterThan(1);
  });

  it("rejects stylesheet imports other than tailwind", async () => {
    const result = await buildApp({ "App.tsx": "export default () => null;", "styles.css": '@import "https://evil.example/x.css";' });
    expect(result.ok).toBe(false);
  });

  it("makes a plugin bundle with separate script and styles", async () => {
    const result = await buildApp({ "App.tsx": "export default () => <p>Hi</p>;" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bundle = pluginBundle(result, "Hi");
    expect(Object.keys(bundle).sort()).toEqual(["assets/app.css", "assets/app.js", "index.html"]);
    expect(bundle["index.html"]).toContain('src="./assets/app.js"');
  }, 30_000);
});

describe("checkFiles", () => {
  it("needs App.tsx and safe names", () => {
    expect(checkFiles({})).toMatch(/App.tsx/);
    expect(checkFiles({ "Main.tsx": "" })).toMatch(/App.tsx/);
    expect(checkFiles({ "App.tsx": "", "../x.ts": "" })).toMatch(/file names/);
    expect(checkFiles({ "App.tsx": "", "a/b/c/d/e/f.ts": "" })).toMatch(/file names/);
    expect(checkFiles({ "App.tsx": "", "lib/data.json": "{}" })).toBeNull();
  });

  it("refuses password and sign-in fields", () => {
    const asking: Array<Record<string, string>> = [
      { "App.tsx": '<input type="password" />' },
      { "App.tsx": "<Input type={'password'} />" },
      { "App.tsx": 'el.setAttribute("type", "password")' },
      { "App.tsx": '<input autoComplete="current-password" />' },
      { "App.tsx": "", "app.css": "input { -webkit-text-security: disc; }" },
    ];
    for (const files of asking) expect(checkFiles(files)).toMatch(/passwords/);
    expect(checkFiles({ "App.tsx": 'const label = "Password reset date";' })).toBeNull();
    expect(checkFiles({ "App.tsx": "", "README.md": 'Never use type="password".' })).toBeNull();
  });
});

describe("helpers", () => {
  it("finds class names including arbitrary values", () => {
    const found = classCandidates('<div className="p-4 [&>*]:h-full bg-[radial-gradient(circle_at_30%_20%,red,transparent)] hover:bg-muted">');
    expect(found.has("p-4")).toBe(true);
    expect(found.has("[&>*]:h-full")).toBe(true);
    expect(found.has("bg-[radial-gradient(circle_at_30%_20%,red,transparent)]")).toBe(true);
    expect(found.has("hover:bg-muted")).toBe(true);
  });

  it("keeps script text from closing its element", () => {
    expect(inlineScript('x="</script><img>"; y="<!--"')).toBe('x="<\\/script><img>"; y="<\\!--"');
  });

  it("flags bare CRUD, light-only slate classes, raw hex, off-brand blue and empty v1s", () => {
    const bare = `
      import { AppShell, TableView } from "@ocsc/ui";
      export default function App() {
        return <AppShell title="Reg" pages={[{ id: "list", label: "List", render: () => <div className="bg-white text-slate-900 bg-blue-600" style={{ color: "#77c043" }} /> }]} />;
      }
    `;
    const notes = auditAppCraft({ "App.tsx": bare }, { isNew: true, totalRows: 0 });
    expect(notes.some((note) => note.includes("light-only classes"))).toBe(true);
    expect(notes.some((note) => note.includes("off-brand blue/purple"))).toBe(true);
    expect(notes.some((note) => note.includes("#77c043"))).toBe(true);
    expect(notes.some((note) => note.includes("No @ocsc/ui chart"))).toBe(true);
    expect(notes.some((note) => note.includes("interactive workflow view"))).toBe(true);
    expect(notes.some((note) => note.includes("commands on AppShell"))).toBe(true);
    expect(notes.some((note) => note.includes("<Theme"))).toBe(true);
    expect(notes.some((note) => note.includes("0 rows"))).toBe(true);
  });

  it("keeps a new app and a later save inside the OCSC shell", () => {
    const shell = {
      "App.tsx": `import { AppShell, Theme } from "@ocsc/ui";
        export default function App() {
          return <Theme preset="evolve"><AppShell title="Jobs">Hi</AppShell></Theme>;
        }`,
    };
    const plain = { "App.tsx": "export default function App() { return <div>Hi</div>; }" };
    expect(keptAppLook(null, plain)).toContain("AppShell");
    expect(keptAppLook(null, shell)).toBeNull();
    expect(keptAppLook(shell, plain)).toContain("Nothing was saved");
    expect(keptAppLook(shell, shell)).toBeNull();
    expect(keptAppLook(plain, plain)).toBeNull();
    expect(keptAppLook(plain, plain, { hadShell: true })).toContain("AppShell");
    expect(keptAppLook(plain, shell, { hadShell: true })).toBeNull();
    const shellOnly = {
      "App.tsx": `import { AppShell } from "@ocsc/ui";
        export default function App() { return <AppShell title="Jobs">Hi</AppShell>; }`,
    };
    expect(keptAppLook(shellOnly, shellOnly)).toBeNull();
    const blank = {
      "App.tsx": `import { Theme, AppShell, Button } from "@ocsc/ui";
        export default function App() {
          const [tab, setTab] = useState("Overview");
          return <Theme preset="evolve"><>
            <AppShell title="ITM" tabs={["Overview"]} activeTab={tab} onTabChange={setTab} />
            <main>{tab}</main>
          </></Theme>;
        }`,
    };
    expect(keptAppLook(null, blank)).toContain("blank");
    expect(keptAppLook(shell, blank)).toContain("Nothing was saved");
    const paged = {
      "App.tsx": `import { AppShell, Theme } from "@ocsc/ui";
        export default function App() {
          return <Theme preset="evolve"><AppShell title="ITM" pages={[{ id: "overview", label: "Overview", render: () => <p>Hi</p> }]} /></Theme>;
        }`,
    };
    expect(keptAppLook(null, paged)).toBeNull();
  });

  it("reads screens inside a shell even when a comment mentions an empty one", () => {
    const studio = `import { AppShell, Theme } from "@ocsc/ui";
      import { IfcView } from "@ocsc/ifc";
      export default function App() {
        return <Theme preset="evolve">
          <AppShell title="IFC Studio">
            {/* A self-closing <AppShell /> leaves the window blank. */}
            <IfcView />
          </AppShell>
        </Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": studio })).toBeNull();
    expect(
      shellShowsScreens({
        "App.tsx": `import { AppShell } from "@ocsc/ui";
          // <AppShell />
          export default function App() { return <AppShell title="IFC"><p>Model</p></AppShell>; }`,
      }),
    ).toBeNull();
    const empty = shellShowsScreens({
      "Viewer.tsx": `export function Viewer() { return <AppShell title="IFC"><p>Model</p></AppShell>; }`,
      "Shell.tsx": `export function Frame() { return <AppShell title="IFC" />; }`,
    });
    expect(empty).toContain("Shell.tsx");
    expect(empty).not.toContain("Viewer.tsx");
    const hiddenByRegex = `const q = /'((?:[^']|'')*)'/g;
      export function App() { return <AppShell title="IFC Model Viewer"/><main>Elements</main>; }`;
    expect(shellShowsScreens({ "App.tsx": hiddenByRegex })).toContain("App.tsx");
  });

  it("refuses pages without render even when the word render appears elsewhere", () => {
    expect(FIX_APP_BEFORE_READY).toContain("save_app again");
    const labelsOnly = `import { AppShell, Theme } from "@ocsc/ui";
      // Remember: each page needs render: () => ...
      export default function App() {
        return <Theme preset="evolve">
          <AppShell title="ITM" pages={[{ id: "overview", label: "Overview" }, { id: "board", label: "Board" }]} />
        </Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": labelsOnly })).toContain("blank");
    const wrongProps = `import { AppShell, Theme } from "@ocsc/ui";
      export default function App() {
        const [page, setPage] = useState("overview");
        return <Theme preset="evolve">
          <AppShell title="ITM" activePage={page} onPageChange={setPage} tabs={["Overview"]} />
          <main>Hidden under the shell</main>
        </Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": wrongProps })).toContain("blank");
    const commentOnly = `import { AppShell, Theme } from "@ocsc/ui";
      export default function App() {
        return <Theme preset="evolve">
          <AppShell title="ITM">{/* screens go here */}</AppShell>
        </Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": commentOnly })).toContain("blank");
    const fromVar = `import { AppShell, Theme } from "@ocsc/ui";
      const PAGES = [{ id: "overview", label: "Overview", render: () => <p>Hi</p> }];
      export default function App() {
        return <Theme preset="evolve"><AppShell title="ITM" pages={PAGES} /></Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": fromVar })).toBeNull();
    const varWithoutRender = `import { AppShell, Theme } from "@ocsc/ui";
      function renderBoard() { return <p>Board</p>; }
      const PAGES = [{ id: "overview", label: "Overview" }];
      export default function App() {
        return <Theme preset="evolve"><AppShell title="ITM" pages={PAGES} /></Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": varWithoutRender })).toContain("blank");
    const fromFn = `import { AppShell, Theme } from "@ocsc/ui";
      function makePages() {
        return [{ id: "overview", label: "Overview", render: () => <p>Hi</p> }];
      }
      export default function App() {
        return <Theme preset="evolve"><AppShell title="ITM" pages={makePages()} /></Theme>;
      }`;
    expect(shellShowsScreens({ "App.tsx": fromFn })).toBeNull();
  });
});
