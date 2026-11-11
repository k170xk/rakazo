# Evolve plugin design guidelines

A plugin should look like part of **Evolve (the OCSC CV Generator app)**, not a separate website or a generic AI dashboard. Match Evolve’s own screens: Urbanist, brand green, semantic light/dark tokens, and a top section menu because Evolve’s left drawer is already there. Reviewers check these rules before a plugin is published.

## Layout (Evolve already has the left menu)

- **Menu along the top only.** Evolve’s left sidebar / drawer is always beside the plugin. A plugin must **never** add a side menu, drawer, second sidebar, or fixed left rail. Put the plugin’s sections in `TopNav` from `src/ui` (underline / pill tabs along the top, like Project Health, LMS Admin, Access Control in Evolve).
- Keep the top menu to about six items. Use filters or in-page tabs for anything finer — still horizontal, never a nested left rail.
- Evolve already shows the plugin’s name and version above the iframe. The top menu holds **sections**, not a logo or the plugin’s name again.
- Wrap every screen in `AppShell`: page width up to `max-w-6xl`, `p-6` padding, `space-y-6` between blocks.
- Start each page with `PageHeader` (title, one-line description, actions on the right).
- Group interactive content in `Card`s when needed. Prefer open sections over wrapping the whole page in a decorative card. Tables for lists of records; forms in a single column on narrow screens.

## Type

The font is **Urbanist** (bundled via `@fontsource-variable/urbanist`; never load fonts from the web or Google Fonts). Do not use Inter, Roboto, Arial, or system stacks as the UI face.

| Use | Classes |
| --- | --- |
| Page title | `text-2xl font-bold` |
| Section title | `text-lg font-semibold` |
| Card title | `text-base font-semibold` (`CardTitle className="text-base"`) |
| Body, tables, forms, buttons | `text-sm` |
| Help text, captions | `text-sm text-muted-foreground` or `text-xs text-muted-foreground` |

Headings are semibold or bold; body text is regular. Sentence case ("Add skill", not "Add Skill").

## Colour, light and dark mode

- Use Evolve’s token classes only: `bg-background`, `text-foreground`, `bg-card`, `border`, `border-border`, `text-muted-foreground`, `bg-muted`, `bg-primary text-primary-foreground`, `bg-secondary`, `bg-accent`, `text-destructive`, `ring-ring`. Never hard-code colours (`#fff`, `bg-white`, `text-gray-500`, `bg-green-600`, `from-purple-500`).
- Brand green is `primary` (OCSC `#76BF43` / HSL `95 49% 51%` in light, tuned in dark). Use it for the main action, the active top-nav item, and sparse highlights — one solid primary button per area.
- Evolve passes live CSS tokens and toggles `.dark` with its own Light/Dark control. Token classes are enough for both modes. Use `dark:` only for images or charts that need a different asset; use `evolve.onTheme` when canvas/SVG code needs raw colours.
- Do **not** invent purple/indigo marketing themes, cream newspaper layouts, or glow effects.
- Check every screen in both modes before submitting: `?theme=dark` on the `ocsc-plugin dev` address, or the corner switch.

## Components

Use `src/ui` before writing new ones. They match Evolve’s buttons (`h-10`, `rounded-md`, `text-sm font-medium`), inputs, badges, cards and tables.

- Buttons: `default` for the main action, `outline` for secondary, `ghost` for icon buttons and toolbars, `destructive` for deletes (ask first).
- Icons from `lucide-react` at `h-4 w-4` beside text.
- Corners: `rounded-lg` for cards, `rounded-md` for buttons and inputs, `rounded-full` for badges.
- Show `Spinner` while loading, `EmptyState` when there is nothing yet, and error messages in plain words with what to do next.

## Data

- All data comes through `evolve.call`. Admins choose which Evolve tables and columns plugins may read; each choice is a `data.<source>` scope (see `evolve_plugin_scopes` for the columns).
- Ask for only the scopes the plugin needs, and list each in `evolve-plugin.json`.
- Page through results (`limit`, `offset`, `hasMore`) instead of loading everything.

## Anti-patterns (will fail review / build)

- Any left sidebar, drawer, or `fixed left-0` navigation inside the plugin
- Loading fonts from the network (Google Fonts, CDN)
- Hard-coded Inter/Roboto or purple-indigo gradient themes
- Re-branding the chrome with a second logo header that competes with Evolve’s green top bar
