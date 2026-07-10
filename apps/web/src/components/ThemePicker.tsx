import { CheckCircle2, Palette } from "lucide-react";
import { themePresets, type ThemePresetId } from "../theme/themePresets";

type ThemePickerProps = {
  selectedThemeId: ThemePresetId;
  onThemeChange: (themeId: ThemePresetId) => void;
};

export function ThemePicker({ selectedThemeId, onThemeChange }: ThemePickerProps) {
  return (
    <section className="theme-section">
      <div className="theme-section-copy">
        <p className="eyebrow">外观</p>
        <h2>选择你的收藏气质</h2>
        <p>有的人需要清醒一点，有的人需要温柔一点。选择一种你愿意每天打开的颜色。</p>
      </div>

      <div className="theme-grid" aria-label="主题选择">
        {themePresets.map((theme) => {
          const isActive = theme.id === selectedThemeId;
          return (
            <button
              key={theme.id}
              type="button"
              className={isActive ? "theme-card active" : "theme-card"}
              onClick={() => onThemeChange(theme.id)}
              aria-pressed={isActive}
              data-testid={`theme-${theme.id}`}
            >
              <span className="theme-card-head">
                <strong>{theme.name}</strong>
                {isActive && <CheckCircle2 size={18} aria-label="当前主题" />}
              </span>
              <span>{theme.description}</span>
              <i className="theme-dots" aria-hidden="true">
                {theme.previewColors.map((color) => (
                  <b key={color} style={{ background: color }} />
                ))}
              </i>
            </button>
          );
        })}
      </div>

      <div className="custom-theme-soon">
        <span><Palette size={18} /> 自定义强调色</span>
        <strong>Coming soon</strong>
        <p>第一版先提供经过搭配的安全主题，后续会开放主色自定义，并自动生成可读的 hover、边框和柔和背景。</p>
      </div>
    </section>
  );
}
