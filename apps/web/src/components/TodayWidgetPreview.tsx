import { ExternalLink, Sparkles } from "lucide-react";
import type { RevivalRecommendation } from "@revival/shared-types";

type TodayWidgetPreviewProps = {
  recommendations: RevivalRecommendation[];
  onOpenWorkspace: () => void;
};

export function TodayWidgetPreview({ recommendations, onOpenWorkspace }: TodayWidgetPreviewProps) {
  const items = recommendations.slice(0, 3);
  const firstItem = items[0];

  return (
    <section className="widget-preview-panel">
      <div className="section-heading-soft">
        <span><Sparkles size={18} /> 把今日行动放到你看得见的地方</span>
        <small>Coming soon</small>
      </div>
      <p className="panel-intro">未来你可以把今日复活放到电脑桌面或手机桌面，不用打开收藏夹，也能知道今天该做什么。</p>

      <div className="widget-preview-grid">
        <article className="desktop-widget-preview" aria-label="桌面小窗预览">
          <div className="widget-head">
            <span>今天复活哪一条？</span>
            <small>桌面小窗</small>
          </div>
          <div className="widget-action-list">
            {items.length > 0 ? (
              items.map(({ item, actionCard }) => (
                <div key={item.id} className="widget-action-row">
                  <span>{actionCard.estimatedTime}</span>
                  <strong>{actionCard.title}</strong>
                  <small>{item.status === "completed" ? "已复活" : "待开始"}</small>
                </div>
              ))
            ) : (
              <div className="widget-empty">今天先复活一条新收藏。</div>
            )}
          </div>
          <button type="button" onClick={onOpenWorkspace}>
            打开工作台 <ExternalLink size={14} />
          </button>
        </article>

        <article className="mobile-widget-preview" aria-label="手机桌面小组件预览">
          <div className="mobile-widget-top">
            <span>收藏复活</span>
            <small>今日</small>
          </div>
          {firstItem ? (
            <>
              <strong>{firstItem.actionCard.title}</strong>
              <p>{firstItem.actionCard.nextAction}</p>
              <small>{firstItem.actionCard.estimatedTime} · 打开收藏复活</small>
            </>
          ) : (
            <>
              <strong>今天复活哪一条？</strong>
              <p>导入一条收藏，生成一个可以开始的小动作。</p>
              <small>打开收藏复活</small>
            </>
          )}
        </article>
      </div>
    </section>
  );
}