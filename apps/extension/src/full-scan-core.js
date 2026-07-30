(() => {
  const SELECTOR_VERSION = "m0-real-favorites-v3";
  const REQUIRED_STABLE_CYCLES = 5;
  const PERSIST_BATCH_SIZE = 25;
  const RECENT_LIMIT = 12;
  const ACTIVITY_QUIET_MS = 360;
  const ACTIVITY_GUARD_MS = 12000;

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

      const resumed = options.resume !== false && this.session.status !== "ready";
      this.session = await this.updateSession({
        status: "scanning",
        lastErrorCode: "",
        lastErrorMessage: "",
        resumeCount: Number(this.session.resumeCount || 0) + (resumed ? 1 : 0)
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
        scrollMode: this.scrollContainer === this.document.scrollingElement ? "window" : "element",
        scrollContainerIsInsideFavoritesRoot: Boolean(
          this.root && this.scrollContainer && (
            this.scrollContainer === this.document.scrollingElement ||
            this.root === this.scrollContainer ||
            this.root.contains(this.scrollContainer)
          )
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
      const quietWindow = this.testMode ? 24 : ACTIVITY_QUIET_MS;
      const guardWindow = this.testMode ? 1200 : ACTIVITY_GUARD_MS;
      const minimumWindow = this.testMode ? 24 : 180;
      const tick = this.testMode ? 8 : 80;
      while (Date.now() - startedAt < guardWindow) {
        const elapsed = Date.now() - startedAt;
        const quietFor = Date.now() - this.lastMutationAt;
        const sawActivity = this.activityVersion !== startingVersion;
        if (!isLoading(this.root) && quietFor >= quietWindow && (sawActivity || elapsed >= minimumWindow)) return;
        await wait(tick);
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
        completedAt: new Date().toISOString(),
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
    if (!["xiaohongshu.com", "www.xiaohongshu.com"].includes(hostname)) {
      return rejected("HOST_NOT_XHS", "当前页面不是小红书官方页面。");
    }
    const pathname = String(location?.pathname || "");
    const profileMatch = pathname.match(/^\/user\/profile\/([a-zA-Z0-9_-]{6,80})\/?$/i);
    if (!profileMatch) return rejected("NOT_PROFILE_PAGE", "当前页面不是本人 profile 页面。");
    const profileId = profileMatch[1];
    const ownProfile = confirmOwnProfile(document, profileId, location);
    const profileDiagnostics = ownProfile.diagnostics;
    const rejectProfilePage = (code, reason) => rejected(code, reason, profileDiagnostics);
    if (!ownProfile.confirmed) {
      const reason = profileDiagnostics.selfProfileLinkFound
        ? "已找到 self-profile link，但链接中的 profileId 与当前 URL 不一致。为避免扫描其他用户主页，本次未开始扫描。"
        : "未找到可可靠校验 profileId 的 self-profile link。为避免扫描其他用户主页，本次未开始扫描。";
      return rejectProfilePage("OWN_PROFILE_UNCONFIRMED", reason);
    }

    const params = new URLSearchParams(String(location?.search || ""));
    const tab = String(params.get("tab") || "").toLowerCase();
    if (!["fav", "favorite", "favorites", "collect", "collection"].includes(tab)) {
      return rejectProfilePage("FAVORITES_ROUTE_UNCONFIRMED", "URL 未明确表示收藏页。为避免导入本人发布内容，本次未开始扫描。");
    }

    const activeFavoriteTab = findVisibleActiveTab(document, "收藏", "favorites");
    if (!activeFavoriteTab) return rejectProfilePage("FAVORITES_TAB_UNCONFIRMED", "未确认可见激活主 tab 为“收藏”。");
    const activeNotesTab = findVisibleActiveTab(document, "笔记", "notes");
    if (!activeNotesTab) return rejectProfilePage("NOTES_TAB_UNCONFIRMED", "未确认可见激活子 tab 为“笔记”。");

    const root = findFavoritesRoot(document, activeFavoriteTab, activeNotesTab);
    if (!root || root === document.body || !isVisible(root)) {
      return rejectProfilePage("FAVORITES_PANEL_NOT_FOUND", "未能严格定位可见收藏面板；禁止退回 document.body 扫描。");
    }
    const ownPostsPanels = findOwnPostsPanels(document);
    const likesPanels = findLikesPanels(document);
    if ([...ownPostsPanels, ...likesPanels].some((panel) => root === panel || root.contains(panel))) {
      return rejectProfilePage("EXCLUDED_PANEL_INSIDE_ROOT", "本人发布或点赞面板位于扫描 root 内，本次未开始扫描。");
    }

    const scrollContainer = findScrollContainer(document, root);
    if (!scrollContainer) return rejectProfilePage("SCROLL_CONTAINER_UNCONFIRMED", "未能动态确认收藏面板的真实滚动容器。");
    const blocker = findBlockingState(document);
    if (blocker) return rejectProfilePage(blocker.code, blocker.reason);

    const profileIdHash = stableHash(profileId);
    return {
      ok: true,
      root,
      scrollContainer,
      identity: {
        profileIdHash,
        favoritesPageIdentity: `${hostname}|${pathname}|tab=favorites|subtab=notes|profile=${profileIdHash}`,
        selectorVersion: SELECTOR_VERSION,
        extensionVersion: globalThis.chrome?.runtime?.getManifest?.().version_name || globalThis.chrome?.runtime?.getManifest?.().version || "0.3.0-m0-preview"
      },
      diagnostics: {
        rootSelector: describeElement(root),
        scrollSelector: scrollContainer === document.scrollingElement ? "window/document.scrollingElement" : describeElement(scrollContainer),
        scrollMode: scrollContainer === document.scrollingElement ? "window" : "element",
        ownPostsPanelCount: ownPostsPanels.length,
        likesPanelCount: likesPanels.length,
        ...profileDiagnostics,
        selectorVersion: SELECTOR_VERSION
      }
    };
  }

  function confirmOwnProfile(document, currentProfileId, location) {
    const currentUrlProfileIdHash = stableHash(currentProfileId);
    const editProfileSignalFound = findEditProfileSignal(document);
    const reliableLinks = Array.from(document.querySelectorAll("a[href]"))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        profileId: extractProfileIdFromLink(element, location),
        signal: classifySelfProfileLink(element)
      }))
      .filter((candidate) => candidate.profileId && candidate.signal);
    const matchedLink = reliableLinks.find((candidate) => candidate.profileId === currentProfileId) || null;
    return {
      confirmed: Boolean(matchedLink),
      diagnostics: {
        currentUrlProfileIdHash,
        selfProfileLinkFound: reliableLinks.length > 0,
        profileIdMatch: Boolean(matchedLink),
        selfProfileSignal: matchedLink?.signal || reliableLinks[0]?.signal || "none",
        editProfileSignalFound
      }
    };
  }

  function findEditProfileSignal(document) {
    const explicit = document.querySelector('[data-revival-own-profile="true"], [data-is-self="true"], [data-testid="profile-edit-button"]');
    if (explicit && isVisible(explicit)) return true;
    return Array.from(document.querySelectorAll("button, a, [role='button']")).some((element) => {
      const text = normalizeText(element.textContent);
      return isVisible(element) && /^(编辑资料|编辑个人资料|Edit profile)$/i.test(text);
    });
  }

  function extractProfileIdFromLink(element, location) {
    try {
      const href = element.getAttribute?.("href");
      if (!href) return "";
      const base = String(location?.href || `${location?.protocol || "https:"}//${location?.hostname || "www.xiaohongshu.com"}/`);
      const url = new URL(href, base);
      if (!["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname.toLowerCase())) return "";
      return url.pathname.match(/^\/user\/profile\/([a-zA-Z0-9_-]{6,80})(?:\/|$)/i)?.[1] || "";
    } catch {
      return "";
    }
  }

  function classifySelfProfileLink(element) {
    if (element.matches?.([
      "[data-revival-self-profile-link]",
      "[data-self-profile-link]",
      "[data-is-self-profile='true']",
      "[data-testid='self-profile-link']"
    ].join(","))) return "explicit-self-profile";

    const navigation = element.closest?.([
      "nav",
      "[role='navigation']",
      "aside",
      "[class*='side-bar']",
      "[class*='sidebar']",
      "[class*='navigation']"
    ].join(","));
    if (!navigation || !isVisible(navigation)) return "";

    const text = normalizeText(element.textContent);
    const accessibleName = normalizeText([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title")
    ].filter(Boolean).join(" "));
    if (/^(我|我的主页|个人主页|Me|My profile)$/i.test(text) || /^(我的主页|当前账号|个人主页|Me|My profile)$/i.test(accessibleName)) {
      return "navigation-self-profile";
    }

    const avatar = element.querySelector?.("img, [data-avatar], [class*='avatar']");
    const avatarName = normalizeText([
      accessibleName,
      avatar?.getAttribute?.("alt"),
      avatar?.getAttribute?.("aria-label"),
      avatar?.getAttribute?.("title"),
      avatar?.className
    ].filter(Boolean).join(" "));
    return avatar && /(我的头像|当前账号|头像|avatar|my profile)/i.test(avatarName)
      ? "navigation-account-avatar"
      : "";
  }

  function findVisibleActiveTab(document, expectedText, marker) {
    const fixture = document.querySelector(
      `[data-revival-tab="${marker}"][aria-selected="true"], [data-revival-subtab="${marker}"][aria-selected="true"]`
    );
    if (fixture && isVisible(fixture)) return fixture;
    const selectors = [
      '[role="tab"][aria-selected="true"]',
      '[role="tab"][aria-current="page"]',
      '[role="tab"].active',
      '[role="tab"].selected',
      '[class*="tab"].active',
      '[class*="tab"].selected',
      '[class*="tab"][class*="active"]',
      '[class*="tab"][data-state="active"]'
    ];
    return Array.from(document.querySelectorAll(selectors.join(","))).find((element) => {
      return isVisible(element) && normalizeText(element.textContent) === expectedText;
    }) || null;
  }

  function findFavoritesRoot(document, activeFavoriteTab, activeNotesTab) {
    const fixture = document.querySelector('[data-revival-favorites-panel][data-active="true"]');
    if (fixture && isVisible(fixture)) return fixture;
    for (const tab of [activeNotesTab, activeFavoriteTab]) {
      const controls = tab?.getAttribute?.("aria-controls");
      if (!controls) continue;
      const controlled = document.getElementById(controls);
      if (controlled && controlled !== document.body && isVisible(controlled) && !isInsideExcludedPanel(controlled)) return controlled;
    }
    const candidates = Array.from(document.querySelectorAll([
      '[role="tabpanel"]',
      '[data-favorites-panel]',
      '[data-tab="favorites"]',
      '[class*="favorite"][class*="panel"]',
      '[class*="collect"][class*="panel"]',
      '[class*="note-list"]',
      '[class*="feeds-container"]',
      '#user-favorites'
    ].join(","))).filter((element) => {
      if (element === document.body || !isVisible(element) || isInsideExcludedPanel(element)) return false;
      return countCandidateCards(element) > 0 || /暂无收藏|还没有收藏|没有收藏/.test(normalizeText(element.textContent));
    });
    return candidates.find((element) => {
      const label = `${element.className || ""} ${element.getAttribute?.("aria-label") || ""}`;
      if (/favorite|collect|收藏/i.test(label)) return true;
      let ancestor = activeNotesTab?.parentElement || null;
      for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.contains(element) && ancestor.contains(activeFavoriteTab)) return true;
      }
      return false;
    }) || null;
  }

  function findOwnPostsPanels(document) {
    return Array.from(document.querySelectorAll([
      "[data-revival-own-posts-panel]",
      "[data-own-posts-panel]",
      "[class*='publish-note']",
      "[class*='user-note-list'][aria-hidden='true']"
    ].join(",")));
  }

  function findLikesPanels(document) {
    const explicit = Array.from(document.querySelectorAll("[data-revival-likes-panel], [data-likes-panel], [class*='likes-panel']"));
    const labelled = Array.from(document.querySelectorAll('[role="tabpanel"], section')).filter((element) => {
      return normalizeText(element.getAttribute?.("aria-label") || "") === "点赞";
    });
    return [...new Set([...explicit, ...labelled])];
  }

  function findScrollContainer(document, root) {
    const explicit = root.matches?.("[data-revival-scroll-container]")
      ? root
      : root.querySelector?.("[data-revival-scroll-container]");
    if (explicit && isVisible(explicit)) return explicit;
    const candidates = [root, ...Array.from(root.querySelectorAll?.("*") || [])];
    const internal = candidates.find((element) => {
      const style = globalThis.getComputedStyle?.(element);
      const overflow = `${style?.overflowY || ""} ${style?.overflow || ""}`;
      return /(auto|scroll)/.test(overflow) && Number(element.scrollHeight) > Number(element.clientHeight) + 2;
    });
    if (internal) return internal;
    const scrollingElement = document.scrollingElement || document.documentElement;
    if (!scrollingElement || scrollingElement === document.body) return null;
    const pageCanScroll = Number(scrollingElement.scrollHeight) > Number(scrollingElement.clientHeight) + 2;
    return pageCanScroll && root.getBoundingClientRect?.() ? scrollingElement : null;
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
        if (!root.contains(candidate) || !isVisible(candidate) || isInsideExcludedPanel(candidate) || seen.has(candidate)) continue;
        seen.add(candidate);
        cards.push(candidate);
      }
    }
    return cards;
  }

  function extractFavoriteCard(card, location) {
    if (!isVisible(card) || isInsideExcludedPanel(card)) return null;
    const anchors = card.matches?.("a[href]") ? [card] : Array.from(card.querySelectorAll?.("a[href]") || []);
    const anchor = anchors.find((entry) => extractSourceId(entry.href, location?.href)) || null;
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
    if (document.defaultView?.navigator?.onLine === false) {
      return { code: "NETWORK_OFFLINE", reason: "浏览器当前离线，扫描已安全暂停。" };
    }
    const markers = [
      ["[data-revival-risk-blocker], [class*='captcha'], [class*='risk-control'], [id*='captcha']", "RISK_CONTROL", "页面出现验证码或风险控制，请手动处理后点击继续。"],
      ["[data-revival-login-expired], [class*='login-expired']", "LOGIN_EXPIRED", "登录已失效，请重新登录后点击继续。"],
      ["[data-revival-network-error], [class*='network-error']", "NETWORK_ERROR", "页面网络加载失败，扫描已安全暂停。"]
    ];
    for (const [selector, code, reason] of markers) {
      if (Array.from(document.querySelectorAll(selector)).some(isVisible)) return { code, reason };
    }
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [class*='modal'], [class*='overlay']")).filter(isVisible);
    for (const dialog of dialogs) {
      const text = normalizeText(dialog.textContent).slice(0, 500);
      if (/验证码|安全验证|访问频繁|风险控制|异常访问/.test(text)) return { code: "RISK_CONTROL", reason: "页面出现验证码或风险控制，请手动处理后点击继续。" };
      if (/登录已失效|重新登录/.test(text)) return { code: "LOGIN_EXPIRED", reason: "登录已失效，请重新登录后点击继续。" };
      if (/网络.*失败|加载失败|请求失败/.test(text)) return { code: "NETWORK_ERROR", reason: "页面网络加载失败，扫描已安全暂停。" };
    }
    return null;
  }

  function scrollFavoritesContainerToBottom(container) {
    const current = Math.max(0, Number(container.scrollTop) || 0);
    const maximum = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
    const step = Math.max(360, Math.round((Number(container.clientHeight) || 440) * 0.82));
    const top = Math.min(maximum, current + step);
    const view = container.ownerDocument?.defaultView;
    if (container === container.ownerDocument?.scrollingElement && typeof view?.scrollTo === "function") {
      view.scrollTo({ top, behavior: "auto" });
    } else if (typeof container.scrollTo === "function") container.scrollTo({ top, behavior: "auto" });
    else container.scrollTop = top;
    const EventConstructor = view?.Event || globalThis.Event;
    if (EventConstructor && typeof container.dispatchEvent === "function") container.dispatchEvent(new EventConstructor("scroll"));
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
    return [
      "[data-revival-note-card]",
      "[data-note-id]",
      "article:has(a[href*='/explore/'])",
      "article:has(a[href*='/discovery/item/'])",
      "[class*='note-item']:has(a[href*='/explore/'])",
      "[class*='note-card']:has(a[href*='/explore/'])"
    ].join(",");
  }

  function isCardElement(element) {
    try {
      return element.matches?.(cardSelector()) === true;
    } catch {
      return element.hasAttribute?.("data-revival-note-card") || element.hasAttribute?.("data-note-id");
    }
  }

  function isInsideExcludedPanel(element) {
    return Boolean(element.closest?.([
      "[data-revival-own-posts-panel]",
      "[data-own-posts-panel]",
      "[data-revival-likes-panel]",
      "[data-likes-panel]",
      "[class*='publish-note']",
      "[class*='likes-panel']"
    ].join(",")));
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (element.closest?.("[hidden], [aria-hidden='true'], [inert]")) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }

  function rejected(code, reason, diagnostics) {
    return { ok: false, code, reason, ...(diagnostics ? { diagnostics } : {}) };
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
