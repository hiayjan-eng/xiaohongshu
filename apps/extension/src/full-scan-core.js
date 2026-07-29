(() => {
  const SELECTOR_VERSION = "m0-full-scan-spike-v1";
  const REQUIRED_STABLE_CYCLES = 5;
  const PERSIST_BATCH_SIZE = 25;
  const RECENT_LIMIT = 12;
  const ACTIVITY_QUIET_MS = 24;
  const ACTIVITY_GUARD_MS = 900;

  class FullScanController {
    constructor(options) {
      this.document = options.document;
      this.location = options.location;
      this.MutationObserver = options.MutationObserver;
      this.sendMessage = options.sendMessage;
      this.onProgress = options.onProgress || (() => {});
      this.now = options.now || (() => new Date());
      this.testMode = options.testMode === true;
      this.session = null;
      this.identity = null;
      this.root = null;
      this.scrollContainer = null;
      this.observer = null;
      this.running = false;
      this.stopRequested = false;
      this.captureQueue = Promise.resolve();
      this.runPromise = null;
      this.lastMutationAt = 0;
      this.activityVersion = 0;
      this.maxBufferedItems = 0;
      this.recentItems = [];
      this.lastGeometry = "";
      this.stableGeometryCycles = 0;
      this.debugPauseAfter = 0;
    }

    inspectPage() {
      return inspectFavoritesPage({
        document: this.document,
        location: this.location
      });
    }

    async start(options = {}) {
      if (this.running) return { ok: true, session: this.session, alreadyRunning: true };
      const inspection = this.inspectPage();
      if (!inspection.ok) return { ok: false, error: inspection.reason, inspection };

      this.identity = inspection.identity;
      this.root = inspection.root;
      this.scrollContainer = inspection.scrollContainer;
      this.stopRequested = false;
      this.debugPauseAfter = this.testMode ? Math.max(0, Number(options.debugPauseAfter) || 0) : 0;
      const sessionResponse = await this.sendMessage({
        type: "M0_FULL_SCAN_CREATE_SESSION",
        identity: inspection.identity,
        resume: options.resume !== false
      });
      if (!sessionResponse?.ok || !sessionResponse.session) {
        return { ok: false, error: sessionResponse?.error || "无法创建全量扫描会话。" };
      }
      this.session = sessionResponse.session;
      if (this.session.favoritesPageIdentity !== inspection.identity.favoritesPageIdentity) {
        return { ok: false, error: "收藏页身份已变化，未恢复旧扫描会话。" };
      }

      this.session = await this.updateSession({
        status: "scanning",
        lastErrorCode: "",
        lastErrorMessage: ""
      });
      this.running = true;
      this.installObserver();
      this.restoreScrollCheckpoint();
      await this.captureFromNodes([this.root]);
      this.runPromise = this.runLoop()
        .catch((error) => this.fail(error));
      return { ok: true, session: this.session };
    }

    async pause(reason = "用户暂停") {
      this.stopRequested = true;
      this.running = false;
      this.observer?.disconnect();
      if (!this.session) return { ok: true, session: null };
      this.session = await this.updateSession({
        status: "paused",
        lastErrorCode: "",
        lastErrorMessage: reason
      });
      this.emitProgress();
      return { ok: true, session: this.session };
    }

    async stop() {
      this.stopRequested = true;
      this.running = false;
      this.observer?.disconnect();
      if (!this.session) return { ok: true, session: null };
      this.session = await this.updateSession({ status: "stopped" });
      this.emitProgress();
      return { ok: true, session: this.session };
    }

    diagnostics() {
      return {
        running: this.running,
        sessionId: this.session?.sessionId || "",
        maxBufferedItems: this.maxBufferedItems,
        recentItemCount: this.recentItems.length,
        observedRootIsBody: this.root === this.document.body,
        scrollContainerIsInsideFavoritesRoot: Boolean(
          this.root && this.scrollContainer && (this.root === this.scrollContainer || this.root.contains(this.scrollContainer))
        ),
        selectorVersion: SELECTOR_VERSION
      };
    }

    installObserver() {
      this.observer?.disconnect();
      this.observer = new this.MutationObserver((records) => {
        this.lastMutationAt = Date.now();
        this.activityVersion += 1;
        const addedNodes = records.flatMap((record) => Array.from(record.addedNodes || []));
        if (addedNodes.length) void this.captureFromNodes(addedNodes);
      });
      this.observer.observe(this.root, { childList: true, subtree: true });
    }

    restoreScrollCheckpoint() {
      const checkpoint = Math.max(0, Number(this.session?.lastScrollTop) || 0);
      if (!checkpoint || !this.scrollContainer) return;
      const maximum = Math.max(0, this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight);
      this.scrollContainer.scrollTop = Math.min(checkpoint, maximum);
    }

    async captureFromNodes(nodes) {
      const cards = collectCardsFromNodes(nodes, this.root);
      if (!cards.length) return;
      this.maxBufferedItems = Math.max(this.maxBufferedItems, cards.length);
      const extracted = cards.map((card) => extractFavoriteCard(card, this.location)).filter(Boolean);
      if (!extracted.length) return;

      this.captureQueue = this.captureQueue.then(async () => {
        for (let offset = 0; offset < extracted.length; offset += PERSIST_BATCH_SIZE) {
          if (!this.session) return;
          const batch = extracted.slice(offset, offset + PERSIST_BATCH_SIZE);
          this.maxBufferedItems = Math.max(this.maxBufferedItems, batch.length);
          const response = await this.sendMessage({
            type: "M0_FULL_SCAN_PERSIST_ITEMS",
            sessionId: this.session.sessionId,
            items: batch,
            checkpoint: this.readCheckpoint()
          });
          if (!response?.ok) throw new Error(response?.error || "流式写入 IndexedDB 失败。");
          this.session = response.session;
          this.recentItems = [...this.recentItems, ...(response.recentItems || [])].slice(-RECENT_LIMIT);
          this.emitProgress();
        }
      });
      await this.captureQueue;
    }

    async runLoop() {
      try {
        while (!this.stopRequested && this.session?.status === "scanning") {
          const inspection = this.inspectPage();
          if (!inspection.ok) {
            await this.pauseForUser(inspection.code, inspection.reason);
            return;
          }
          if (inspection.identity.favoritesPageIdentity !== this.session.favoritesPageIdentity) {
            await this.pauseForUser("PAGE_IDENTITY_CHANGED", "账号或收藏页身份已变化，旧会话未自动继续。");
            return;
          }
          if (this.debugPauseAfter && this.session.validCount >= this.debugPauseAfter) {
            await this.pause("开发夹具模拟中断");
            return;
          }

          const countBefore = this.session.validCount;
          const geometryBefore = readGeometry(this.scrollContainer);
          scrollFavoritesContainerToBottom(this.scrollContainer);
          await this.waitForActivityToSettle();
          await this.captureFromNodes([this.root]);
          await this.captureQueue;

          const loading = isLoading(this.root);
          const loadMore = hasVisibleLoadMore(this.root);
          const blocker = findBlockingState(this.document);
          if (blocker) {
            await this.pauseForUser(blocker.code, blocker.reason);
            return;
          }

          const geometryAfter = readGeometry(this.scrollContainer);
          const noGrowth = this.session.validCount === countBefore;
          const geometryStable =
            geometryAfter.scrollHeight === geometryBefore.scrollHeight &&
            geometryAfter.sentinel === geometryBefore.sentinel;
          const reachedBottom = geometryAfter.reachedBottom;
          this.stableGeometryCycles = geometryStable ? this.stableGeometryCycles + 1 : 0;
          const stableNoGrowthCycles =
            noGrowth && reachedBottom && !loading && !loadMore
              ? Number(this.session.stableNoGrowthCycles || 0) + 1
              : 0;
          this.lastGeometry = `${geometryAfter.scrollHeight}:${geometryAfter.sentinel}`;
          this.session = await this.updateSession({
            ...this.readCheckpoint(),
            stableNoGrowthCycles
          });
          this.emitProgress();

          if (
            reachedBottom &&
            stableNoGrowthCycles >= REQUIRED_STABLE_CYCLES &&
            this.stableGeometryCycles >= REQUIRED_STABLE_CYCLES &&
            !loading &&
            !loadMore
          ) {
            await this.complete();
            return;
          }
        }
      } finally {
        if (this.session?.status !== "scanning") {
          this.running = false;
          this.observer?.disconnect();
        }
      }
    }

    async waitForActivityToSettle() {
      const startedAt = Date.now();
      const startingVersion = this.activityVersion;
      while (Date.now() - startedAt < ACTIVITY_GUARD_MS) {
        const quietFor = Date.now() - this.lastMutationAt;
        const sawActivity = this.activityVersion !== startingVersion;
        if (!isLoading(this.root) && quietFor >= ACTIVITY_QUIET_MS && (sawActivity || Date.now() - startedAt >= ACTIVITY_QUIET_MS)) {
          return;
        }
        await wait(8);
      }
    }

    async complete() {
      await this.captureQueue;
      const verificationResponse = await this.sendMessage({
        type: "M0_FULL_SCAN_VERIFY_SESSION",
        sessionId: this.session.sessionId
      });
      if (!verificationResponse?.ok || !verificationResponse.verification?.consistent) {
        await this.pauseForUser("FINAL_DEDUPE_FAILED", "最终全局去重核验未通过，扫描已安全暂停。");
        return;
      }
      this.session = await this.updateSession({
        status: "completed",
        stableNoGrowthCycles: Math.max(REQUIRED_STABLE_CYCLES, this.session.stableNoGrowthCycles || 0)
      });
      this.running = false;
      this.observer?.disconnect();
      this.emitProgress({ verification: verificationResponse.verification });
    }

    async pauseForUser(code, reason) {
      this.stopRequested = true;
      this.running = false;
      this.observer?.disconnect();
      this.session = await this.updateSession({
        status: "needs_user",
        lastErrorCode: code,
        lastErrorMessage: reason
      });
      this.emitProgress();
    }

    async fail(error) {
      this.stopRequested = true;
      this.running = false;
      this.observer?.disconnect();
      if (this.session) {
        this.session = await this.updateSession({
          status: "paused",
          lastErrorCode: "SCAN_RUNTIME_ERROR",
          lastErrorMessage: error instanceof Error ? error.message : String(error)
        });
        this.emitProgress();
      }
    }

    async updateSession(patch) {
      const response = await this.sendMessage({
        type: "M0_FULL_SCAN_UPDATE_SESSION",
        sessionId: this.session.sessionId,
        patch
      });
      if (!response?.ok || !response.session) throw new Error(response?.error || "无法更新扫描 checkpoint。");
      return response.session;
    }

    readCheckpoint() {
      return {
        lastScrollTop: Math.max(0, Math.round(this.scrollContainer?.scrollTop || 0)),
        lastScrollHeight: Math.max(0, Math.round(this.scrollContainer?.scrollHeight || 0)),
        itemsCheckpoint: Math.max(0, Number(this.session?.validCount) || 0)
      };
    }

    emitProgress(extra = {}) {
      this.onProgress({
        session: this.session,
        recentItems: this.recentItems.slice(-RECENT_LIMIT),
        runtime: this.diagnostics(),
        ...extra
      });
    }
  }

  function inspectFavoritesPage({ document, location }) {
    const hostname = String(location?.hostname || "").toLowerCase();
    if (!/(^|\.)xiaohongshu\.com$/.test(hostname)) {
      return rejected("HOST_NOT_XHS", "当前页面不是小红书页面。");
    }
    const pathname = String(location?.pathname || "");
    const profileMatch = pathname.match(/^\/user\/profile\/([^/?#]+)/i);
    if (!profileMatch) {
      return rejected("NOT_PROFILE_PAGE", "当前页面不是本人 profile 页面。");
    }
    const params = new URLSearchParams(String(location?.search || ""));
    const tab = String(params.get("tab") || "").toLowerCase();
    if (!["fav", "favorite", "favorites", "collect", "collection"].includes(tab)) {
      return rejected("FAVORITES_ROUTE_UNCONFIRMED", "URL 未明确表示收藏页，为避免导入本人笔记，本次未开始扫描。");
    }

    const activeFavoriteTab = findVisibleActiveTab(document, "收藏", "favorites");
    if (!activeFavoriteTab) {
      return rejected("FAVORITES_TAB_UNCONFIRMED", "未确认可见激活主 tab 为“收藏”。");
    }
    const activeNotesTab = findVisibleActiveTab(document, "笔记", "notes");
    if (!activeNotesTab) {
      return rejected("NOTES_TAB_UNCONFIRMED", "未确认可见激活子 tab 为“笔记”。");
    }

    const root = findFavoritesRoot(document, activeFavoriteTab, activeNotesTab);
    if (!root || root === document.body) {
      return rejected("FAVORITES_PANEL_NOT_FOUND", "未能严格定位收藏面板，禁止退回 document.body 扫描。");
    }
    const ownPostsPanels = findOwnPostsPanels(document);
    if (ownPostsPanels.some((panel) => root === panel || root.contains(panel))) {
      return rejected("OWN_POST_PANEL_INSIDE_ROOT", "本人笔记面板位于扫描 root 内，本次未开始扫描。");
    }
    const scrollContainer = findScrollContainer(root);
    if (!scrollContainer || !(root === scrollContainer || root.contains(scrollContainer))) {
      return rejected("SCROLL_CONTAINER_UNCONFIRMED", "未能确认收藏面板的真实滚动容器。");
    }
    const blocker = findBlockingState(document);
    if (blocker) return rejected(blocker.code, blocker.reason);

    const profileIdHash = stableHash(profileMatch[1]);
    return {
      ok: true,
      root,
      scrollContainer,
      identity: {
        profileIdHash,
        favoritesPageIdentity: `${hostname}|${pathname}|tab=favorites|subtab=notes|profile=${profileIdHash}`,
        selectorVersion: SELECTOR_VERSION,
        extensionVersion: globalThis.chrome?.runtime?.getManifest?.().version || "0.2.3-spike"
      },
      diagnostics: {
        rootSelector: describeElement(root),
        scrollSelector: describeElement(scrollContainer),
        ownPostsPanelCount: ownPostsPanels.length,
        selectorVersion: SELECTOR_VERSION
      }
    };
  }

  function findVisibleActiveTab(document, expectedText, marker) {
    const fixture = document.querySelector(
      `[data-revival-tab="${marker}"][aria-selected="true"], [data-revival-subtab="${marker}"][aria-selected="true"]`
    );
    if (fixture && isVisible(fixture)) return fixture;
    return Array.from(
      document.querySelectorAll(
        '[role="tab"][aria-selected="true"], [role="tab"].active, [role="tab"].selected, .tab.active, .tab.selected'
      )
    ).find((element) => isVisible(element) && normalizeText(element.textContent) === expectedText) || null;
  }

  function findFavoritesRoot(document, activeFavoriteTab, activeNotesTab) {
    const fixture = document.querySelector('[data-revival-favorites-panel][data-active="true"]');
    if (fixture && isVisible(fixture)) return fixture;
    for (const tab of [activeNotesTab, activeFavoriteTab]) {
      const controls = tab?.getAttribute?.("aria-controls");
      if (!controls) continue;
      const controlled = document.getElementById(controls);
      if (controlled && isVisible(controlled) && controlled !== document.body) return controlled;
    }
    const candidates = Array.from(
      document.querySelectorAll(
        "[data-favorites-panel], [class*='favorite'], [class*='favorites'], [class*='collection'], [class*='collect']"
      )
    ).filter((element) => element !== document.body && isVisible(element));
    return candidates.find((element) => {
      if (findOwnPostsPanels(document).includes(element)) return false;
      return countCandidateCards(element) > 0;
    }) || null;
  }

  function findOwnPostsPanels(document) {
    return Array.from(
      document.querySelectorAll(
        "[data-revival-own-posts-panel], [data-own-posts-panel], [class*='publish-note'], [class*='user-note-list']"
      )
    );
  }

  function findScrollContainer(root) {
    const explicit = root.matches?.("[data-revival-scroll-container]")
      ? root
      : root.querySelector?.("[data-revival-scroll-container]");
    if (explicit) return explicit;
    const candidates = [root, ...Array.from(root.querySelectorAll?.("*") || [])];
    return candidates.find((element) => {
      const style = globalThis.getComputedStyle?.(element);
      const overflow = `${style?.overflowY || ""} ${style?.overflow || ""}`;
      return /(auto|scroll)/.test(overflow) && Number(element.scrollHeight) > Number(element.clientHeight);
    }) || root;
  }

  function collectCardsFromNodes(nodes, root) {
    const cards = [];
    const seen = new Set();
    for (const node of nodes) {
      if (!node || node.nodeType !== 1) continue;
      const candidates = [];
      if (isCardElement(node)) candidates.push(node);
      candidates.push(...Array.from(node.querySelectorAll?.(cardSelector()) || []));
      for (const candidate of candidates) {
        if (!root.contains(candidate) || isInsideOwnPostsPanel(candidate) || seen.has(candidate)) continue;
        seen.add(candidate);
        cards.push(candidate);
      }
    }
    return cards;
  }

  function extractFavoriteCard(card, location) {
    if (!isVisible(card) || isInsideOwnPostsPanel(card)) return null;
    const anchor = card.matches?.("a[href]") ? card : card.querySelector?.("a[href]");
    const rawSourceUrl = String(anchor?.href || card.getAttribute?.("data-source-url") || "");
    const explicitSourceId = String(card.getAttribute?.("data-source-id") || card.getAttribute?.("data-note-id") || "");
    const sourceId = explicitSourceId || extractSourceId(rawSourceUrl, location?.href);
    const canonicalSourceUrl = canonicalizeSourceUrl(rawSourceUrl, sourceId, location?.href);
    const title = normalizeText(
      card.querySelector?.("[data-title], .title, [class*='title']")?.textContent ||
      anchor?.getAttribute?.("title") ||
      card.getAttribute?.("data-title") ||
      ""
    );
    const author = normalizeText(
      card.querySelector?.("[data-author], .author, [class*='author']")?.textContent ||
      card.getAttribute?.("data-author") ||
      ""
    );
    const visibleExcerpt = normalizeText(card.innerText || card.textContent || "").slice(0, 360);
    const coverUrl = String(card.querySelector?.("img")?.currentSrc || card.querySelector?.("img")?.src || "");
    return {
      sourceId,
      rawSourceUrl,
      canonicalSourceUrl,
      title,
      author,
      coverUrl,
      visibleExcerpt,
      capturedAt: new Date().toISOString(),
      selectorVersion: SELECTOR_VERSION
    };
  }

  function extractSourceId(value, baseUrl) {
    try {
      const url = new URL(value, baseUrl);
      if (!/(^|\.)xiaohongshu\.com$/i.test(url.hostname)) return "";
      const match = url.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([a-zA-Z0-9_-]{6,80})(?:\/|$)/i);
      const queryId = url.searchParams.get("note_id") || url.searchParams.get("noteId") || url.searchParams.get("item_id");
      const candidate = match?.[1] || queryId || "";
      return /^[a-zA-Z0-9_-]{6,80}$/.test(candidate) ? candidate : "";
    } catch {
      return "";
    }
  }

  function canonicalizeSourceUrl(value, explicitSourceId, baseUrl) {
    const sourceId = explicitSourceId || extractSourceId(value, baseUrl);
    if (!sourceId) return "";
    const canonical = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(sourceId)}`);
    try {
      const input = new URL(value, baseUrl);
      for (const key of ["xsec_token", "xsec_source"]) {
        const token = input.searchParams.get(key);
        if (token) canonical.searchParams.set(key, token);
      }
    } catch {
      // The canonical URL still preserves the sourceId when the raw URL is partial.
    }
    return canonical.toString();
  }

  function findBlockingState(document) {
    const markers = [
      ["[data-revival-risk-blocker], [class*='captcha'], [class*='risk-control']", "RISK_CONTROL", "页面出现验证码或风险控制，请手动处理后继续。"],
      ["[data-revival-login-expired], [class*='login-expired']", "LOGIN_EXPIRED", "登录已过期，请在当前页面重新登录后继续。"],
      ["[data-revival-network-error], [class*='network-error']", "NETWORK_ERROR", "页面网络加载失败，扫描已安全暂停。"]
    ];
    for (const [selector, code, reason] of markers) {
      const element = Array.from(document.querySelectorAll(selector)).find(isVisible);
      if (element) return { code, reason };
    }
    return null;
  }

  function scrollFavoritesContainerToBottom(container) {
    const top = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
    if (typeof container.scrollTo === "function") container.scrollTo({ top, behavior: "auto" });
    else container.scrollTop = top;
    const EventConstructor = container.ownerDocument?.defaultView?.Event || globalThis.Event;
    if (EventConstructor && typeof container.dispatchEvent === "function") {
      container.dispatchEvent(new EventConstructor("scroll"));
    }
  }

  function readGeometry(container) {
    const scrollTop = Math.max(0, Math.round(Number(container?.scrollTop) || 0));
    const scrollHeight = Math.max(0, Math.round(Number(container?.scrollHeight) || 0));
    const clientHeight = Math.max(0, Math.round(Number(container?.clientHeight) || 0));
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      sentinel: Math.max(0, scrollHeight - scrollTop - clientHeight),
      reachedBottom: scrollTop + clientHeight >= scrollHeight - 2
    };
  }

  function isLoading(root) {
    return Array.from(
      root.querySelectorAll?.('[data-revival-loading="true"], [aria-busy="true"], .loading, [class*="loading"]') || []
    ).some(isVisible);
  }

  function hasVisibleLoadMore(root) {
    return Array.from(root.querySelectorAll?.("button, [role='button']") || []).some((element) => {
      return isVisible(element) && /继续加载|加载更多|load more/i.test(normalizeText(element.textContent));
    });
  }

  function countCandidateCards(root) {
    return root.querySelectorAll?.(cardSelector()).length || 0;
  }

  function cardSelector() {
    return "[data-revival-note-card], [data-note-id], article:has(a[href*='/explore/']), article:has(a[href*='/discovery/item/'])";
  }

  function isCardElement(element) {
    try {
      return element.matches?.(cardSelector()) === true;
    } catch {
      return element.hasAttribute?.("data-revival-note-card") || element.hasAttribute?.("data-note-id");
    }
  }

  function isInsideOwnPostsPanel(element) {
    return Boolean(
      element.closest?.(
        "[data-revival-own-posts-panel], [data-own-posts-panel], [class*='publish-note'], [class*='user-note-list']"
      )
    );
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (element.closest?.("[hidden], [aria-hidden='true']")) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }

  function rejected(code, reason) {
    return { ok: false, code, reason };
  }

  function normalizeText(value) {
    return String(value || "").normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }

  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function describeElement(element) {
    if (!element) return "none";
    const id = element.id ? `#${element.id}` : "";
    const classes = String(element.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    return `${String(element.tagName || "").toLowerCase()}${id}${classes ? `.${classes}` : ""}`;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  globalThis.CollectionRevivalFullScanCore = {
    ACTIVITY_GUARD_MS,
    FullScanController,
    PERSIST_BATCH_SIZE,
    RECENT_LIMIT,
    REQUIRED_STABLE_CYCLES,
    SELECTOR_VERSION,
    canonicalizeSourceUrl,
    collectCardsFromNodes,
    extractFavoriteCard,
    extractSourceId,
    findBlockingState,
    inspectFavoritesPage,
    readGeometry,
    stableHash
  };
})();
