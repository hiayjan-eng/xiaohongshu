import { CalendarCheck, CheckCircle2, Flower2, Search, Sparkles, X } from "lucide-react";

export type AchievementIconName = "sparkles" | "flower" | "check" | "search" | "calendar";

export type AchievementDisplay = {
  id: string;
  title: string;
  description: string;
  condition: string;
  icon: AchievementIconName;
  themeColor: "primary" | "accent" | "success";
  unlockedAt?: string;
};

type AchievementModalProps = {
  achievement: AchievementDisplay | null;
  onClose: () => void;
};

const iconMap = {
  sparkles: Sparkles,
  flower: Flower2,
  check: CheckCircle2,
  search: Search,
  calendar: CalendarCheck
};

export function AchievementModal({ achievement, onClose }: AchievementModalProps) {
  if (!achievement) return null;
  const Icon = iconMap[achievement.icon];

  return (
    <div className="achievement-overlay" role="dialog" aria-modal="true" aria-labelledby="achievement-title">
      <section className={`achievement-modal ${achievement.themeColor}`}>
        <button className="achievement-close" type="button" onClick={onClose} aria-label="关闭成就提示">
          <X size={16} />
        </button>
        <div className="achievement-modal-icon">
          <Icon size={28} />
        </div>
        <p className="eyebrow">解锁成就</p>
        <h2 id="achievement-title">{achievement.title}</h2>
        <p>{achievement.description}</p>
      </section>
    </div>
  );
}