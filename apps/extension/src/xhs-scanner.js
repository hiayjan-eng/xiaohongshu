(() => {
  if (window.__collectionRevivalScannerInstalled) return;
  window.__collectionRevivalScannerInstalled = true;

  const SCAN_STATE_KEY = "revival-extension-scan-state";
  const CHECKPOINT_KEY = "revival-extension-checkpoint";
  const SELECTOR_VERSION = "xhs-fav-visible-cards-v4";
  const STAGES = {
    recognizing: "识别页面",
    loading: "加载收藏",
    extracting: "提取卡片",
    deduping: "清理去重",
    complete: "扫描完成"
  };

  const runtime = {
    scanLoopRunning: false,
    stopRequested: false,
    state: createEmptyState()
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "REVIVAL_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "REVIVAL_GET_PAGE_STATUS") {
      sendResponse({ ok: true, ...getPageStatus() });
      return false;
    }

    if (message?.type === "REVIVAL_GET_SCAN_STATE") {
      (async () => {
        await hydrateState();
        sendResponse({ ok: true, scanState: runtime.state });
      })();
      return true;
    }

    if (message?.type === "REVIVAL_CLEAR_SCAN_STATE") {
      (async () => {
        runtime.stopRequested = true;
        runtime.scanLoopRunning = false;
        runtime.state = createEmptyState();
        await chrome.storage.local.remove([SCAN_STATE_KEY, CHECKPOINT_KEY]);
        sendResponse({ ok: true, scanState: runtime.state });
      })();
      return true;
    }

    if (message?.type === "REVIVAL_PAUSE_SCAN") {
      (async () => {
        await hydrateState();
        runtime.stopRequested = true;
        runtime.state = {
          ...runtime.state,
          status: "paused",
          stage: "loading",
          message: `已暂停，当前保留 ${runtime.state.items.length} 条候选收藏。`,
          updatedAt: new Date().toISOString()
        };
        await persistState();
        sendResponse({ ok: true, scanState: runtime.state });
      })();
      return true;
    }

    if (message?.type === "REVIVAL_RESUME_SCAN") {
      (async () => {
        await hydrateState();
        runtime.stopRequested = false;
        runtime.state = {
          ...runtime.state,
          status: "scanning",
          stage: "loading",
          message: "已继续扫描旧收藏。",
          updatedAt: new Date().toISOString()
        };
        await persistState();
        runScanLoop(runtime.state.autoScroll !== false);
        sendResponse({ ok: true, scanState: runtime.state });
      })();
      return true;
    }

    if (message?.type === "REVIVAL_SCAN_VISIBLE" || message?.type === "REVIVAL_SCAN_STEP") {
      (async () => {
        try {
          await hydrateState();
          const pageStatus = getPageStatus();
          if (pageStatus.blocked || !pageStatus.looksCollection) {
            sendResponse({ ok: false, error: pageStatus.reason || "当前页面还不能确认是收藏标签。请先进入「我」→「收藏」。", scanState: runtime.state, pageStatus });
            return;
          }
          await scanOnce(false);
          runtime.state.status = "completed";
          runtime.state.stage = "complete";
          runtime.state.message = `已扫描当前可见卡片，共发现 ${runtime.state.items.length} 条。`;
          await persistState();
          sendResponse({ ok: true, items: runtime.state.items, scanState: runtime.state, pageStatus: getPageStatus(), pageUrl: window.location.href });
        } catch (error) {
          await failScan(error);
          sendResponse({ ok: false, error: toErrorMessage(error), scanState: runtime.state });
        }
      })();
      return true;
    }

    if (message?.type === "REVIVAL_START_SCAN") {
      (async () => {
        try {
          const pageStatus = getPageStatus();
          if (pageStatus.blocked) {
            sendResponse({ ok: false, error: pageStatus.reason, scanState: runtime.state, pageStatus });
            return;
          }
          if (!pageStatus.looksCollection) {
            sendResponse({ ok: false, error: "当前页面还不能确认是收藏标签。请先打开本人小红书主页的“收藏”标签，再开始扫描。", scanState: runtime.state, pageStatus });
            return;
          }
          runtime.stopRequested = false;
          runtime.state = {
            ...createEmptyState(),
            status: "scanning",
            stage: "recognizing",
            mode: "limit",
            limit: Math.max(10, Math.min(20, Number.isFinite(message.limit) ? Number(message.limit) : 20)),
            autoScroll: message.autoScroll !== false,
            pageUrl: window.location.href,
            pageStatus,
            message: "正在识别收藏区域...",
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await persistState();
          runScanLoop(runtime.state.autoScroll);
          sendResponse({ ok: true, scanState: runtime.state, pageStatus });
        } catch (error) {
          await failScan(error);
          sendResponse({ ok: false, error: toErrorMessage(error), scanState: runtime.state });
        }
      })();
      return true;
    }

    return false;
  });

  function createEmptyState() {
    return {
      status: "idle",
      stage: "recognizing",
      $110,
      autoScroll: true,
      batch: 0,
      lastAdded: 0,
      noNewRounds: 0,
      duplicateCount: 0,
      missingLinkCount: 0,
      missingTitleCount: 0,
      totalFound: 0,
      selectedCount: 0,
      items: [],
      selectedKeys: [],
      milestones: [],
      pageUrl: window.location.href,
      message: "等待扫描",
      updatedAt: new Date().toISOString(),
      selectorVersion: SELECTOR_VERSION
    };
  }

  async function hydrateState() {
    const stored = await chrome.storage.local.get(SCAN_STATE_KEY);
    if (stored[SCAN_STATE_KEY]) {
      runtime.state = { ...createEmptyState(), ...stored[SCAN_STATE_KEY] };
    }
  }

  async function persistState() {
    const selectedSet = new Set(runtime.state.selectedKeys || []);
    runtime.state.items
      .filter((item) => !item.isDuplicate)
      .map(itemKey)
      .filter(Boolean)
      .forEach((key) => selectedSet.add(key));
    const selectedKeys = [...selectedSet];
    runtime.state = {
      ...runtime.state,
      totalFound: runtime.state.items.length,
      selectedCount: selectedKeys.length,
      selectedKeys,
      missingLinkCount: runtime.state.items.filter((item) => item.isMissingLink).length,
      missingTitleCount: runtime.state.items.filter((item) => item.isMissingTitle).length,
      updatedAt: new Date().toISOString(),
      selectorVersion: SELECTOR_VERSION
    };
    await chrome.storage.local.set({
      [SCAN_STATE_KEY]: runtime.state,
      [CHECKPOINT_KEY]: {
        items: runtime.state.items,
        selectedKeys,
        duplicateCount: runtime.state.duplicateCount,
        pageUrl: runtime.state.pageUrl,
        savedAt: runtime.state.updatedAt
      }
    });
  }

  async function runScanLoop(autoScroll) {
    if (runtime.scanLoopRunning) return;
    runtime.scanLoopRunning = true;

    try {
      while (!runtime.stopRequested && runtime.state.status === "scanning") {
        const pageStatus = getPageStatus();
        if (pageStatus.blocked) {
          runtime.state.status = "error";
          runtime.state.stage = "error";
          runtime.state.error = pageStatus.reason;
          runtime.state.message = pageStatus.reason;
          await persistState();
          break;
        }

        runtime.state.stage = runtime.state.batch === 0 ? "recognizing" : "loading";
        runtime.state.pageStatus = pageStatus;
        runtime.state.pageUrl = window.location.href;
        runtime.state.message = runtime.state.batch === 0 ? "正在识别收藏区域..." : `正在向下加载更多收藏，第 ${runtime.state.batch + 1} 批。`;
        await persistState();

        if (autoScroll && runtime.state.batch > 0) await scrollOneStep(620);
        await scanOnce(false);

        if (runtime.state.limit && runtime.state.items.filter((item) => !item.isDuplicate && !item.isMissingLink).length >= runtime.state.limit) {
          runtime.state.items = trimToLimit(runtime.state.items, runtime.state.limit);
          await completeScan(`本轮扫描完成，共发现 ${runtime.state.items.length} 条收藏。`);
          break;
        }

        const reachedEnd = isNearPageEnd();
        if (!autoScroll || reachedEnd || runtime.state.noNewRounds >= 4) {
          const reason = runtime.state.noNewRounds >= 4 ? "连续多轮没有新增内容，扫描完成。" : "扫描完成。";
          await completeScan(`${reason} 共发现 ${runtime.state.items.length} 条收藏。`);
          break;
        }

        await wait(520);
      }
    } catch (error) {
      await failScan(error);
    } finally {
      runtime.scanLoopRunning = false;
    }
  }

  async function scanOnce(shouldScroll) {
    if (shouldScroll) await scrollOneStep(620);
    runtime.state.stage = "extracting";
    runtime.state.message = "正在读取当前页面卡片...";
    await persistState();

    const beforeCount = runtime.state.items.filter((item) => !item.isDuplicate).length;
    const scanResult = scanVisibleXhsCards();
    runtime.state.stage = "deduping";
    mergeItems(scanResult.items);
    const afterCount = runtime.state.items.filter((item) => !item.isDuplicate).length;
    const added = Math.max(0, afterCount - beforeCount);
    runtime.state.lastAdded = added;
    runtime.state.batch += 1;
    runtime.state.noNewRounds = added === 0 ? runtime.state.noNewRounds + 1 : 0;
    runtime.state.pageStatus = scanResult.pageStatus;
    runtime.state.diagnostics = scanResult.pageStatus.diagnostics;
    runtime.state.message = added > 0
      ? `本轮新增 ${added} 条，已发现 ${runtime.state.items.length} 条。`
      : `本轮没有新增，已发现 ${runtime.state.items.length} 条。`;
    runtime.state.milestones = updateMilestones(runtime.state.milestones, afterCount);
    await persistState();
  }

  function mergeItems(nextItems) {
    const existingKeys = new Set(runtime.state.items.filter((item) => !item.isDuplicate).map(itemKey));
    const merged = [...runtime.state.items];

    for (const rawItem of nextItems) {
      const key = itemKey(rawItem);
      if (!key) continue;
      if (existingKeys.has(key)) {
        runtime.state.duplicateCount += 1;
        merged.push({ ...rawItem, scanKey: `${key}|duplicate|${runtime.state.duplicateCount}`, isDuplicate: true });
      } else {
        existingKeys.add(key);
        merged.push({ ...rawItem, scanKey: key, isDuplicate: false });
      }
    }

    runtime.state.items = merged;
  }

  function trimToLimit(items, limit) {
    let accepted = 0;
    return items.filter((item) => {
      if (item.isDuplicate || item.isMissingLink) return true;
      accepted += 1;
      return accepted <= limit;
    });
  }

  async function completeScan(message) {
    runtime.state.status = "completed";
    runtime.state.stage = "complete";
    runtime.state.message = runtime.state.items.length === 0 && runtime.state.pageStatus?.collectionPageConfirmed
      ? "已确认在收藏页，但暂未识别到可见收藏卡片。请展开诊断查看提取线索后再试。"
      : message;
    runtime.state.lastAdded = 0;
    await persistState();
  }

  async function failScan(error) {
    runtime.state.status = "error";
    runtime.state.stage = "error";
    runtime.state.error = toErrorMessage(error);
    runtime.state.message = runtime.state.error;
    await persistState();
  }

  function getPageStatus() {
    const text = normalizeScannedText(document.body?.innerText || "").slice(0, 4000);
    const blocked = /验证码|验证|安全验证|登录后查看|请先登录|访问频繁|稍后再试/.test(text);
    const isXhs = /xiaohongshu\.com|xhslink\.com/i.test(location.hostname);
    const pageUrl = new URL(String(location.href || ""), window.location.href);
    const profilePage = /\/user\/profile\//.test(pageUrl.pathname);
    const favUrl = pageUrl.searchParams.get("tab") === "fav";
    const activeFavoriteElement = findActiveCollectionTabElement();
    const activeTab = normalizeScannedText(activeFavoriteElement?.textContent || "").slice(0, 18) || (favUrl ? "收藏" : "");
    const activeFavoriteTab = Boolean(activeFavoriteElement);
    const collectionPageConfirmed = isXhs && profilePage && !blocked && (favUrl || activeFavoriteTab);
    const root = findCollectionRoot();
    const candidateCardCount = root ? countCardCandidates(root.element) : 0;
    const globalVisibleLinkCount = countVisibleAnchors(document.body);
    const globalNoteLinkCount = countVisibleNoteLinks(document.body);
    const globalDataNoteIdCount = countDataNoteCandidates(document.body);
    const extractionReady = collectionPageConfirmed && candidateCardCount > 0;
    return {
      blocked,
      reason: blocked ? "页面出现登录、验证码或访问限制，扩展已停止扫描，请在浏览器里处理后再继续。" : "",
      isXhs,
      profilePage,
      favoriteRouteSignal: favUrl,
      activeFavoriteTab,
      collectionPageConfirmed,
      extractionReady,
      // Kept for existing callers: page identity is independent from extraction readiness.
      looksCollection: collectionPageConfirmed,
      activeTab,
      containerType: root?.containerType || "unknown",
      selectorVersion: SELECTOR_VERSION,
      url: location.href,
      diagnostics: {
        pageType: profilePage ? "user-profile" : "other",
        profilePage,
        favUrl,
        activeFavoriteTab,
        collectionPageConfirmed,
        extractionReady,
        candidateCardCount,
        primaryVisibleLinkCount: root ? countVisibleAnchors(root.element) : 0,
        globalVisibleLinkCount,
        globalNoteLinkCount,
        globalDataNoteIdCount,
        validFavoriteCount: 0,
        filteredCount: 0,
        filteredReasons: {}
      }
    };
  }

  function scanVisibleXhsCards() {
    const pageStatus = getPageStatus();
    if (pageStatus.blocked || !pageStatus.collectionPageConfirmed) return { items: [], pageStatus };

    const primaryRoot = findCollectionRoot();
    const primary = collectCardsFromRoot(primaryRoot, pageStatus);
    const shouldFallback = primary.items.length === 0 && primaryRoot?.element && primaryRoot.element !== document.body;
    const fallback = shouldFallback
      ? collectCardsFromRoot({ element: document.body, containerType: "document-body-fallback" }, pageStatus)
      : { items: [], diagnostics: emptyExtractionDiagnostics() };
    const items = dedupeWithinBatch([...primary.items, ...fallback.items]).slice(0, 20);
    const diagnostics = {
      ...pageStatus.diagnostics,
      candidateCardCount: primary.diagnostics.candidateCardCount,
      validFavoriteCount: items.length,
      filteredCount: primary.diagnostics.filteredCount + fallback.diagnostics.filteredCount,
      filteredReasons: {
        ...primary.diagnostics.filteredReasons,
        fallbackUsed: shouldFallback ? 1 : 0,
        fallbackCandidateCount: fallback.diagnostics.candidateCardCount
      },
      fallbackUsed: shouldFallback
    };
    pageStatus.extractionReady = items.length > 0;
    pageStatus.diagnostics = diagnostics;
    return { items, pageStatus };
  }

  function collectCardsFromRoot(rootInfo, pageStatus) {
    const root = rootInfo?.element || document.body;
    const allAnchors = Array.from(root.querySelectorAll("a[href]"));
    const visibleAnchors = allAnchors.filter((anchor) => isElementVisible(anchor));
    const noteAnchors = visibleAnchors.filter((anchor) => isLikelyXhsNoteUrl(anchor.href));
    const anchorCards = noteAnchors.map((anchor) => extractCard(anchor, root, rootInfo, pageStatus)).filter(Boolean);
    const dataCards = Array.from(root.querySelectorAll("[data-note-id], [data-id]"))
      .filter((container) => isDataNoteCandidate(container))
      .map((container) => extractCardFromContainer(container, rootInfo, pageStatus))
      .filter(Boolean);
    const items = dedupeWithinBatch([...anchorCards, ...dataCards]);
    const filteredReasons = {
      hidden: Math.max(0, allAnchors.length - visibleAnchors.length),
      nonNoteLink: Math.max(0, visibleAnchors.length - noteAnchors.length),
      invalidCard: Math.max(0, noteAnchors.length - anchorCards.length),
      dataNoteId: dataCards.length,
      duplicate: Math.max(0, anchorCards.length + dataCards.length - items.length)
    };
    return {
      items,
      diagnostics: {
        candidateCardCount: noteAnchors.length + countDataNoteCandidates(root),
        filteredCount: Object.values(filteredReasons).reduce((total, value) => total + value, 0),
        filteredReasons
      }
    };
  }

  function emptyExtractionDiagnostics() {
    return { candidateCardCount: 0, filteredCount: 0, filteredReasons: {} };
  }

  function countVisibleAnchors(root) {
    return Array.from(root?.querySelectorAll?.("a[href]") || []).filter((anchor) => isElementVisible(anchor)).length;
  }

  function countCardCandidates(root) {
    return countVisibleNoteLinks(root) + countDataNoteCandidates(root);
  }

  function countDataNoteCandidates(root) {
    return Array.from(root?.querySelectorAll?.("[data-note-id], [data-id]") || []).filter((element) => isDataNoteCandidate(element)).length;
  }

  function isDataNoteCandidate(element) {
    if (!isReasonableCard(element)) return false;
    const id = String(element.getAttribute("data-note-id") || element.getAttribute("data-id") || "").trim();
    if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) return false;
    return Boolean(element.querySelector("img") || normalizeScannedText(element.innerText || element.textContent || "").length >= 2);
  }

  function extractCardFromContainer(container, rootInfo, pageStatus) {
    const noteAnchor = Array.from(container.querySelectorAll("a[href]")).find((anchor) => isElementVisible(anchor) && isLikelyXhsNoteUrl(anchor.href));
    if (noteAnchor) return extractCard(noteAnchor, container, rootInfo, pageStatus);
    const noteId = String(container.getAttribute("data-note-id") || container.getAttribute("data-id") || "").trim();
    const sourceUrl = /^[a-zA-Z0-9_-]{6,80}$/.test(noteId) ? `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}` : "";
    const rawText = normalizeScannedText(container.innerText || container.textContent || "");
    const title = sanitizeTitle(pickTitle(container, container), rawText);
    if (!sourceUrl && !title && !rawText) return null;
    return {
      title: title || "标题待补充",
      sourceUrl,
      coverUrl: findCoverUrl(container),
      visibleText: rawText.slice(0, 360),
      rawText,
      author: pickAuthor(container),
      noteType: inferNoteType(container),
      badges: pickBadges(container),
      metrics: pickMetrics(container),
      isMissingTitle: !title,
      isMissingLink: !sourceUrl,
      isLikelyOwnPost: false,
      containerType: rootInfo?.containerType || "unknown",
      activeTab: pageStatus.activeTab || "",
      isVisible: true,
      selectorVersion: SELECTOR_VERSION,
      sourcePlatform: "xiaohongshu"
    };
  }

  function findCollectionRoot() {
    const activeTab = findActiveCollectionTabElement();
    const candidates = [];

    if (activeTab) {
      let node = activeTab.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1) {
        const nearby = findBestNoteContainer(node);
        if (nearby) candidates.push({ element: nearby, containerType: "active-collection-tab-nearby" });
        node = node.parentElement;
      }
    }

    const selectors = [
      "[class*='feeds-page']",
      "[class*='feeds']",
      "[class*='note-list']",
      "[class*='user-page'] main",
      "main",
      "[role='main']",
      "section"
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (isElementVisible(element)) candidates.push({ element, containerType: selector });
      });
    });

    const scored = candidates
      .map((candidate) => ({ ...candidate, score: scoreCollectionCandidate(candidate) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0] || (document.body ? { element: document.body, containerType: "document-body-fallback" } : undefined);
  }

  function findActiveCollectionTabElement() {
    const tabSelectors = [
      "[role='tab'][aria-selected='true']",
      "[role='tab'][class*='active']",
      "[role='tab'][class*='selected']",
      "nav [aria-selected='true']",
      "nav [class*='active']",
      "nav [class*='selected']",
      "[class*='tab'][aria-selected='true']",
      "[class*='tab'][class*='active']",
      "[class*='tab'][class*='selected']"
    ];
    for (const selector of tabSelectors) {
      const match = Array.from(document.querySelectorAll(selector)).find((node) => {
        const text = normalizeScannedText(node.textContent || "");
        return isElementVisible(node) && /收藏|favorites?|fav/i.test(text);
      });
      if (match) return match;
    }
    return undefined;
  }

  function detectActiveTab() {
    const active = findActiveCollectionTabElement();
    const text = normalizeScannedText(active?.textContent || "");
    if (text) return text.slice(0, 18);
    const pageUrl = new URL(String(location.href || ""), window.location.href);
    return pageUrl.searchParams.get("tab") === "fav" ? "收藏" : "";
  }
  function findBestNoteContainer(root) {
    const candidates = Array.from(root.querySelectorAll("[class*='feeds'], [class*='note-list'], [class*='content'], main, section"));
    return candidates
      .filter(isElementVisible)
      .map((element) => ({ element, score: scoreCollectionCandidate({ element, containerType: "nested-note-container" }) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.element;
  }

  function scoreCollectionCandidate(candidate) {
    const noteCount = countCardCandidates(candidate.element);
    if (noteCount <= 0) return 0;
    const descriptor = getElementDescriptor(candidate.element);
    let score = noteCount * 10;
    if (candidate.containerType === "active-collection-tab-nearby") score += 90;
    if (/收藏|favorite|collection|fav/i.test(descriptor)) score += 70;
    if (/note-list|feeds|waterfall|masonry/i.test(descriptor)) score += 18;
    if (candidate.element === document.body) score -= 80;
    if (/^(main|section)$/i.test(candidate.element.tagName || "") && !/收藏|favorite|collection|fav/i.test(descriptor)) score -= 28;
    return score;
  }

  function getElementDescriptor(element) {
    return normalizeScannedText([
      element.id || "",
      String(element.className || ""),
      element.getAttribute?.("data-testid") || "",
      element.getAttribute?.("role") || "",
      (element.textContent || "").slice(0, 180)
    ].join(" "));
  }

  function countVisibleNoteLinks(root) {
    return Array.from(root.querySelectorAll("a[href]"))
      .filter((anchor) => isElementVisible(anchor))
      .filter((anchor) => isLikelyXhsNoteUrl(anchor.href)).length;
  }

  function extractCard(anchor, root, rootInfo, pageStatus) {
    const container = findCardContainer(anchor, root);
    if (!container || !isElementVisible(container)) return null;
    const sourceUrl = normalizeXhsUrl(anchor.href);
    const rawText = normalizeScannedText(container.innerText || anchor.innerText || "");
    const title = sanitizeTitle(pickTitle(container, anchor), rawText);
    const visibleText = normalizeScannedText(rawText).slice(0, 360);
    const coverUrl = findCoverUrl(container);
    const author = pickAuthor(container);
    const noteType = inferNoteType(container);
    const currentUser = inferCurrentUserName();

    if (!sourceUrl && !title && !visibleText) return null;
    return {
      title: title || "标题待补充",
      sourceUrl,
      coverUrl,
      visibleText,
      rawText,
      author,
      noteType,
      badges: pickBadges(container),
      metrics: pickMetrics(container),
      isMissingTitle: !title,
      isMissingLink: !sourceUrl,
      isLikelyOwnPost: Boolean(currentUser && author && normalizeComparable(currentUser) === normalizeComparable(author)),
      containerType: rootInfo?.containerType || "unknown",
      activeTab: pageStatus.activeTab || "",
      isVisible: true,
      selectorVersion: SELECTOR_VERSION,
      sourcePlatform: "xiaohongshu"
    };
  }

  function findCardContainer(anchor, root) {
    const selectors = [
      "article",
      "[data-note-id]",
      "[data-id]",
      ".note-item",
      ".note-card",
      "[class*='note']",
      "[class*='card']",
      "[class*='feed']"
    ];

    for (const selector of selectors) {
      const match = anchor.closest(selector);
      if (match && root.contains(match) && isReasonableCard(match)) return match;
    }

    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 7 && root.contains(node); depth += 1) {
      if (isReasonableCard(node)) return node;
      node = node.parentElement;
    }

    return anchor;
  }

  function isReasonableCard(element) {
    if (!isElementVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 72 || rect.height < 42) return false;
    if (rect.height > window.innerHeight * 1.65) return false;
    return true;
  }

  function isElementVisible(element) {
    if (!element || !element.isConnected) return false;
    if (element.closest("[aria-hidden='true'], [hidden]")) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function pickTitle(container, anchor) {
    const titleSelectors = [
      "[class*='title']",
      "[class*='desc']",
      "[class*='content']",
      "h1",
      "h2",
      "h3",
      "p"
    ];

    for (const selector of titleSelectors) {
      const elements = Array.from(container?.querySelectorAll(selector) || []);
      for (const element of elements) {
        if (!isElementVisible(element)) continue;
        const text = normalizeScannedText(element.textContent || "");
        if (isGoodTitle(text)) return text;
      }
    }

    const aria = normalizeScannedText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
    if (isGoodTitle(aria)) return aria;

    const anchorText = normalizeScannedText(anchor.textContent || "");
    if (isGoodTitle(anchorText)) return anchorText;

    const imageAlt = normalizeScannedText(container?.querySelector("img")?.getAttribute("alt") || "");
    return isGoodTitle(imageAlt) ? imageAlt : "";
  }

  function sanitizeTitle(value, rawText) {
    let title = normalizeScannedText(value || "");
    if (!title && rawText) {
      title = normalizeScannedText(rawText).split(/ 作者| 点赞| 收藏| 评论| \d+$/)[0] || "";
    }
    title = title
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/xhslink\.com\/\S+/gi, "")
      .replace(/^(置顶|图文|视频)\s*/g, "")
      .replace(/\s*(image|video)\s*$/gi, "")
      .replace(/\s*[-—|]\s*小红书.*$/i, "")
      .trim();
    title = removeRepeatedSegments(title);
    if (title.length > 92) title = title.slice(0, 92).trim();
    return isGoodTitle(title) ? title : "";
  }

  function isGoodTitle(text) {
    const value = normalizeScannedText(text || "");
    if (value.length < 2 || value.length > 120) return false;
    if (/^https?:\/\//i.test(value)) return false;
    if (/^(赞|点赞|收藏|评论|分享|\d+|image|video)$/i.test(value)) return false;
    return true;
  }

  function pickAuthor(container) {
    const selectors = ["[class*='author']", "[class*='user']", "[class*='name']", "a[href*='/user/profile']"];
    for (const selector of selectors) {
      const elements = Array.from(container?.querySelectorAll(selector) || []);
      for (const element of elements) {
        if (!isElementVisible(element)) continue;
        const text = sanitizeAuthor(element.textContent || "");
        if (text) return text;
      }
    }
    return undefined;
  }

  function sanitizeAuthor(value) {
    const text = normalizeScannedText(value).replace(/关注|粉丝|作者|博主/g, "").trim();
    if (text.length >= 2 && text.length <= 40 && !/^https?:\/\//i.test(text)) return text;
    return "";
  }

  function inferCurrentUserName() {
    const selectors = ["[class*='user-name']", "[class*='nickname']", "[class*='profile'] [class*='name']"];
    for (const selector of selectors) {
      const element = Array.from(document.querySelectorAll(selector)).find(isElementVisible);
      const text = sanitizeAuthor(element?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function inferNoteType(container) {
    const text = normalizeScannedText(container?.innerText || "");
    const html = container?.innerHTML || "";
    if (/视频|播放|▶|video/i.test(text + " " + html) || container?.querySelector("video")) return "video";
    if (/图文|图片|image/i.test(text + " " + html) || container?.querySelector("img")) return "image";
    return "unknown";
  }

  function findCoverUrl(container) {
    const image = Array.from(container?.querySelectorAll("img[src], img[data-src], picture img") || []).find(isElementVisible);
    if (!image) return undefined;
    return image.getAttribute("src") || image.getAttribute("data-src") || undefined;
  }

  function pickBadges(container) {
    const text = normalizeScannedText(container?.innerText || "");
    return ["置顶", "视频", "图文"].filter((badge) => text.includes(badge));
  }

  function pickMetrics(container) {
    const text = normalizeScannedText(container?.innerText || "");
    const likes = text.match(/(?:赞|点赞)\s*(\d+[\d.w万]*)/i)?.[1];
    const comments = text.match(/(?:评论)\s*(\d+[\d.w万]*)/i)?.[1];
    return { likes, comments };
  }

  function isLikelyXhsNoteUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (!/xiaohongshu\.com|xhslink\.com/i.test(url.hostname)) return false;
      return /\/explore\/|\/discovery\/item\/|note|xhslink/i.test(url.pathname + url.search + url.hostname);
    } catch {
      return false;
    }
  }

  function normalizeXhsUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      url.hash = "";
      return url.toString();
    } catch {
      return value || "";
    }
  }

  async function scrollOneStep(delayMs) {
    window.scrollBy({ top: Math.round(window.innerHeight * 0.78), behavior: "smooth" });
    await wait(delayMs);
  }

  function isNearPageEnd() {
    return Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 32;
  }

  function normalizeScannedText(input) {
    const decoded = decodeHtmlEntities(String(input || ""));
    return decoded
      .normalize("NFC")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\uFEFF\u00AD]/g, "")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function decodeHtmlEntities(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function removeRepeatedSegments(value) {
    const text = normalizeScannedText(value);
    const half = Math.floor(text.length / 2);
    if (half > 4 && text.slice(0, half) === text.slice(half, half * 2)) return text.slice(0, half).trim();
    return text.replace(/\b(.{2,20})\s+\1\b/g, "$1").trim();
  }

  function normalizeComparable(value) {
    return normalizeScannedText(value).toLowerCase().replace(/\s+/g, "");
  }

  function dedupeWithinBatch(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = itemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function itemKey(item) {
    return item.sourceUrl || `${item.title}|${item.author || ""}`;
  }

  function updateMilestones(existing, count) {
    const milestones = new Set(existing || []);
    [10, 20].forEach((value) => {
      if (count >= value) milestones.add(`已找回 ${value} 条旧收藏`);
    });
    return [...milestones];
  }

  function toErrorMessage(error) {
    return error instanceof Error ? error.message : "扫描失败";
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
