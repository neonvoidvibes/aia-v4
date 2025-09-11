export interface Model {
  id: string; // e.g., "claude-sonnet-4-20250514"
  name: string; // e.g., "Claude 4 Sonnet"
  shortName?: string; // e.g., "Claude" - for selected label display
}

export interface ModelGroup {
  label: string; // e.g., "Standard"
  models: Model[];
}

// New data structure for the grouped model picker
export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Standard",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude 4 Sonnet", shortName: "Claude" },
      { id: "gpt-oss-120b", name: "GPT-Open L", shortName: "GPT-L" },
    ],
  },
  {
    label: "Fast",
    models: [
      { id: "gpt-oss-20b", name: "GPT-Open S", shortName: "GPT-S" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", shortName: "Flash" },
    ],
  },
  {
    label: "Thinking",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", shortName: "Gemini Pro" },
      { id: "gpt-5", name: "GPT-5 Thinking", shortName: "GPT-5" },
    ],
  },
];

// Helper map for components that still need a quick lookup for display names.
export const ALL_MODELS_FLAT = MODEL_GROUPS.flatMap(group => group.models);
export const MODEL_DISPLAY_NAMES_MAP = new Map(ALL_MODELS_FLAT.map(model => [model.id, model.name]));
export const MODEL_SHORT_NAMES_MAP = new Map(ALL_MODELS_FLAT.map(model => [model.id, model.shortName || model.name]));
