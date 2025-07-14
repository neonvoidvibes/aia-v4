// lib/themes.ts

export interface WelcomeMessageConfig {
  text: string;
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
  {
    name: "Midnight Mono",
    className: "theme-midnight-monochrome",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
  {
    name: "Neon Sunset",
    className: "theme-neon-sunset",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
  },
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
    name: "Pink Sunset",
    className: "theme-pink-sunset",
    isDark: false,
    welcomeMessage: {
      text: "Enjoy the glow.",
      fontSize: "3rem",
      fontWeight: 700,
    },
  },
  {
    name: "Cosmic Void",
    className: "theme-cosmic-void",
    isDark: true,
    welcomeMessage: {
      text: "Explore the cosmos.",
      fontSize: "2.5rem",
      fontWeight: 600,
    },
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
    name: "Folkhemmet",
    className: "theme-folkhemmet",
    isDark: false,
    welcomeMessage: {
      text: "Hej!",
      fontSize: "5rem",
      fontWeight: "600",
      // fontSize and fontWeight will fallback to G_DEFAULT_WELCOME_MESSAGE
      // values if not specified here, thanks to the logic in simple-chat-interface.tsx
    },
  },
  {
    name: "CFL",
    className: "theme-cfl",
    isDark: true,
    welcomeMessage: G_DEFAULT_WELCOME_MESSAGE,
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
  // Add more predefined themes here
];
