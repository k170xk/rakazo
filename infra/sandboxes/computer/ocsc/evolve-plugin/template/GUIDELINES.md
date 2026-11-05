# Evolve plugin design guidelines

A plugin should look like part of Evolve, not a separate website. These rules match the Evolve
CV generator's own screens. Reviewers check them before a plugin is published.

## Layout

- **Menu along the top only.** Evolve's left menu is always beside the plugin, so a plugin never
  has a side menu, drawer or second sidebar. Put the plugin's sections in `TopNav` (in `src/ui`).
  Keep it to about six items; use tabs or filters inside a page for anything finer.
- Evolve already shows the plugin's name and version above it. The top menu holds sections, not a
  logo or the plugin's name.
- Wrap every screen in `AppShell`: page width up to `max-w-6xl`, `p-6` padding, `space-y-6`
  between blocks.
- Start each page with `PageHeader` (title, one-line description, actions on the right).
- Group content in `Card`s. Use tables for lists of records and keep forms in a single column
  on narrow screens.

## Type

The font is Urbanist (bundled; never load fonts from the web). Use these sizes:

| Use | Classes |
| --- | --- |
| Page title | `text-2xl font-bold` |
| Section title | `text-lg font-semibold` |
| Card title | `text-base font-semibold` (`CardTitle className="text-base"`) |
| Body, tables, forms, buttons | `text-sm` |
| Help text, captions | `text-sm text-muted-foreground` or `text-xs text-muted-foreground` |

Headings are semibold or bold, and body text is regular. Write in sentence case ("Add skill", not
"Add Skill").

## Colour, light and dark mode

- Use Evolve's token classes only: `bg-background`, `text-foreground`, `bg-card`, `border`,
  `text-muted-foreground`, `bg-muted`, `bg-primary text-primary-foreground`, `bg-secondary`,
  `bg-accent`, `text-destructive`, `ring-ring`. Never hard-code colours (`#fff`, `bg-white`,
  `text-gray-500`, `bg-green-600`).
- Evolve passes its live colours and switches the plugin between light and dark mode with its
  own setting, so token classes are all a plugin needs. Use `dark:` classes only for images or
  charts that need a different variant, and `evolve.onTheme` if code draws colours itself
  (for example a canvas chart).
- The brand green (`primary`) is for the main action on a page, the active menu item and
  highlights. Use it sparingly, with one solid primary button per area.
- Check every screen in both modes before submitting: add `?theme=dark` to the `ocsc-plugin dev`
  address, or use the switch in its corner.

## Components

Use the components in `src/ui` before writing new ones. They match Evolve's buttons
(`h-10`, `rounded-md`, `text-sm font-medium`), inputs, badges, cards and tables.

- Buttons: `default` for the main action, `outline` for secondary actions, `ghost` for icon
  buttons and toolbars, `destructive` for deletes (and ask first).
- Icons come from `lucide-react` at `h-4 w-4` beside text, the set Evolve uses.
- Corners: `rounded-lg` for cards, `rounded-md` for buttons and inputs, `rounded-full` for badges.
- Show `Spinner` while loading, `EmptyState` when there is nothing yet, and error messages in
  plain words with what to do next.

## Data

- All data comes through `evolve.call`. Admins choose which Evolve tables and columns plugins may
  read; each choice is a `data.<source>` scope (see `evolve_plugin_scopes` for the columns).
- Ask for only the scopes the plugin needs, and list each in `evolve-plugin.json`.
- Page through results (`limit`, `offset`, `hasMore`) instead of loading everything.
