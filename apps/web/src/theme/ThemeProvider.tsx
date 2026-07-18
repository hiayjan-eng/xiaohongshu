import { useEffect, type ReactNode } from "react";
import { getThemePreset, themeToCssVariables, type ThemePresetId } from "./themePresets";

type ThemeProviderProps = {
  children: ReactNode;
  themeId: ThemePresetId;
};

export function ThemeProvider({ children, themeId }: ThemeProviderProps) {
  useEffect(() => {
    const preset = getThemePreset(themeId);
    const root = document.documentElement;
    Object.entries(themeToCssVariables(preset)).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    root.dataset.theme = preset.id;
  }, [themeId]);

  return <>{children}</>;
}
