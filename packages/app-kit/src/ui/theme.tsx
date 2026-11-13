import { useLayoutEffect } from "react";

/**
 * Brand-safe looks for a whole app: every preset keeps OCSC green and changes only the neutrals,
 * corner rounding, density and the shade of green. Light and dark values are both set, so the
 * person's light/dark choice keeps working.
 */

type Vars = Record<string, string>;

export const THEME_PRESETS = {
  /** The standard OCSC look. */
  evolve: { light: {}, dark: {} },
  /** Pure white surfaces, firmer lines and tighter corners: registers, finance, admin tools. */
  crisp: {
    light: {
      "--surface": "0 0% 100%",
      "--border": "220 13% 87%",
      "--input": "220 13% 84%",
      "--muted": "220 14% 96%",
    },
    dark: { "--surface": "0 0% 4%", "--card": "0 0% 8%", "--border": "0 0% 22%" },
    radius: "0.5rem",
  },
  /** Warm stone neutrals and rounder corners: people, wellbeing, onboarding. */
  soft: {
    light: {
      "--surface": "40 23% 97%",
      "--muted": "40 18% 94%",
      "--secondary": "40 18% 94%",
      "--accent": "40 18% 92%",
      "--border": "35 16% 88%",
      "--input": "35 16% 86%",
      "--muted-foreground": "30 8% 42%",
    },
    dark: {
      "--surface": "30 8% 6%",
      "--card": "30 6% 10%",
      "--popover": "30 6% 11%",
      "--muted": "30 5% 15%",
      "--border": "30 5% 19%",
    },
    radius: "1.1rem",
  },
  /** Neutrals tinted towards OCSC green: sustainability, site and landscape work. */
  forest: {
    light: {
      "--surface": "100 22% 97%",
      "--muted": "100 16% 94%",
      "--secondary": "100 16% 94%",
      "--accent": "100 16% 92%",
      "--border": "100 12% 87%",
      "--input": "100 12% 85%",
      "--muted-foreground": "120 8% 38%",
    },
    dark: {
      "--surface": "120 12% 5%",
      "--card": "120 9% 9%",
      "--popover": "120 9% 10%",
      "--muted": "120 7% 14%",
      "--secondary": "120 7% 16%",
      "--border": "120 7% 18%",
    },
  },
  /** Stronger text and lines for readability on site tablets and in bright rooms. */
  contrast: {
    light: {
      "--muted-foreground": "215 25% 30%",
      "--border": "214 20% 76%",
      "--input": "214 20% 70%",
      "--foreground": "222 47% 6%",
    },
    dark: { "--muted-foreground": "0 0% 82%", "--border": "0 0% 34%", "--input": "0 0% 38%" },
  },
} satisfies Record<string, { light: Vars; dark: Vars; radius?: string }>;

export type ThemePreset = keyof typeof THEME_PRESETS;

/** Shades of OCSC green only: brand colours stay green, never blue or purple. */
export const THEME_GREENS = {
  ocsc: { light: "95 49% 51%", dark: "102 48% 50%" },
  emerald: { light: "152 58% 38%", dark: "152 55% 46%" },
  lime: { light: "84 68% 42%", dark: "84 65% 50%" },
  teal: { light: "172 62% 34%", dark: "172 55% 44%" },
  moss: { light: "100 30% 38%", dark: "100 32% 50%" },
} as const;

const RADII = { none: "0rem", sm: "0.375rem", md: "0.75rem", lg: "1rem", xl: "1.35rem" } as const;
const DENSITY = { compact: "15px", comfortable: "16px", spacious: "17px" } as const;

export type ThemeOptions = {
  preset?: ThemePreset;
  green?: keyof typeof THEME_GREENS;
  radius?: keyof typeof RADII;
  /** Scales text and spacing together (compact suits dense tables). */
  density?: keyof typeof DENSITY;
};

const block = (selector: string, vars: Vars) => {
  const body = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  return body ? `${selector}{${body}}` : "";
};

/** The stylesheet text for a set of theme options (empty for the standard look). */
export function themeCss({
  preset = "evolve",
  green = "ocsc",
  radius,
  density,
}: ThemeOptions): string {
  const chosen: { light: Vars; dark: Vars; radius?: string } =
    THEME_PRESETS[preset] ?? THEME_PRESETS.evolve;
  const shade = THEME_GREENS[green] ?? THEME_GREENS.ocsc;
  const light: Vars = { ...chosen.light };
  const dark: Vars = { ...chosen.dark };
  if (green !== "ocsc") {
    Object.assign(light, {
      "--primary": shade.light,
      "--ring": shade.light,
      "--chart-1": shade.light,
    });
    Object.assign(dark, { "--primary": shade.dark, "--ring": shade.dark, "--chart-1": shade.dark });
  }
  const shared: Vars = {};
  const corner = radius ? RADII[radius] : chosen.radius;
  if (corner) shared["--radius"] = corner;
  if (density && density !== "comfortable") shared["font-size"] = DENSITY[density];
  return [block("html", shared), block("html:not(.dark)", light), block("html.dark", dark)].join(
    "",
  );
}

/**
 * Sets the app's look once, near the top of App.tsx: <Theme preset="soft" radius="lg" />.
 * Renders nothing; the whole app, including dialogs and toasts, follows it.
 */
export function Theme(options: ThemeOptions) {
  const css = themeCss(options);
  useLayoutEffect(() => {
    if (!css) return;
    const element = document.createElement("style");
    element.dataset.ocscTheme = "";
    element.textContent = css;
    document.head.append(element);
    return () => element.remove();
  }, [css]);
  return null;
}
