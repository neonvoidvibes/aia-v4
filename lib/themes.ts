// lib/themes.ts

export interface WelcomeMessageConfig {
  text?: string;
  imageUrl?: string;
  imageUrlMobile?: string; // Mobile-specific image URL
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
  text: "Augmenting wisdom.",
  fontSize: "3rem",
  fontWeight: "600",
};

export const predefinedThemes: ColorTheme[] = [
  // Dark themes
  {
    name: "Neon",
    className: "theme-neon-sunset",
    isDark: true,
  },
  {
    name: "Sunset",
    className: "theme-sunset",
    isDark: true,
  },
  // Light themes
  {
    name: "Desert Mirage",
    className: "theme-desert-mirage",
    isDark: false,
  },
  // Project themes
  {
    name: "River",
    className: "theme-river",
    isDark: true,
  },
  {
    name: "Fabric",
    className: "theme-fabric",
    isDark: false,
  },
  {
    name: "Tenant",
    className: "theme-tenant",
    isDark: true,
    welcomeMessage: {
      text: "Hur skapar vi värde idag?",
    },
  },
  {
    name: "Mobius",
    className: "theme-mobius",
    isDark: true,
    welcomeMessage: {
      text: "What wants to transform?",
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
    name: "Village",
    className: "theme-village",
    isDark: true,
    welcomeMessage: {
      text: "Augmenting wisdom.",
      fontSize: "3rem",
      fontWeight: "600",
    },
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
  {
    name: "Inner Development",
    className: "theme-inner-development",
    isDark: true,
    welcomeMessage: {
      imageUrl: "/IDG_Logo.png",
      imageUrlMobile: "/IDG_Logo_Simple.png",
      imageAlt: "IDG Logo",
    },
  },
  // Image themes
  {
    name: "Forest Deep",
    className: "theme-forest-deep",
    isDark: true,
    welcomeMessage: {
      text: "Rötterna lyssnar.",
    },
  },
  {
    name: "Ridge Glass",
    className: "theme-ridge-glass",
    isDark: true,
  },
];
