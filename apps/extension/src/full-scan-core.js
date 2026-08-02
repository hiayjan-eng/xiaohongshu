(() => {
  const SELECTOR_VERSION = "m0-real-favorites-v6";
  const REQUIRED_STABLE_CYCLES = 5;
  const PERSIST_BATCH_SIZE = 25;
  const RECENT_LIMIT = 12;
  const ACTIVITY_QUIET_MS = 360;
  const ACTIVITY_GUARD_MS = 12000;
  const END_CONFIRMATION_PROBES = 3;

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
      this.endCandidateCycles = 0;
      this.debugPauseAfter = 0;
      this.rootRebindCount = 0;
      this.scrollContainerSwitchCount = 0;
      this.observerMutationCount = 0;
      this.observerAddedNodeCount = 0;
      this.fallbackScrollAttempts = 0;
      this.endConfirmationAttempts = 0;
      this.lastEndProof = "";
      this.hasPersistedBatch = false;
      this.contaminationPromise = null;
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
      if (["contaminated", "discarded", "invalid"].includes(this.session.status)) {
        return { ok: false, error: "当前扫描会话已因边界污染被隔离，必须先丢弃本轮错误会话。", session: this.session };
      }
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
      if (this.session?.status === "contaminated") {
        return { ok: false, error: this.session.lastErrorMessage || "扫描边界失效，本轮会话已隔离。", session: this.session };
      }
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
      const pageScrollContainer = this.document.scrollingElement || this.document.documentElement;
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
        rootSelector: describeElement(this.root),
        rootConnected: Boolean(this.root?.isConnected),
        scrollGeometry: readGeometry(this.scrollContainer),
        pageScrollGeometry: readGeometry(pageScrollContainer),
        loadingInsideRoot: isLoading(this.root),
        loadingAnywhereOnPage: isLoading(this.document),
        rootRebindCount: this.rootRebindCount,
        scrollContainerSwitchCount: this.scrollContainerSwitchCount,
        observerMutationCount: this.observerMutationCount,
        observerAddedNodeCount: this.observerAddedNodeCount,
        fallbackScrollAttempts: this.fallbackScrollAttempts,
        endConfirmationAttempts: this.endConfirmationAttempts,
        endCandidateCycles: this.endCandidateCycles,
        lastEndProof: this.lastEndProof,
        selectorVersion: SELECTOR_VERSION
      };
    }

    installObserver() {
      this.observer?.disconnect();
      this.observer = new this.MutationObserver((records) => {
        this.lastMutationAt = Date.now();
        this.activityVersion += 1;
        this.observerMutationCount += records.length;
        const addedNodes = records.flatMap((record) => Array.from(record.addedNodes || []));
        this.observerAddedNodeCount += addedNodes.length;
        if (addedNodes.length) void this.captureFromNodes(addedNodes);
      });
      this.observer.observe(this.root, { childList: true, subtree: true });
    }

    async syncPageBindings() {
      const inspection = this.inspectPage();
      if (!inspection.ok) return { ok: false, code: inspection.code, reason: inspection.reason };
      if (inspection.identity.favoritesPageIdentity !== this.session?.favoritesPageIdentity) {
        return { ok: false, code: "PAGE_IDENTITY_CHANGED", reason: "账号或收藏页身份已变化，旧会话未自动继续。" };
      }
      const rootChanged = !this.root?.isConnected || inspection.root !== this.root;
      const scrollChanged = inspection.scrollContainer !== this.scrollContainer;
      if (rootChanged || scrollChanged) {
        this.root = inspection.root;
        this.scrollContainer = inspection.scrollContainer;
        if (rootChanged) this.rootRebindCount += 1;
        if (scrollChanged) this.scrollContainerSwitchCount += 1;
        this.installObserver();
        this.lastMutationAt = Date.now();
        this.activityVersion += 1;
      }
      if (rootChanged) await this.captureFromNodes([this.root]);
      return { ok: true, rootChanged, scrollChanged };
    }

    restoreScrollCheckpoint() {
      const checkpoint = Math.max(0, Number(this.session?.lastScrollTop) || 0);
      if (!checkpoint || !this.scrollContainer) return;
      const maximum = Math.max(0, this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight);
      this.scrollContainer.scrollTop = Math.min(checkpoint, maximum);
    }

    async captureFromNodes(nodes) {
      if (!this.session || this.session.status !== "scanning") return;
      const boundary = this.validateCaptureBoundary();
      if (!boundary.ok) {
        await this.contaminateSession(boundary.code, boundary.reason);
        return;
      }
      const cards = collectCardsFromNodes(nodes, this.root);
      if (!cards.length) return;
      if (!this.hasPersistedBatch && isClearlyOwnPostsRoot(this.root, cards)) {
        await this.contaminateSession(
          "FIRST_BATCH_OWN_POSTS_DETECTED",
          "首批卡片来自本人发布面板，本轮扫描已标记为 contaminated，且未写入任何记录。"
        );
        return;
      }
      this.maxBufferedItems = Math.max(this.maxBufferedItems, cards.length);
      const extracted = cards.map((card) => extractFavoriteCard(card, this.location)).filter(Boolean);
      if (!extracted.length) return;

      this.captureQueue = this.captureQueue.then(async () => {
        for (let offset = 0; offset < extracted.length; offset += PERSIST_BATCH_SIZE) {
          if (!this.session || this.session.status !== "scanning") return;
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
          this.hasPersistedBatch = this.hasPersistedBatch || Number(this.session.validCount) > 0;
          this.recentItems = [...this.recentItems, ...(response.recentItems || [])].slice(-RECENT_LIMIT);
          this.emitProgress();
        }
      });
      await this.captureQueue;
    }

    validateCaptureBoundary() {
      const inspection = this.inspectPage();
      if (!inspection.ok) {
        return {
          ok: false,
          code: inspection.code || "FAVORITES_BOUNDARY_INVALID",
          reason: inspection.reason || "收藏面板边界已失效。"
        };
      }
      if (inspection.identity.favoritesPageIdentity !== this.session?.favoritesPageIdentity) {
        return { ok: false, code: "PAGE_IDENTITY_CHANGED", reason: "收藏页身份已变化，本轮扫描已隔离。" };
      }
      if (inspection.root !== this.root) {
        return { ok: false, code: "ACTIVE_FAVORITES_ROOT_CHANGED", reason: "当前 root 已不再属于活动收藏面板，本轮扫描已隔离。" };
      }
      return { ok: true };
    }

    async contaminateSession(code, reason) {
      if (this.contaminationPromise) return this.contaminationPromise;
      this.contaminationPromise = (async () => {
        this.stopRequested = true;
        this.running = false;
        this.observer?.disconnect();
        if (!this.session || this.session.status === "contaminated") return this.session;
        this.session = await this.updateSession({
          status: "contaminated",
          lastErrorCode: code || "FAVORITES_BOUNDARY_INVALID",
          lastErrorMessage: reason || "收藏扫描边界无法继续证明，本轮会话已隔离并禁止导入。"
        });
        this.emitProgress();
        return this.session;
      })();
      return this.contaminationPromise;
    }

    async runLoop() {
      try {
        while (!this.stopRequested && this.session?.status === "scanning") {
          const initialSync = await this.syncPageBindings();
          if (!initialSync.ok) {
            await this.pauseForUser(initialSync.code, initialSync.reason);
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
          const primarySync = await this.syncPageBindings();
          if (!primarySync.ok) {
            await this.pauseForUser(primarySync.code, primarySync.reason);
            return;
          }
          let rootChangedDuringCycle = initialSync.rootChanged || primarySync.rootChanged;
          await this.captureFromNodes([this.root]);
          await this.captureQueue;

          const pageScrollContainer = this.document.scrollingElement || this.document.documentElement;
          if (this.session.validCount === countBefore && this.scrollContainer !== pageScrollContainer && pageScrollContainer) {
            this.fallbackScrollAttempts += 1;
            scrollFavoritesContainerToBottom(pageScrollContainer);
            await this.waitForActivityToSettle();
            const fallbackSync = await this.syncPageBindings();
            if (!fallbackSync.ok) {
              await this.pauseForUser(fallbackSync.code, fallbackSync.reason);
              return;
            }
            rootChangedDuringCycle ||= fallbackSync.rootChanged;
            await this.captureFromNodes([this.root]);
            await this.captureQueue;
          }

          const loading = isLoading(this.document);
          const loadMore = hasVisibleLoadMore(this.root) || hasVisibleLoadMore(this.document);
          const blocker = findBlockingState(this.document);
          if (blocker) {
            await this.pauseForUser(blocker.code, blocker.reason);
            return;
          }

          const geometryAfter = readGeometry(this.scrollContainer);
          const noGrowth = this.session.validCount === countBefore;
          const geometryStable =
            !rootChangedDuringCycle &&
            geometryAfter.scrollHeight === geometryBefore.scrollHeight &&
            geometryAfter.sentinel === geometryBefore.sentinel;
          const reachedBottom = geometryAfter.reachedBottom;
          this.stableGeometryCycles = geometryStable ? this.stableGeometryCycles + 1 : 0;
          this.endCandidateCycles = noGrowth && reachedBottom ? this.endCandidateCycles + 1 : 0;
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
            this.endCandidateCycles >= REQUIRED_STABLE_CYCLES &&
            this.stableGeometryCycles >= REQUIRED_STABLE_CYCLES
          ) {
            const endConfirmation = await this.confirmTrueEnd();
            if (endConfirmation.proved) {
              await this.complete(endConfirmation.proof);
              return;
            }
            if (endConfirmation.grew) {
              this.stableGeometryCycles = 0;
              this.endCandidateCycles = 0;
              this.session = await this.updateSession({ ...this.readCheckpoint(), stableNoGrowthCycles: 0 });
              this.emitProgress();
              continue;
            }
            await this.pauseForUser("END_NOT_PROVEN", endConfirmation.reason || "无法证明已到达真实收藏列表末尾，扫描保持为未完成。请稍后继续。");
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

    async waitForActivityToSettle(options = {}) {
      const startedAt = Date.now();
      const startingVersion = this.activityVersion;
      const endProbe = options.endProbe === true;
      const quietWindow = this.testMode ? 24 : endProbe ? 800 : ACTIVITY_QUIET_MS;
      const guardWindow = this.testMode ? 1600 : endProbe ? 15000 : ACTIVITY_GUARD_MS;
      const minimumWindow = this.testMode ? (endProbe ? 140 : 24) : endProbe ? 5000 : 180;
      const tick = this.testMode ? 8 : 80;
      while (Date.now() - startedAt < guardWindow) {
        const elapsed = Date.now() - startedAt;
        const quietFor = Date.now() - this.lastMutationAt;
        const sawActivity = this.activityVersion !== startingVersion;
        if (!isLoading(this.document) && quietFor >= quietWindow && (sawActivity || elapsed >= minimumWindow)) {
          return { timedOut: false, sawActivity, elapsed };
        }
        await wait(tick);
      }
      return { timedOut: true, sawActivity: this.activityVersion !== startingVersion, elapsed: Date.now() - startedAt };
    }

    async confirmTrueEnd() {
      this.endConfirmationAttempts += 1;
      let stableProbes = 0;
      for (let phase = 0; phase < END_CONFIRMATION_PROBES; phase += 1) {
        const beforeSync = await this.syncPageBindings();
        if (!beforeSync.ok) return { proved: false, grew: false, reason: beforeSync.reason };
        const countBefore = Number(this.session.validCount) || 0;
        const primaryBefore = readGeometry(this.scrollContainer);
        const pageScrollContainer = this.document.scrollingElement || this.document.documentElement;
        const pageBefore = readGeometry(pageScrollContainer);

        if (phase === 1) {
          pullBackScrollContainer(this.scrollContainer);
          if (pageScrollContainer && pageScrollContainer !== this.scrollContainer) pullBackScrollContainer(pageScrollContainer);
          await wait(this.testMode ? 16 : 180);
        }
        scrollFavoritesContainerToBottom(this.scrollContainer);
        if (pageScrollContainer && pageScrollContainer !== this.scrollContainer) {
          this.fallbackScrollAttempts += 1;
          scrollFavoritesContainerToBottom(pageScrollContainer);
        }
        if (phase > 0) {
          scrollFavoritesContainerToEnd(this.scrollContainer);
          if (pageScrollContainer && pageScrollContainer !== this.scrollContainer) scrollFavoritesContainerToEnd(pageScrollContainer);
        }

        const settle = await this.waitForActivityToSettle({ endProbe: true });
        const afterSync = await this.syncPageBindings();
        if (!afterSync.ok) return { proved: false, grew: false, reason: afterSync.reason };
        await this.captureFromNodes([this.root]);
        await this.captureQueue;

        const primaryAfter = readGeometry(this.scrollContainer);
        const currentPageScrollContainer = this.document.scrollingElement || this.document.documentElement;
        const pageAfter = readGeometry(currentPageScrollContainer);
        const grew =
          Number(this.session.validCount) > countBefore ||
          primaryAfter.scrollHeight > primaryBefore.scrollHeight ||
          pageAfter.scrollHeight > pageBefore.scrollHeight ||
          beforeSync.rootChanged ||
          afterSync.rootChanged;
        if (grew) return { proved: false, grew: true };

        const loading = isLoading(this.document);
        const allTargetsAtBottom = primaryAfter.reachedBottom && (
          !currentPageScrollContainer ||
          currentPageScrollContainer === this.scrollContainer ||
          pageAfter.reachedBottom
        );
        const stable = !settle.timedOut && !loading && allTargetsAtBottom;
        stableProbes = stable ? stableProbes + 1 : 0;
        if (phase >= 1 && stableProbes >= 2 && hasExplicitEndMarker(this.document, this.root)) {
          this.lastEndProof = "explicit-end-marker";
          return { proved: true, grew: false, proof: this.lastEndProof };
        }
      }
      if (stableProbes >= END_CONFIRMATION_PROBES) {
        this.lastEndProof = "multi-probe-dom-and-scroll-stability";
        return { proved: true, grew: false, proof: this.lastEndProof };
      }
      return {
        proved: false,
        grew: false,
        reason: "末尾确认期间仍存在加载、DOM 活动、root 变化或未到底的滚动容器；扫描保持为未完成。"
      };
    }

    async complete(proof = "") {
      this.lastEndProof = proof || this.lastEndProof;
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
    let boundaryDiagnostics = profileDiagnostics;
    const rejectProfilePage = (code, reason) => rejected(code, reason, boundaryDiagnostics);
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
    const notesTab = findVisibleActiveNotesTab(document);
    boundaryDiagnostics = { ...profileDiagnostics, ...notesTab.diagnostics };
    const activeNotesTab = notesTab.element;
    if (!activeNotesTab) return rejectProfilePage("NOTES_TAB_UNCONFIRMED", "未确认可见激活子 tab 为“笔记”。");

    const favoritesBoundary = findFavoritesBoundary(document, activeFavoriteTab, activeNotesTab);
    const root = favoritesBoundary?.root || null;
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
        rootAssociation: favoritesBoundary.association,
        activePanelSelector: describeElement(favoritesBoundary.panel),
        scrollSelector: scrollContainer === document.scrollingElement ? "window/document.scrollingElement" : describeElement(scrollContainer),
        scrollMode: scrollContainer === document.scrollingElement ? "window" : "element",
        ownPostsPanelCount: ownPostsPanels.length,
        likesPanelCount: likesPanels.length,
        ...boundaryDiagnostics,
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

  const PROFILE_SUBTAB_SELECTOR = [
    "[data-revival-subtab]",
    "[role='tab']",
    "[class*='tab']",
    "[class*='channel']"
  ].join(",");
  const NOTES_TAB_TEXT = /^笔记(?:\s*[·•:：-]?\s*\d+)?$/;
  const ALBUMS_TAB_TEXT = /^专辑(?:\s*[·•:：-]?\s*\d+)?$/;
  const FILES_TAB_TEXT = /^文件(?:\s*[·•:：-]?\s*\d+)?$/;
  const SUBTAB_DOM_DIAGNOSTIC_VERSION = "m0-subtab-dom-diagnostic-v1";

  function findVisibleActiveNotesTab(document) {
    const evaluated = Array.from(document.querySelectorAll(PROFILE_SUBTAB_SELECTOR))
      .filter((element) => isVisible(element) && NOTES_TAB_TEXT.test(normalizeText(element.textContent)))
      .map((element) => {
        const redsProfileState = findRedsProfileNotesState(element);
        const group = redsProfileState?.group || findProfileSubtabGroup(element);
        return {
          element,
          text: normalizeText(element.textContent),
          group,
          activeStateSource: redsProfileState?.activeStateSource || (group ? findActiveStateSource(element, group) : "none")
        };
      });
    const matched = evaluated.find((candidate) => candidate.group && candidate.activeStateSource !== "none") || null;
    const diagnosticCandidate = matched || evaluated.find((candidate) => candidate.group) || null;
    return {
      element: matched?.element || null,
      diagnostics: {
        notesTabCandidateText: diagnosticCandidate?.text || "",
        notesTabActiveStateSource: diagnosticCandidate?.activeStateSource || "none",
        notesTabMatch: Boolean(matched)
      }
    };
  }

  function collectSubtabDomDiagnostics(document) {
    const candidates = { notes: [], albums: [], files: [] };
    for (const element of Array.from(document.querySelectorAll("*"))) {
      const text = normalizeText(element.textContent);
      const kind = NOTES_TAB_TEXT.test(text)
        ? "notes"
        : ALBUMS_TAB_TEXT.test(text)
          ? "albums"
          : FILES_TAB_TEXT.test(text)
            ? "files"
            : "";
      if (!kind) continue;
      const visibility = readSubtabDiagnosticVisibility(element);
      if (!isVisible(element) || !visibility.boundingRectVisible || visibility.display === "none" || visibility.visibility === "hidden") continue;
      candidates[kind].push(describeSubtabDomCandidate(element, visibility));
    }
    return { diagnosticVersion: SUBTAB_DOM_DIAGNOSTIC_VERSION, candidates };
  }

  function describeSubtabDomCandidate(element, visibility) {
    return {
      tagName: String(element.tagName || "").toLowerCase(),
      id: sanitizeDomIdentifier(element.id),
      className: sanitizeDomClassName(element.className),
      role: sanitizeDomAttribute(element.getAttribute?.("role")),
      ariaSelected: sanitizeDomAttribute(element.getAttribute?.("aria-selected")),
      ariaCurrent: sanitizeDomAttribute(element.getAttribute?.("aria-current")),
      dataState: sanitizeDomAttribute(element.getAttribute?.("data-state")),
      hasHref: element.hasAttribute?.("href") === true,
      parent: describeSubtabDomRelative(element.parentElement),
      grandparent: describeSubtabDomRelative(element.parentElement?.parentElement),
      siblings: {
        previousClassName: sanitizeDomClassName(element.previousElementSibling?.className, 4),
        nextClassName: sanitizeDomClassName(element.nextElementSibling?.className, 4)
      },
      computed: {
        display: visibility.display,
        visibility: visibility.visibility
      },
      boundingRectVisible: visibility.boundingRectVisible,
      hasUnderline: hasSubtabUnderlineSignal(element),
      hasSelectedIcon: hasSubtabSelectedIcon(element),
      hasActiveDescendant: hasSubtabActiveDescendant(element)
    };
  }

  function findRedsProfileNotesState(element) {
    if (!hasDomShape(element, "div", ["reds-tab-item", "sub-tab-list"])) return null;
    const group = element.parentElement;
    if (!hasDomShape(group, "div", ["tertiary", "center", "reds-tabs-list"])) return null;
    if (!hasDomShape(group.parentElement, "div", ["reds-sticky"])) return null;

    const activeIndicator = element.nextElementSibling;
    if (!hasDomShape(activeIndicator, "div", ["reds-tab-item", "active", "sub-tab-list"])) return null;
    if (!isVisible(activeIndicator) || activeIndicator.getAttribute?.("aria-hidden") === "true") return null;
    const visibleIndicatorText = readVisibleElementText(activeIndicator);
    if ([NOTES_TAB_TEXT, ALBUMS_TAB_TEXT, FILES_TAB_TEXT].some((pattern) => pattern.test(visibleIndicatorText))) return null;

    return { group, activeStateSource: "adjacent-sibling-class:active" };
  }

  function readVisibleElementText(element) {
    const document = element?.ownerDocument;
    if (!document?.createTreeWalker) return "";
    const walker = document.createTreeWalker(element, globalThis.NodeFilter?.SHOW_TEXT || 4);
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = normalizeText(node.nodeValue);
      const parent = node.parentElement;
      if (!text || !parent || !isVisibleTextContainer(parent)) continue;
      parts.push(text);
    }
    return normalizeText(parts.join(" "));
  }

  function isVisibleTextContainer(element) {
    if (element.closest?.("[hidden], [aria-hidden='true'], [inert]")) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const viewportWidth = Number(globalThis.innerWidth) || Number(element.ownerDocument?.documentElement?.clientWidth) || 0;
    const viewportHeight = Number(globalThis.innerHeight) || Number(element.ownerDocument?.documentElement?.clientHeight) || 0;
    if (rect.bottom <= 0 || rect.right <= 0 || (viewportWidth && rect.left >= viewportWidth) || (viewportHeight && rect.top >= viewportHeight)) return false;
    const clipped = (style?.clip && style.clip !== "auto") || (style?.clipPath && style.clipPath !== "none") || style?.overflow === "hidden";
    return !(rect.width <= 1 && rect.height <= 1 && clipped);
  }

  function hasDomShape(element, tagName, classTokens) {
    if (String(element?.tagName || "").toLowerCase() !== tagName) return false;
    const tokens = new Set(readRawClassName(element.className).split(/\s+/).filter(Boolean));
    return classTokens.every((token) => tokens.has(token));
  }

  function describeSubtabDomRelative(element) {
    if (!element) return null;
    return {
      tagName: String(element.tagName || "").toLowerCase(),
      className: sanitizeDomClassName(element.className),
      role: sanitizeDomAttribute(element.getAttribute?.("role")),
      ariaSelected: sanitizeDomAttribute(element.getAttribute?.("aria-selected")),
      ariaCurrent: sanitizeDomAttribute(element.getAttribute?.("aria-current")),
      dataState: sanitizeDomAttribute(element.getAttribute?.("data-state"))
    };
  }

  function readSubtabDiagnosticVisibility(element) {
    const style = globalThis.getComputedStyle?.(element);
    const rect = element.getBoundingClientRect?.();
    const width = Number(rect?.width) || 0;
    const height = Number(rect?.height) || 0;
    const viewportWidth = Number(globalThis.innerWidth) || Number(element.ownerDocument?.documentElement?.clientWidth) || 0;
    const viewportHeight = Number(globalThis.innerHeight) || Number(element.ownerDocument?.documentElement?.clientHeight) || 0;
    const intersectsViewport = !rect || (
      rect.bottom > 0 && rect.right > 0 &&
      (!viewportWidth || rect.left < viewportWidth) &&
      (!viewportHeight || rect.top < viewportHeight)
    );
    return {
      display: sanitizeDomAttribute(style?.display) || "unknown",
      visibility: sanitizeDomAttribute(style?.visibility) || "unknown",
      boundingRectVisible: Boolean((!rect || (width > 0 && height > 0)) && intersectsViewport)
    };
  }

  function hasSubtabUnderlineSignal(element) {
    const nodes = [element, ...Array.from(element.querySelectorAll?.("*") || []).slice(0, 30)];
    if (nodes.some((node) => {
      const style = globalThis.getComputedStyle?.(node);
      const className = String(readRawClassName(node.className) || "");
      if (/underline|indicator|ink[-_]?bar|tab[-_]?line|active[-_]?line|selected[-_]?line/i.test(className)) return true;
      if (String(style?.textDecorationLine || "").includes("underline")) return true;
      return Number.parseFloat(style?.borderBottomWidth || "0") > 0 && style?.borderBottomStyle !== "none";
    })) return true;
    return ["::before", "::after"].some((pseudo) => {
      const style = globalThis.getComputedStyle?.(element, pseudo);
      const hasBox = Number.parseFloat(style?.height || "0") > 0 || Number.parseFloat(style?.borderBottomWidth || "0") > 0;
      return style?.display !== "none" && style?.visibility !== "hidden" && style?.content !== "none" && hasBox;
    });
  }

  function hasSubtabSelectedIcon(element) {
    return Array.from(element.querySelectorAll?.("svg, img, [class*='icon'], [data-icon]") || []).some((node) => {
      const signal = [
        readRawClassName(node.className),
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("data-state"),
        node.getAttribute?.("data-icon")
      ].filter(Boolean).join(" ");
      return isVisible(node) && /selected|active|checked|check|chosen|选中/i.test(signal);
    });
  }

  function hasSubtabActiveDescendant(element) {
    return Boolean(element.querySelector?.([
      "[aria-selected='true']",
      "[aria-current='page']",
      "[aria-current='true']",
      "[data-state='active']",
      "[data-state='selected']",
      ".active",
      ".selected",
      ".current"
    ].join(",")));
  }

  function sanitizeDomIdentifier(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    return isSensitiveDomToken(input) ? `[redacted:${stableHash(input)}]` : input.slice(0, 80);
  }

  function sanitizeDomClassName(value, limit = 10) {
    return readRawClassName(value)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, limit)
      .map((token) => isSensitiveDomToken(token) ? `[redacted:${stableHash(token)}]` : token.slice(0, 80))
      .join(" ");
  }

  function readRawClassName(value) {
    return String(typeof value === "object" && value?.baseVal !== undefined ? value.baseVal : value || "").trim();
  }

  function sanitizeDomAttribute(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    return isSensitiveDomToken(input) ? `[redacted:${stableHash(input)}]` : input.slice(0, 80);
  }

  function isSensitiveDomToken(value) {
    const input = String(value || "");
    return input.length > 80 || /(?:[a-f0-9]{16,}|\d{12,})/i.test(input) || /(?:token|profile)[-_=:]?[a-z0-9_-]{10,}/i.test(input);
  }

  function findProfileSubtabGroup(element) {
    let container = element?.parentElement || null;
    for (let depth = 0; container && depth < 5; depth += 1, container = container.parentElement) {
      if (container === element.ownerDocument?.body) break;
      const itemTexts = Array.from(container.children || []).map((child) => normalizeText(child.textContent));
      const hasNotes = itemTexts.some((text) => NOTES_TAB_TEXT.test(text));
      const hasAlbums = itemTexts.some((text) => ALBUMS_TAB_TEXT.test(text));
      const hasFiles = itemTexts.some((text) => FILES_TAB_TEXT.test(text));
      if (hasNotes && hasAlbums && hasFiles) return container;
    }
    return null;
  }

  function findActiveStateSource(element, group) {
    let current = element;
    while (current && current !== group) {
      if (current.getAttribute?.("aria-selected") === "true") return "aria-selected";
      if (["page", "true"].includes(current.getAttribute?.("aria-current"))) return "aria-current";
      if (["active", "selected", "current"].includes(String(current.getAttribute?.("data-state") || "").toLowerCase())) return "data-state";
      const className = String(current.className || "");
      const classSignal = className.match(/(?:^|\s)(active|selected|current)(?:\s|$)/i)?.[1]?.toLowerCase();
      if (classSignal) return `class:${classSignal}`;
      current = current.parentElement;
    }
    return "none";
  }

  function findFavoritesBoundary(document, activeFavoriteTab, activeNotesTab) {
    const controlledRoots = [activeNotesTab, activeFavoriteTab]
      .map((tab) => tab?.getAttribute?.("aria-controls"))
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((root) => isEligibleFavoritesRoot(root));
    const uniqueControlledRoots = [...new Set(controlledRoots)];
    if (uniqueControlledRoots.length === 1) {
      return { root: uniqueControlledRoots[0], panel: uniqueControlledRoots[0], association: "active-tabs:aria-controls" };
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
    ].join(","))).filter(isEligibleFavoritesRoot);

    const explicit = candidates.filter((element) => {
      if (!element.matches?.('[data-revival-favorites-panel][data-active="true"]')) return false;
      return isWithinSameProfileBoundary(element, activeFavoriteTab, activeNotesTab);
    });
    if (explicit.length === 1) {
      return { root: explicit[0], panel: explicit[0], association: "explicit-active-favorites-panel" };
    }

    const realPanelMatches = candidates.map((root) => {
      const panel = root.closest?.(".tab-content-item");
      const transform = panel?.parentElement;
      if (!panel || !hasClassToken(transform, "transform-container")) return null;
      if (!isActiveTransformPanel(document, panel)) return null;
      if (!isWithinSameProfileBoundary(panel, activeFavoriteTab, activeNotesTab)) return null;
      return { root, panel };
    }).filter(Boolean);
    const activePanels = [...new Set(realPanelMatches.map((match) => match.panel))];
    if (activePanels.length !== 1) return null;
    const panel = activePanels[0];
    const rootsInActivePanel = realPanelMatches
      .filter((match) => match.panel === panel)
      .map((match) => match.root)
      .filter((root, _index, roots) => !roots.some((other) => other !== root && other.contains?.(root)));
    if (rootsInActivePanel.length !== 1) return null;
    return { root: rootsInActivePanel[0], panel, association: "active-transform-tab-content" };
  }

  function isEligibleFavoritesRoot(element) {
    if (!element || element === element.ownerDocument?.body || !isVisible(element) || isInsideExcludedPanel(element)) return false;
    return countCandidateCards(element) > 0 || /暂无收藏|还没有收藏|没有收藏/.test(normalizeText(element.textContent));
  }

  function isActiveTransformPanel(document, panel) {
    if (!isVisible(panel) || isInactiveCachedPanel(panel)) return false;
    const style = globalThis.getComputedStyle?.(panel);
    const rect = panel.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 4) return false;
    const viewportWidth = Number(document.documentElement?.clientWidth) || Number(globalThis.innerWidth) || 0;
    const horizontalOverlap = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    if (viewportWidth && horizontalOverlap < Math.min(rect.width * 0.5, viewportWidth * 0.25)) return false;
    const overflow = `${style?.overflow || ""} ${style?.overflowY || ""}`;
    return /(auto|scroll)/i.test(overflow);
  }

  function isWithinSameProfileBoundary(element, activeFavoriteTab, activeNotesTab) {
    const selector = "#userPageContainer, .user-page, [data-user-page], [class*='profile-page']";
    const elementBoundary = element.closest?.(selector);
    const favoritesBoundary = activeFavoriteTab?.closest?.(selector);
    const notesBoundary = activeNotesTab?.closest?.(selector);
    return Boolean(elementBoundary && elementBoundary === favoritesBoundary && elementBoundary === notesBoundary);
  }

  function isInactiveCachedPanel(element) {
    return Boolean(element.closest?.("[hidden], [aria-hidden='true'], [inert], [data-active='false'], [data-state='inactive']"));
  }

  function hasClassToken(element, token) {
    return readRawClassName(element?.className).split(/\s+/).includes(token);
  }

  function findOwnPostsPanels(document) {
    return Array.from(document.querySelectorAll([
      "[data-revival-own-posts-panel]",
      "[data-own-posts-panel]",
      "#userPostedFeeds",
      "[class*='publish-note']",
      "[class*='user-note-list'][aria-hidden='true']"
    ].join(",")));
  }

  function findLikesPanels(document) {
    const explicit = Array.from(document.querySelectorAll("[data-revival-likes-panel], [data-likes-panel], [class*='likes-panel'], #userLikedFeeds"));
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
    setScrollContainerPosition(container, Math.min(maximum, current + step));
  }

  function scrollFavoritesContainerToEnd(container) {
    const maximum = Math.max(0, Number(container?.scrollHeight) - Number(container?.clientHeight));
    setScrollContainerPosition(container, maximum);
  }

  function pullBackScrollContainer(container) {
    const current = Math.max(0, Number(container?.scrollTop) || 0);
    const distance = Math.max(160, Math.round((Number(container?.clientHeight) || 440) * 0.36));
    setScrollContainerPosition(container, Math.max(0, current - distance));
  }

  function setScrollContainerPosition(container, top) {
    if (!container) return;
    const view = container.ownerDocument?.defaultView;
    if (container === container.ownerDocument?.scrollingElement && typeof view?.scrollTo === "function") {
      view.scrollTo({ top, behavior: "auto" });
    } else if (typeof container.scrollTo === "function") container.scrollTo({ top, behavior: "auto" });
    else container.scrollTop = top;
    const EventConstructor = view?.Event || globalThis.Event;
    if (EventConstructor && typeof container.dispatchEvent === "function") container.dispatchEvent(new EventConstructor("scroll"));
  }

  function hasExplicitEndMarker(document, root) {
    const candidates = Array.from(document?.querySelectorAll?.([
      "[data-revival-list-end='true']",
      "[data-list-end='true']",
      "[class*='no-more']",
      "[class*='nomore']",
      "[class*='end-tip']",
      "[class*='feeds-end']"
    ].join(",")) || []);
    return candidates.some((element) => {
      if (!isVisible(element) || isInsideExcludedPanel(element)) return false;
      const closeToRoot = root && (
        root.contains(element) ||
        root.parentElement?.contains(element) ||
        element.parentElement?.contains(root)
      );
      return closeToRoot && /没有更多|没有更多了|到底了|已显示全部|全部加载完成|no more/i.test(normalizeText(element.textContent));
    });
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
      root?.querySelectorAll?.('[data-revival-loading="true"], [aria-busy="true"], .loading, [class*="loading"]') || []
    ).some(isVisible);
  }

  function hasVisibleLoadMore(root) {
    return Array.from(root?.querySelectorAll?.("button, [role='button']") || []).some((element) => {
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
      "#userPostedFeeds",
      "[data-revival-likes-panel]",
      "[data-likes-panel]",
      "#userLikedFeeds",
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
    if (rect && rect.width <= 0 && rect.height <= 0) return false;
    if (!rect) return true;
    let visibleLeft = rect.left;
    let visibleRight = rect.right;
    let visibleTop = rect.top;
    let visibleBottom = rect.bottom;
    for (let ancestor = element.parentElement; ancestor && ancestor !== element.ownerDocument?.body; ancestor = ancestor.parentElement) {
      const ancestorStyle = globalThis.getComputedStyle?.(ancestor);
      const clips = /(hidden|clip|auto|scroll)/i.test(`${ancestorStyle?.overflow || ""} ${ancestorStyle?.overflowX || ""} ${ancestorStyle?.overflowY || ""}`);
      if (!clips) continue;
      const ancestorRect = ancestor.getBoundingClientRect?.();
      if (!ancestorRect) continue;
      visibleLeft = Math.max(visibleLeft, ancestorRect.left);
      visibleRight = Math.min(visibleRight, ancestorRect.right);
      visibleTop = Math.max(visibleTop, ancestorRect.top);
      visibleBottom = Math.min(visibleBottom, ancestorRect.bottom);
      if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return false;
    }
    return true;
  }

  function isClearlyOwnPostsRoot(root, cards) {
    if (!root || !cards.length) return false;
    if (root.matches?.("#userPostedFeeds, [data-revival-own-posts-panel], [data-own-posts-panel], [class*='publish-note']")) return true;
    return cards.every((card) => Boolean(card.closest?.("#userPostedFeeds, [data-revival-own-posts-panel], [data-own-posts-panel], [class*='publish-note']")));
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
    collectSubtabDomDiagnostics,
    collectCardsFromNodes,
    extractFavoriteCard,
    extractSourceId,
    findBlockingState,
    inspectFavoritesPage,
    readGeometry,
    stableHash
  };
})();
