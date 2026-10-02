(() => {
  "use strict";

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const CONFIG = Object.freeze({
    ACTION_DELAY: 1800,
    NEXT_DELAY: 1800,
    PAGE_DELAY: 1200,
    MAX_CONSECUTIVE_FAILURES: 3
  });

  let running = false;
  let stopRequested = false;

  // ============================================================
  // UTILITIES
  // ============================================================

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function send(message) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (_) {
      // Popup may be closed. The cleanup itself can continue.
    }
  }

  function report(text, detail = "") {
    send({
      type: "STATUS",
      text,
      detail
    });
  }

  function progress(done, attempts, detail = "") {
    send({
      type: "PROGRESS",
      done,
      total: attempts,
      detail
    });
  }

  function isVisible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function elementText(element) {
    if (!element) return "";

    return normalize(
      [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-e2e"),
        element.getAttribute("data-testid")
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function visibleElements(selectors) {
    const result = [];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) {
          result.push(element);
        }
      }
    }

    return [...new Set(result)];
  }

  function clickable(element) {
    if (!element) return null;

    return (
      element.closest("button") ||
      element.closest('[role="button"]') ||
      element.closest("a") ||
      element
    );
  }

  function safeClick(element) {
    const target = clickable(element);

    if (!target || !isVisible(target)) {
      return false;
    }

    target.scrollIntoView({
      behavior: "instant",
      block: "center"
    });

    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );

    return true;
  }

  // ============================================================
  // LIKE
  // ============================================================

  function findLikeButton() {
    const selectors = [
      '[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]',
      '[data-testid*="like"]'
    ];

    const candidates = visibleElements(selectors);

    for (const candidate of candidates) {
      const button = clickable(candidate);

      if (button && isVisible(button)) {
        return button;
      }
    }

    // Accessibility fallback.
    const buttons = visibleElements([
      "button",
      '[role="button"]'
    ]);

    for (const button of buttons) {
      const label = normalize(
        button.getAttribute("aria-label")
      );

      if (
        label === "like" ||
        label === "liked" ||
        label.includes("like")
      ) {
        return button;
      }
    }

    return null;
  }

  function likeState(button) {
    if (!button) return "unknown";

    const ariaPressed =
      button.getAttribute("aria-pressed");

    if (ariaPressed === "true") {
      return "liked";
    }

    if (ariaPressed === "false") {
      return "not-liked";
    }

    const label = normalize(
      button.getAttribute("aria-label")
    );

    if (label === "liked") {
      return "liked";
    }

    if (
      label === "like" ||
      label.includes("like this video")
    ) {
      return "not-liked";
    }

    /*
     * TikTok has used the red #FE2C55 color for the
     * active heart. Treat this only as a fallback.
     */
    const html = button.innerHTML
      .replace(/\s/g, "")
      .toLowerCase();

    if (
      html.includes("#fe2c55") ||
      html.includes("254,44,85")
    ) {
      return "liked";
    }

    return "unknown";
  }

  async function removeLike() {
    const button = findLikeButton();

    if (!button) {
      return {
        ok: false,
        reason: "Like button not found"
      };
    }

    const before = likeState(button);

    if (before === "not-liked") {
      return {
        ok: false,
        skipped: true,
        reason: "Video is already unliked"
      };
    }

    /*
     * Safety feature:
     *
     * If we cannot determine whether the video is liked,
     * DO NOT click it.
     */
    if (before !== "liked") {
      return {
        ok: false,
        skipped: true,
        reason: "Could not verify that the video is liked"
      };
    }

    if (!safeClick(button)) {
      return {
        ok: false,
        reason: "Could not click Like button"
      };
    }

    await sleep(CONFIG.ACTION_DELAY);

    const afterButton = findLikeButton();
    const after = likeState(afterButton);

    if (after === "not-liked") {
      return {
        ok: true
      };
    }

    return {
      ok: false,
      reason: "Unlike could not be verified"
    };
  }

  // ============================================================
  // REPOST
  // ============================================================

  function findRepostButton() {
    const candidates = visibleElements([
      '[data-e2e="video-share-repost"]',
      '[data-e2e*="repost"]',
      '[data-testid*="repost"]'
    ]);

    for (const candidate of candidates) {
      const button = clickable(candidate);

      if (button && isVisible(button)) {
        return button;
      }
    }

    return null;
  }

  function findShareButton() {
    const candidates = visibleElements([
      '[data-e2e="video-share"]',
      '[data-e2e*="share"]',
      '[data-testid*="share"]'
    ]);

    for (const candidate of candidates) {
      const button = clickable(candidate);

      if (button && isVisible(button)) {
        return button;
      }
    }

    return null;
  }

  function findMenuItem(words) {
    const candidates = visibleElements([
      '[role="menuitem"]',
      '[role="option"]',
      "button",
      '[role="button"]'
    ]);

    for (const candidate of candidates) {
      const text = elementText(candidate);

      if (
        words.some(word =>
          text.includes(normalize(word))
        )
      ) {
        return candidate;
      }
    }

    return null;
  }

  async function removeRepost() {
    /*
     * First open Share.
     */
    const share = findShareButton();

    if (!share) {
      return {
        ok: false,
        skipped: true,
        reason: "Share button not found"
      };
    }

    if (!safeClick(share)) {
      return {
        ok: false,
        reason: "Could not open Share menu"
      };
    }

    await sleep(600);

    /*
     * Look specifically for Remove Repost.
     *
     * Do NOT click a generic "Repost" item because that
     * could create a repost instead of removing one.
     */
    const remove = findMenuItem([
      "remove repost",
      "undo repost"
    ]);

    if (!remove) {
      return {
        ok: false,
        skipped: true,
        reason:
          "Remove Repost was not found"
      };
    }

    if (!safeClick(remove)) {
      return {
        ok: false,
        reason:
          "Could not click Remove Repost"
      };
    }

    await sleep(CONFIG.ACTION_DELAY);

    return {
      ok: true
    };
  }

  // ============================================================
  // FAVORITES
  // ============================================================

  function findFavoriteButton() {
    const candidates = visibleElements([
      '[data-e2e*="collect"]',
      '[data-e2e*="favorite"]',
      '[data-e2e*="favourite"]',
      '[data-testid*="favorite"]',
      '[data-testid*="collect"]'
    ]);

    for (const candidate of candidates) {
      const button = clickable(candidate);

      if (button && isVisible(button)) {
        return button;
      }
    }

    /*
     * Accessibility fallback.
     */
    const buttons = visibleElements([
      "button",
      '[role="button"]'
    ]);

    for (const button of buttons) {
      const label = normalize(
        button.getAttribute("aria-label")
      );

      const title = normalize(
        button.getAttribute("title")
      );

      const combined =
        `${label} ${title}`;

      if (
        combined.includes("favorite") ||
        combined.includes("favourite") ||
        combined.includes("save")
      ) {
        return button;
      }
    }

    return null;
  }

  async function removeFavorite() {
    let button = findFavoriteButton();

    /*
     * Some TikTok layouts expose Save/Favorite directly.
     */
    if (button) {
      if (!safeClick(button)) {
        return {
          ok: false,
          reason: "Could not click Favorite"
        };
      }

      await sleep(CONFIG.ACTION_DELAY);

      return {
        ok: true
      };
    }

    /*
     * Other layouts put it inside Share.
     */
    const share = findShareButton();

    if (!share) {
      return {
        ok: false,
        skipped: true,
        reason:
          "Favorite/Save button not found"
      };
    }

    safeClick(share);

    await sleep(600);

    const remove = findMenuItem([
      "remove from favorites",
      "remove from favourite",
      "unsave"
    ]);

    if (!remove) {
      return {
        ok: false,
        skipped: true,
        reason:
          "Remove from Favorites was not found"
      };
    }

    safeClick(remove);

    await sleep(CONFIG.ACTION_DELAY);

    return {
      ok: true
    };
  }

  // ============================================================
  // NEXT VIDEO
  // ============================================================

  function findNextButton() {
    const candidates = visibleElements([
      '[data-e2e="arrow-right"]',
      '[data-e2e*="arrow-right"]',
      '[data-testid*="arrow-right"]',
      'button[aria-label="Next"]',
      'button[aria-label="Next video"]',
      'button[aria-label="next"]'
    ]);

    for (const candidate of candidates) {
      const button = clickable(candidate);

      if (
        button &&
        isVisible(button) &&
        button.disabled !== true &&
        button.getAttribute(
          "aria-disabled"
        ) !== "true"
      ) {
        return button;
      }
    }

    return null;
  }

  async function nextVideo() {
    const button = findNextButton();

    if (!button) {
      return false;
    }

    if (!safeClick(button)) {
      return false;
    }

    await sleep(CONFIG.NEXT_DELAY);

    return true;
  }

  // ============================================================
  // OPERATION DISPATCH
  // ============================================================

  async function processCurrent(type) {
    switch (type) {
      case "likes":
        return removeLike();

      case "reposts":
        return removeRepost();

      case "favorites":
        return removeFavorite();

      default:
        return {
          ok: false,
          reason: `Unknown operation: ${type}`
        };
    }
  }

  // ============================================================
  // MAIN LOOP
  // ============================================================

  async function run(type) {
    if (running) return;

    running = true;
    stopRequested = false;

    let done = 0;
    let attempts = 0;
    let failures = 0;

    try {
      report(
        "Starting...",
        `Operation: ${type}`
      );

      /*
       * Require the user to already be inside a TikTok
       * collection/player. This is intentional.
       *
       * Automatically guessing which profile tab TikTok
       * currently uses is less safe than asking the user
       * to open the correct collection.
       */
      if (!findLikeButton() &&
          !findRepostButton() &&
          !findFavoriteButton()) {

        throw new Error(
          "Open a video from the correct TikTok collection first."
        );
      }

      while (!stopRequested) {
        attempts++;

        report(
          `Processing ${attempts}...`,
          "Checking the current control before acting."
        );

        const result =
          await processCurrent(type);

        if (result.ok) {
          done++;
          failures = 0;

          progress(
            done,
            attempts,
            "Successfully completed."
          );

        } else if (result.skipped) {
          failures++;

          progress(
            done,
            attempts,
            `Skipped: ${result.reason}`
          );

        } else {
          failures++;

          progress(
            done,
            attempts,
            `Failed: ${result.reason}`
          );
        }

        /*
         * Safety stop.
         *
         * If TikTok's UI doesn't match our expectations
         * repeatedly, do not keep clicking.
         */
        if (
          failures >=
          CONFIG.MAX_CONSECUTIVE_FAILURES
        ) {
          throw new Error(
            "Stopped safely: TikTok's controls could not be reliably identified."
          );
        }

        if (stopRequested) {
          break;
        }

        const moved =
          await nextVideo();

        if (!moved) {
          break;
        }

        await sleep(CONFIG.PAGE_DELAY);
      }

      if (stopRequested) {
        send({
          type: "STOPPED",
          done
        });
      } else {
        send({
          type: "FINISHED",
          done
        });
      }

    } catch (error) {
      console.error(
        "TikTok Cleaner:",
        error
      );

      send({
        type: "ERROR",
        text:
          error?.message ||
          "Cleanup stopped."
      });

    } finally {
      running = false;
      stopRequested = false;
    }
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      if (!message) {
        return;
      }

      if (message.command === "START") {
        run(message.type);

        sendResponse({
          ok: true
        });

        return true;
      }

      if (message.command === "STOP") {
        stopRequested = true;

        sendResponse({
          ok: true
        });

        return true;
      }
    }
  );

})();
