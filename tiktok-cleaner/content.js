"use strict";

(() => {

  let running = false;
  let stopRequested = false;

  /*
   * Deliberately slow.
   *
   * Do not reduce these to 0.
   */
  const ACTION_DELAY = 1800;
  const PAGE_DELAY = 1500;
  const SCROLL_DELAY = 1200;

  function sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  function send(message) {

    try {
      chrome.runtime.sendMessage(message);
    } catch {
      // Popup may have been closed.
    }
  }

  function visible(element) {

    if (!element) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    const style =
      window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  function textOf(element) {

    return (
      element?.innerText ||
      element?.textContent ||
      ""
    )
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /*
   * --------------------------------------------------
   * GENERAL NAVIGATION
   * --------------------------------------------------
   */

  function currentPath() {
    return location.pathname.toLowerCase();
  }

  function isProfilePage() {

    const path = currentPath();

    return (
      path.startsWith("/@") &&
      !path.includes("/video/")
    );
  }

  function findProfileTabs() {

    return [
      ...document.querySelectorAll(
        'a, button, [role="tab"], [role="button"]'
      )
    ].filter(visible);
  }

  function clickTabByWords(words) {

    const elements =
      findProfileTabs();

    for (const element of elements) {

      const text =
        textOf(element);

      const aria =
        textOf({
          innerText:
            element.getAttribute(
              "aria-label"
            ) || ""
        });

      const combined =
        `${text} ${aria}`;

      if (
        words.some(word =>
          combined.includes(word)
        )
      ) {

        element.click();

        return true;
      }
    }

    return false;
  }

  /*
   * --------------------------------------------------
   * VIDEO CONTROLS
   * --------------------------------------------------
   */

  function findElements(selectors) {

    for (const selector of selectors) {

      const elements = [
        ...document.querySelectorAll(selector)
      ].filter(visible);

      if (elements.length) {
        return elements;
      }
    }

    return [];
  }

  /*
   * LIKE
   */

  function findLikeButton() {

    const elements = findElements([
      '[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]'
    ]);

    for (const element of elements) {

      const button =
        element.closest("button") ||
        element.closest('[role="button"]') ||
        element;

      if (visible(button)) {
        return button;
      }
    }

    /*
     * Fallback for aria labels.
     */
    const buttons = [
      ...document.querySelectorAll(
        'button, [role="button"]'
      )
    ].filter(visible);

    for (const button of buttons) {

      const label = (
        button.getAttribute(
          "aria-label"
        ) || ""
      ).toLowerCase();

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

  function likeIsActive(button) {

    if (!button) {
      return false;
    }

    /*
     * aria-pressed.
     */
    if (
      button.getAttribute(
        "aria-pressed"
      ) === "true"
    ) {
      return true;
    }

    /*
     * Look for the red TikTok heart.
     */
    const html =
      button.innerHTML.toLowerCase();

    if (
      html.includes("#fe2c55") ||
      html.includes("254,44,85") ||
      html.includes("254, 44, 85")
    ) {
      return true;
    }

    const label = (
      button.getAttribute(
        "aria-label"
      ) || ""
    ).toLowerCase();

    if (label === "liked") {
      return true;
    }

    return false;
  }

  async function removeLike() {

    const button =
      findLikeButton();

    if (!button) {

      return {
        ok: false,
        reason: "Like button not found"
      };
    }

    /*
     * SAFETY:
     * Don't click an inactive heart.
     */
    if (!likeIsActive(button)) {

      return {
        ok: false,
        reason: "Video is not currently liked"
      };
    }

    button.click();

    await sleep(ACTION_DELAY);

    const after =
      findLikeButton();

    if (
      after &&
      !likeIsActive(after)
    ) {

      return {
        ok: true
      };
    }

    return {
      ok: false,
      reason: "Unlike was not verified"
    };
  }

  /*
   * --------------------------------------------------
   * REPOST
   * --------------------------------------------------
   *
   * Current community implementations use
   * data-e2e="video-share-repost".
   */

  function findRepostButton() {

    const elements =
      findElements([
        '[data-e2e="video-share-repost"]',
        '[data-e2e*="repost"]'
      ]);

    for (const element of elements) {

      const button =
        element.closest("button") ||
        element.closest('[role="button"]') ||
        element;

      if (visible(button)) {
        return button;
      }
    }

    return null;
  }

  async function openShareMenu() {

    const share =
      findElements([
        '[data-e2e="video-share"]',
        '[data-e2e*="share"]'
      ]);

    for (const element of share) {

      const button =
        element.closest("button") ||
        element.closest('[role="button"]') ||
        element;

      if (visible(button)) {

        button.click();

        await sleep(600);

        return true;
      }
    }

    return false;
  }

  async function removeRepost() {

    /*
     * First look for the direct repost control.
     */
    let button =
      findRepostButton();

    if (!button) {

      const opened =
        await openShareMenu();

      if (!opened) {

        return {
          ok: false,
          reason: "Share/Repost control not found"
        };
      }

      button =
        findRepostButton();
    }

    if (!button) {

      /*
       * Look for "Remove repost" in the menu.
       */
      const menuItems = [
        ...document.querySelectorAll(
          '[role="menuitem"], button, [role="button"]'
        )
      ].filter(visible);

      for (const item of menuItems) {

        const text =
          textOf(item);

        if (
          text.includes("remove repost") ||
          text.includes("undo repost") ||
          text === "repost"
        ) {

          item.click();

          await sleep(ACTION_DELAY);

          return {
            ok: true
          };
        }
      }

      return {
        ok: false,
        reason: "Remove Repost option not found"
      };
    }

    /*
     * Open the share menu if needed.
     */
    button.click();

    await sleep(500);

    const items = [
      ...document.querySelectorAll(
        '[role="menuitem"], button, [role="button"]'
      )
    ].filter(visible);

    for (const item of items) {

      const text =
        textOf(item);

      if (
        text.includes("remove repost") ||
        text.includes("undo repost")
      ) {

        item.click();

        await sleep(ACTION_DELAY);

        return {
          ok: true
        };
      }
    }

    return {
      ok: false,
      reason: "Remove Repost option not found"
    };
  }

  /*
   * --------------------------------------------------
   * FAVORITES
   * --------------------------------------------------
   */

  function findFavoriteButton() {

    const elements =
      findElements([
        '[data-e2e*="collect"]',
        '[data-e2e*="favorite"]',
        '[data-e2e*="favourite"]'
      ]);

    for (const element of elements) {

      const button =
        element.closest("button") ||
        element.closest('[role="button"]') ||
        element;

      if (visible(button)) {
        return button;
      }
    }

    /*
     * Accessibility fallback.
     */
    const buttons = [
      ...document.querySelectorAll(
        'button, [role="button"]'
      )
    ].filter(visible);

    for (const button of buttons) {

      const label = (
        button.getAttribute(
          "aria-label"
        ) || ""
      ).toLowerCase();

      const title = (
        button.getAttribute(
          "title"
        ) || ""
      ).toLowerCase();

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

    let button =
      findFavoriteButton();

    /*
     * If there is no direct save button, try Share.
     */
    if (!button) {

      const opened =
        await openShareMenu();

      if (opened) {
        button =
          findFavoriteButton();
      }
    }

    if (!button) {

      /*
       * Search menu text.
       */
      const items = [
        ...document.querySelectorAll(
          '[role="menuitem"], button, [role="button"]'
        )
      ].filter(visible);

      for (const item of items) {

        const text =
          textOf(item);

        if (
          text.includes(
            "remove from favorites"
          ) ||
          text.includes(
            "remove from favourite"
          ) ||
          text.includes(
            "unsave"
          )
        ) {

          item.click();

          await sleep(ACTION_DELAY);

          return {
            ok: true
          };
        }
      }

      return {
        ok: false,
        reason: "Favorite control not found"
      };
    }

    button.click();

    await sleep(ACTION_DELAY);

    return {
      ok: true
    };
  }

  /*
   * --------------------------------------------------
   * NEXT VIDEO
   * --------------------------------------------------
   */

  function findNextButton() {

    const selectors = [
      '[data-e2e="arrow-right"]',
      'button[aria-label="Next"]',
      'button[aria-label="next"]',
      '[data-e2e*="arrow-right"]'
    ];

    for (const selector of selectors) {

      const element =
        document.querySelector(selector);

      if (
        element &&
        visible(element) &&
        element.getAttribute(
          "aria-disabled"
        ) !== "true"
      ) {

        return element;
      }
    }

    /*
     * Text fallback.
     */
    const buttons = [
      ...document.querySelectorAll(
        'button, [role="button"]'
      )
    ].filter(visible);

    for (const button of buttons) {

      const label = (
        button.getAttribute(
          "aria-label"
        ) || ""
      ).toLowerCase();

      if (
        label === "next" ||
        label.includes("next video")
      ) {

        return button;
      }
    }

    return null;
  }

  async function nextVideo() {

    const button =
      findNextButton();

    if (!button) {
      return false;
    }

    button.click();

    await sleep(NEXT_DELAY);

    return true;
  }

  /*
   * --------------------------------------------------
   * PROFILE GRID
   * --------------------------------------------------
   */

  function findVideoTiles(type) {

    let selectors = [];

    if (type === "likes") {

      selectors = [
        '[data-e2e="user-liked-item"]',
        '[data-e2e*="liked-item"]'
      ];

    } else if (type === "reposts") {

      selectors = [
        '[data-e2e="user-post-item"]',
        '[data-e2e*="repost"]'
      ];

    } else if (type === "favorites") {

      selectors = [
        '[data-e2e*="favorite"]',
        '[data-e2e*="collect"]'
      ];
    }

    for (const selector of selectors) {

      const elements = [
        ...document.querySelectorAll(selector)
      ].filter(visible);

      if (elements.length) {
        return elements;
      }
    }

    /*
     * Generic video links fallback.
     */
    return [
      ...document.querySelectorAll(
        'a[href*="/video/"]'
      )
    ].filter(visible);
  }

  async function openFirstTile(type) {

    const tiles =
      findVideoTiles(type);

    if (!tiles.length) {
      return false;
    }

    const tile =
      tiles[0];

    const link =
      tile.matches("a")
        ? tile
        : tile.querySelector(
            'a[href*="/video/"]'
          );

    if (!link) {
      return false;
    }

    link.click();

    await sleep(2000);

    return Boolean(
      findLikeButton() ||
      findRepostButton() ||
      findFavoriteButton()
    );
  }

  /*
   * --------------------------------------------------
   * MAIN CLEANUP
   * --------------------------------------------------
   */

  async function processCurrent(type) {

    if (type === "likes") {
      return removeLike();
    }

    if (type === "reposts") {
      return removeRepost();
    }

    if (type === "favorites") {
      return removeFavorite();
    }

    return {
      ok: false,
      reason: "Unknown operation"
    };
  }

  async function run(type) {

    if (running) {
      return;
    }

    running = true;
    stopRequested = false;

    let done = 0;
    let attempts = 0;

    try {

      send({
        type: "STATUS",
        text: "Preparing..."
      });

      /*
       * The user can either:
       *
       * A) already have a video open
       * B) be on the appropriate profile tab
       *
       * Try to detect an existing video first.
       */

      const videoAlreadyOpen =
        Boolean(
          findLikeButton() ||
          findRepostButton() ||
          findFavoriteButton()
        );

      if (!videoAlreadyOpen) {

        send({
          type: "STATUS",
          text: "Finding videos..."
        });

        const opened =
          await openFirstTile(type);

        if (!opened) {

          throw new Error(
            "No videos found. Open the corresponding TikTok tab first."
          );
        }
      }

      while (!stopRequested) {

        attempts++;

        send({
          type: "STATUS",
          text:
            `${type}: processing video ${attempts}`,
          detail:
            "Checking the current action before clicking."
        });

        const result =
          await processCurrent(type);

        if (result.ok) {

          done++;

          send({
            type: "PROGRESS",
            done,
            total: attempts,
            detail:
              "Action completed successfully."
          });

        } else {

          send({
            type: "STATUS",
            text:
              result.reason,
            detail:
              "Skipped — no destructive click was made."
          });
        }

        if (stopRequested) {
          break;
        }

        const moved =
          await nextVideo();

        if (!moved) {

          send({
            type: "STATUS",
            text:
              "No next-video control found.",
            detail:
              "TikTok may have changed its player layout."
          });

          break;
        }

        await sleep(PAGE_DELAY);
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
        "TikTok Cleaner error:",
        error
      );

      send({
        type: "ERROR",
        text:
          error?.message ||
          "Cleanup failed."
      });

    } finally {

      running = false;
      stopRequested = false;
    }
  }

  /*
   * --------------------------------------------------
   * MESSAGE HANDLER
   * --------------------------------------------------
   */

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
