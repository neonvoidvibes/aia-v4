// lib/themes.ts

export interface ColorTheme {
  name: string; // User-facing name, e.g., "Neon Sunset"
  className: string; // CSS class name, e.g., "theme-neon-sunset"
  isDark?: boolean; // Optional hint if the theme is generally dark or light based
  // `colors` object is not strictly needed here if all variables are defined in CSS
  // but can be useful for JS-driven style access or generation if ever needed.
  // For now, we primarily rely on the CSS classes.
}

export const predefinedThemes: ColorTheme[] = [
  {
    name: "Midnight Mono",
    className: "theme-midnight-monochrome",
    isDark: true,
  },
  {
    name: "Neon Sunset",
    className: "theme-neon-sunset",
    isDark: true,
  },
  {
    name: "Aurora Borealis",
    className: "theme-aurora-borealis",
    isDark: true,
  },
  {
    name: "Forest Deep",
    className: "theme-forest-deep",
    isDark: true,
  },
  {
    name: "Oceanic Calm",
    className: "theme-oceanic-calm",
    isDark: false,
  },
  {
    name: "Desert Mirage",
    className: "theme-desert-mirage",
    isDark: false,
  },
  {
    name: "Folkhemmet",
    className: "theme-folkhemmet",
    isDark: false,
  },
  // Add more predefined themes here
];