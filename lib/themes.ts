// lib/themes.ts

export interface WelcomeMessageConfig {
  text?: string;
  imageUrl?: string;
  imageAlt?: string;
  fontSize?: string; // e.g., "1.5rem", "24px"
  fontWeight?: string | number; // e.g., "bold", "normal", 700, 400
}

export interface ColorTheme {
  name: string; // User-facing name, e.g., "Neon Sunset"
  className: string; // CSS class name, e.g., "theme-neon-sunset"
  isDark?: boolean; // Optional hint if the theme is generally dark or light based
  welcomeMessage?: WelcomeMessageConfig; // Optional: Theme-specific welcome message
  // `colors` object is not strictly needed here if all variables are defined in CSS
  // but can be useful for JS-driven style access or generation if ever needed.
  // For now, we primarily rely on the CSS classes.
}

export const G_DEFAULT_WELCOME_MESSAGE: WelcomeMessageConfig = {
  text: "What is alive today?",
  fontSize: "2.25rem", // 50% larger than original 1.5rem
  fontWeight: 700,    // Corresponds to Tailwind's font-bold
};

export const predefinedThemes: ColorTheme[] = [
  // Light themes
  {
    name: "White",
    className: "theme-white",
    isDark: false,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  {
    name: "Oceanic Calm",
    className: "theme-oceanic-calm",
    isDark: false,
    welcomeMessage: {
      text: "Dive deep, dream.",
      fontSize: "3rem",
      fontWeight: "700",
    },
  },
  {
    name: "Desert Mirage",
    className: "theme-desert-mirage",
    isDark: false,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  {
    name: "Splash",
    className: "theme-splash",
    isDark: false,
    welcomeMessage: {
      text: "Make a splash!",
      fontSize: "3rem",
      fontWeight: "700",
    },
  },
  // Dark themes
  {
    name: "Midnight Mono",
    className: "theme-midnight-monochrome",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  {
    name: "Neon",
    className: "theme-neon-sunset",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  {
    name: "Sunset",
    className: "theme-sunset",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  // Project themes
  {
    name: "River",
    className: "theme-river",
    isDark: true,
    welcomeMessage: {
      text: "Augmenting wisdom.",
      fontSize: "3rem",
      fontWeight: "600",
    },
  },
  {
    name: "Tenant",
    className: "theme-tenant",
    isDark: true,
    welcomeMessage: {
      text: "Hur skapar vi värde idag?",
      fontSize: "3rem",
      fontWeight: "600",
    },
  },
  {
    name: "Mobius",
    className: "theme-mobius",
    isDark: true,
    welcomeMessage: {
      text: "What wants to transform?",
      fontSize: "3rem",
      fontWeight: "600",
    },
  },
  {
    name: "Folkhemmet",
    className: "theme-folkhemmet",
    isDark: false,
    welcomeMessage: {
      text: "Hej!",
      fontSize: "5rem",
      fontWeight: "600",
    },
  },
  {
    name: "CFL",
    className: "theme-cfl",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  {
    name: "Moderbyn",
    className: "theme-moderbyn",
    isDark: true,
    welcomeMessage: {
      imageUrl: "/moderbyn-logotyp-hel-vit.png",
      imageAlt: "Moderbyn Logotyp",
    },
  },
  // Image themes
  {
    name: "Forest Deep",
    className: "theme-forest-deep",
    isDark: true,
    welcomeMessage: {
      text: "Rötterna lyssnar.",
      fontSize: "3rem",
      fontWeight: "600",
    },
  },
  {
    name: "Ridge Glass",
    className: "theme-ridge-glass",
    isDark: true,
    welcomeMessage: {
      text: "What is in between?",
      fontSize: "3rem",
      fontWeight: "600",
    },
  },
];
