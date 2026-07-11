(() => {
  if (window.__collectionRevivalScannerInstalled) return;
  window.__collectionRevivalScannerInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "REVIVAL_SCAN_VISIBLE_CARDS") return false;

    (async () => {
      try {
        if (message.autoScroll) {
          await autoScrollPage(message.maxScrolls ?? 6, message.delayMs ?? 650);
        }
        const items = scanVisibleXhsCards();
        sendResponse({ ok: true, items, pageUrl: window.location.href });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "扫描失败" });
      }
    })();

    return true;
  });

  function scanVisibleXhsCards() {
    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((anchor) => isLikelyXhsNoteUrl(anchor.href));
    const cards = anchors
      .map((anchor) => extractCard(anchor))
      .filter(Boolean);

    return dedupe(cards).slice(0, 120);
  }

  function extractCard(anchor) {
    const container = findCardContainer(anchor);
    const title = pickTitle(container, anchor);
    const visibleText = cleanText(container?.innerText || anchor.innerText || title).slice(0, 320);
    const coverUrl = findCoverUrl(container);
    const sourceUrl = normalizeXhsUrl(anchor.href);

    if (!sourceUrl && !title) return null;
    return {
      title: title || visibleText.slice(0, 42) || "未命名小红书收藏",
      sourceUrl,
      coverUrl,
      visibleText,
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
    for (let depth = 0; node && depth < 5; depth += 1) {
      if (isReasonableCard(node)) return node;
      node = node.parentElement;
    }

    return anchor;
  }

  function isReasonableCard(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 60) return false;
    if (rect.height > window.innerHeight * 1.4) return false;
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
      if (text.length >= 2 && text.length <= 80) return text;
    }

    const aria = cleanText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
    if (aria) return aria.slice(0, 80);

    const anchorText = cleanText(anchor.textContent || "");
    if (anchorText) return anchorText.slice(0, 80);

    const imageAlt = cleanText(container?.querySelector("img")?.getAttribute("alt") || "");
    return imageAlt.slice(0, 80);
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
      return /\/explore\/|\/discovery\/item\/|\/user\/profile\/.+\/collections|note/i.test(url.pathname + url.search);
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

  async function autoScrollPage(maxScrolls, delayMs) {
    const startY = window.scrollY;
    let previousHeight = document.documentElement.scrollHeight;

    for (let index = 0; index < maxScrolls; index += 1) {
      window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "smooth" });
      await wait(delayMs);
      const currentHeight = document.documentElement.scrollHeight;
      if (Math.abs(window.scrollY + window.innerHeight - currentHeight) < 20 && currentHeight === previousHeight) break;
      previousHeight = currentHeight;
    }

    window.scrollTo({ top: startY, behavior: "smooth" });
    await wait(Math.min(delayMs, 300));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
