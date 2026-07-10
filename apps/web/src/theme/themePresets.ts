export type ThemePresetId = "sprout" | "dawn" | "mist-blue" | "paper-ink" | "lavender-mint";

export type ThemeTokens = {
  page: string;
  surface: string;
  surfaceSoft: string;
  primary: string;
  primaryHover: string;
  primaryDark: string;
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  subtle: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
};

export type ThemePreset = {
  id: ThemePresetId;
  name: string;
  description: string;
  tokens: ThemeTokens;
  previewColors: string[];
};

export const THEME_STORAGE_KEY = "collection-revival-theme";

export const themePresets: ThemePreset[] = [
  {
    id: "sprout",
    name: "Sprout / 发芽绿",
    description: "清新、行动、温柔，适合默认的复活感。",
    tokens: {
      page: "#F7F5EF",
      surface: "#FFFFFF",
      surfaceSoft: "#EEF6F2",
      primary: "#4F8A75",
      primaryHover: "#3F7663",
      primaryDark: "#2F5F50",
      accent: "#D98C64",
      accentSoft: "#FFF4EC",
      text: "#1F2933",
      muted: "#6B7280",
      subtle: "#9CA3AF",
      border: "#E8E3DA",
      success: "#4F8A75",
      warning: "#D98C64",
      danger: "#C86767"
    },
    previewColors: ["#F7F5EF", "#EEF6F2", "#4F8A75", "#D98C64", "#1F2933"]
  },
  {
    id: "dawn",
    name: "Dawn / 清晨杏",
    description: "温暖、轻生活、日常陪伴，适合更柔和的打开感。",
    tokens: {
      page: "#FFF8F1",
      surface: "#FFFFFF",
      surfaceSoft: "#FFEEDF",
      primary: "#C86F4A",
      primaryHover: "#AD5D3B",
      primaryDark: "#7F422D",
      accent: "#7FA89B",
      accentSoft: "#EEF7F4",
      text: "#2A211D",
      muted: "#7A6B63",
      subtle: "#A99A91",
      border: "#EEDFD2",
      success: "#7FA89B",
      warning: "#D69A45",
      danger: "#C8665A"
    },
    previewColors: ["#FFF8F1", "#FFEEDF", "#C86F4A", "#7FA89B", "#2A211D"]
  },
  {
    id: "mist-blue",
    name: "Mist Blue / 雾蓝",
    description: "清醒、理性、效率，适合搜索找回和 Web 工作台。",
    tokens: {
      page: "#F4F7F7",
      surface: "#FFFFFF",
      surfaceSoft: "#EAF2F5",
      primary: "#4E7D8C",
      primaryHover: "#3F6977",
      primaryDark: "#2F4F5A",
      accent: "#D6A15F",
      accentSoft: "#FFF3DD",
      text: "#1D2B32",
      muted: "#64747B",
      subtle: "#9AA8AD",
      border: "#DDE7E9",
      success: "#5D947E",
      warning: "#D6A15F",
      danger: "#BF6B64"
    },
    previewColors: ["#F4F7F7", "#EAF2F5", "#4E7D8C", "#D6A15F", "#1D2B32"]
  },
  {
    id: "paper-ink",
    name: "Paper Ink / 纸墨",
    description: "克制、安静、高级，像私人工作台。",
    tokens: {
      page: "#FAF8F2",
      surface: "#FFFFFF",
      surfaceSoft: "#F0EEE6",
      primary: "#2E2B26",
      primaryHover: "#1F1D1A",
      primaryDark: "#11100E",
      accent: "#B98342",
      accentSoft: "#FFF2DE",
      text: "#211F1B",
      muted: "#6F6A60",
      subtle: "#A9A399",
      border: "#E5DED2",
      success: "#6F8B63",
      warning: "#B98342",
      danger: "#B75F56"
    },
    previewColors: ["#FAF8F2", "#F0EEE6", "#2E2B26", "#B98342", "#211F1B"]
  },
  {
    id: "lavender-mint",
    name: "Lavender Mint / 薄荷紫",
    description: "柔软、灵感、创作，适合审美收藏和内容灵感。",
    tokens: {
      page: "#F8F5FA",
      surface: "#FFFFFF",
      surfaceSoft: "#F0EDF7",
      primary: "#7567A8",
      primaryHover: "#63558F",
      primaryDark: "#4E436F",
      accent: "#86BBAA",
      accentSoft: "#EFF8F5",
      text: "#242034",
      muted: "#716B80",
      subtle: "#A7A1B3",
      border: "#E4DDEC",
      success: "#86BBAA",
      warning: "#D6A46F",
      danger: "#C46C7A"
    },
    previewColors: ["#F8F5FA", "#F0EDF7", "#7567A8", "#86BBAA", "#242034"]
  }
];

export function getThemePreset(themeId: string | null | undefined): ThemePreset {
  return themePresets.find((theme) => theme.id === themeId) ?? themePresets[0];
}

export function getStoredThemeId(storage?: Storage): ThemePresetId {
  const value = storage?.getItem(THEME_STORAGE_KEY);
  return getThemePreset(value).id;
}

export function themeToCssVariables(theme: ThemePreset): Record<string, string> {
  return {
    "--color-page": theme.tokens.page,
    "--color-surface": theme.tokens.surface,
    "--color-surface-soft": theme.tokens.surfaceSoft,
    "--color-primary": theme.tokens.primary,
    "--color-primary-hover": theme.tokens.primaryHover,
    "--color-primary-dark": theme.tokens.primaryDark,
    "--color-accent": theme.tokens.accent,
    "--color-accent-soft": theme.tokens.accentSoft,
    "--color-text": theme.tokens.text,
    "--color-muted": theme.tokens.muted,
    "--color-subtle": theme.tokens.subtle,
    "--color-border": theme.tokens.border,
    "--color-success": theme.tokens.success,
    "--color-warning": theme.tokens.warning,
    "--color-danger": theme.tokens.danger
  };
}