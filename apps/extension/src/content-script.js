(() => {
  if (window.__collectionRevivalScannerInstalled) return;
  window.__collectionRevivalScannerInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "REVIVAL_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "REVIVAL_GET_PAGE_STATUS") {
      sendResponse({ ok: true, ...getPageStatus() });
      return false;
    }

    if (message?.type !== "REVIVAL_SCAN_STEP") return false;

    (async () => {
      try {
        const pageStatus = getPageStatus();
        if (pageStatus.blocked) {
          sendResponse({ ok: true, items: [], blocked: true, reason: pageStatus.reason, pageStatus, pageUrl: window.location.href });
          return;
        }

        const beforeY = window.scrollY;
        if (message.scroll) await scrollOneStep(message.delayMs ?? 650);
        const items = scanVisibleXhsCards();
        const reachedEnd = Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 24;
        sendResponse({ ok: true, items, reachedEnd, pageStatus: getPageStatus(), pageUrl: window.location.href, scrollY: window.scrollY, previousY: beforeY });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "扫描失败" });
      }
    })();

    return true;
  });

  function getPageStatus() {
    const text = cleanText(document.body?.innerText || "").slice(0, 4000);
    const blocked = /验证码|验证|安全验证|登录后查看|请先登录|访问频繁|稍后再试/.test(text);
    const isXhs = /xiaohongshu\.com|xhslink\.com/i.test(location.hostname);
    const looksCollection = /收藏|favorite|collection|笔记|我的/.test(text + " " + location.href);
    return {
      blocked,
      reason: blocked ? "页面出现登录、验证码或访问限制，扩展已停止扫描，请在浏览器里处理后再继续。" : "",
      isXhs,
      looksCollection,
      url: location.href
    };
  }

  function scanVisibleXhsCards() {
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .filter((anchor) => isLikelyXhsNoteUrl(anchor.href));
    const cards = anchors
      .map((anchor) => extractCard(anchor))
      .filter(Boolean);

    return dedupe(cards).slice(0, 240);
  }

  function extractCard(anchor) {
    const container = findCardContainer(anchor);
    const title = pickTitle(container, anchor);
    const visibleText = cleanText(container?.innerText || anchor.innerText || title).slice(0, 360);
    const coverUrl = findCoverUrl(container);
    const sourceUrl = normalizeXhsUrl(anchor.href);
    const author = pickAuthor(container);
    const noteType = inferNoteType(container);

    if (!sourceUrl && !title) return null;
    return {
      title: title || visibleText.slice(0, 42) || "未命名小红书收藏",
      sourceUrl,
      coverUrl,
      visibleText,
      author,
      noteType,
      sourcePlatform: "xiaohongshu"
    };
  }

  function findCardContainer(anchor) {
    const selectors = [
      "article",
      "[data-note-id]",
      "[data-id]",
      ".note-item",
      ".feeds-page .note-card",
      "[class*='note']",
      "[class*='card']",
      "[class*='feed']"
    ];

    for (const selector of selectors) {
      const match = anchor.closest(selector);
      if (match && isReasonableCard(match)) return match;
    }

    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (isReasonableCard(node)) return node;
      node = node.parentElement;
    }

    return anchor;
  }

  function isReasonableCard(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 72 || rect.height < 48) return false;
    if (rect.height > window.innerHeight * 1.5) return false;
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
      const element = container?.querySelector(selector);
      const text = cleanText(element?.textContent || "");
      if (text.length >= 2 && text.length <= 90) return text;
    }

    const aria = cleanText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
    if (aria) return aria.slice(0, 90);

    const anchorText = cleanText(anchor.textContent || "");
    if (anchorText) return anchorText.slice(0, 90);

    const imageAlt = cleanText(container?.querySelector("img")?.getAttribute("alt") || "");
    return imageAlt.slice(0, 90);
  }

  function pickAuthor(container) {
    const selectors = ["[class*='author']", "[class*='user']", "[class*='name']", "a[href*='/user/profile']"];
    for (const selector of selectors) {
      const text = cleanText(container?.querySelector(selector)?.textContent || "");
      if (text.length >= 2 && text.length <= 40) return text;
    }
    return undefined;
  }

  function inferNoteType(container) {
    const text = cleanText(container?.innerText || "");
    if (/视频|播放|▶|video/i.test(text + " " + (container?.innerHTML || ""))) return "video";
    if (container?.querySelector("video")) return "video";
    if (container?.querySelector("img")) return "image";
    return "unknown";
  }

  function findCoverUrl(container) {
    const image = container?.querySelector("img[src], img[data-src], picture img");
    if (!image) return undefined;
    return image.getAttribute("src") || image.getAttribute("data-src") || undefined;
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
    window.scrollBy({ top: Math.round(window.innerHeight * 0.82), behavior: "smooth" });
    await wait(delayMs);
  }

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function dedupe(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.sourceUrl || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();