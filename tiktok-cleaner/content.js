(() => {
  "use strict";

  let running = false;
  let stopRequested = false;

  /*
   * TikTok can rate-limit rapid interactions.
   * Keep this deliberately slow.
   */
  const ACTION_DELAY = 1800;
  const NEXT_DELAY = 1500;

  function sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  function send(message) {
    chrome.runtime.sendMessage(message);
  }

  function visible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  /*
   * TikTok has used these selectors for the web Like
   * control. Keep several fallbacks because the DOM
   * changes between layouts.
   */
  function findLikeControl() {

    const selectors = [
      '[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]',
      'span[data-e2e="browse-like-icon"]',
      'span[data-e2e="like-icon"]'
    ];

    for (const selector of selectors) {

      const elements = [
        ...document.querySelectorAll(selector)
      ];

      for (const element of elements) {

        if (!visible(element)) {
          continue;
        }

        /*
         * The data-e2e element is sometimes a span
         * inside the actual clickable button.
         */
        const button =
          element.closest("button") ||
          element.closest('[role="button"]') ||
          element;

        if (visible(button)) {
          return button;
        }
      }
    }

    return null;
  }

  /*
   * Determine whether the current Like button is
   * actually active.
   *
   * We NEVER click it unless we believe the video
   * is already liked. This prevents accidentally
   * adding likes.
   */
  function isLiked(button) {

    if (!button) {
      return false;
    }

    /*
     * aria-pressed is the cleanest signal when available.
     */
    const pressed =
      button.getAttribute("aria-pressed");

    if (pressed === "true") {
      return true;
    }

    /*
     * Look for TikTok's red heart SVG.
     *
     * TikTok's red brand color is approximately:
     * rgb(254, 44, 85)
     */
    const redHeart =
      button.querySelector(
        'svg [fill="rgb(254, 44, 85)"],' +
        'svg [fill="rgba(254, 44, 85, 1.0)"],' +
        'svg path[fill*="254,44,85"],' +
        'svg path[fill*="254, 44, 85"]'
      );

    if (redHeart) {
      return true;
    }

    /*
     * Some versions put the fill on the SVG itself.
     */
    const svgs = button.querySelectorAll("svg");

    for (const svg of svgs) {

      const fill =
        (svg.getAttribute("fill") || "")
          .replace(/\s/g, "")
          .toLowerCase();

      if (
        fill.includes("254,44,85") ||
        fill.includes("fe2c55")
      ) {
        return true;
      }
    }

    /*
     * Accessibility fallback.
     */
    const label = (
      button.getAttribute("aria-label") || ""
    ).toLowerCase();

    if (
      label.includes("liked") &&
      !label.includes("like this")
    ) {
      return true;
    }

    return false;
  }

  async function unlikeCurrentVideo() {

    const likeButton = findLikeControl();

    if (!likeButton) {
      return {
        success: false,
        reason: "Like button not found"
      };
    }

    /*
     * SAFETY CHECK:
     *
     * Never click an inactive heart.
     */
    if (!isLiked(likeButton)) {
      return {
        success: false,
        reason: "Video does not appear to be liked"
      };
    }

    likeButton.scrollIntoView({
      behavior: "instant",
      block: "center"
    });

    await sleep(300);

    likeButton.click();

    /*
     * Wait for TikTok to process the action.
     */
    await sleep(ACTION_DELAY);

    /*
     * Verify the heart changed state.
     */
    const after =
      findLikeControl();

    if (after && !isLiked(after)) {
      return {
        success: true
      };
    }

    return {
      success: false,
      reason: "TikTok did not confirm the unlike"
    };
  }

  function findNextButton() {

    const selectors = [
      'button[data-e2e="arrow-right"]',
      '[data-e2e="arrow-right"]',
      'button[aria-label*="Next"]',
      'button[aria-label*="next"]'
    ];

    for (const selector of selectors) {

      const button =
        document.querySelector(selector);

      if (
        button &&
        visible(button) &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true"
      ) {
        return button;
      }
    }

    return null;
  }

  async function moveNext() {

    const next = findNextButton();

    if (!next) {
      return false;
    }

    next.click();

    await sleep(NEXT_DELAY);

    return true;
  }

  /*
   * When the Likes page opens a video in a viewer,
   * this function attempts to identify that viewer.
   */
  function isVideoViewerOpen() {

    return Boolean(
      document.querySelector(
        '[data-e2e="browse-like-icon"],' +
        '[data-e2e="like-icon"]'
      )
    );
  }

  /*
   * Find a video from the user's liked-video grid.
   *
   * Older/current TikTok layouts have used
   * data-e2e="user-liked-item".
   */
  function findLikedGridItem() {

    const selectors = [
      '[data-e2e="user-liked-item"]',
      '[data-e2e="user-liked-item-list"] a',
      '[data-e2e="user-liked-item"] a'
    ];

    for (const selector of selectors) {

      const item =
        document.querySelector(selector);

      if (item && visible(item)) {
        return item;
      }
    }

    return null;
  }

  async function openFirstLikedVideo() {

    const item =
      findLikedGridItem();

    if (!item) {
      return false;
    }

    const link =
      item.matches("a")
        ? item
        : item.querySelector("a");

    if (!link) {
      return false;
    }

    link.click();

    /*
     * Wait for viewer/player.
     */
    for (let i = 0; i < 20; i++) {

      await sleep(500);

      if (isVideoViewerOpen()) {
        return true;
      }
    }

    return false;
  }

  async function run() {

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
        text: "Checking TikTok page..."
      });

      /*
       * If the viewer isn't already open, try to open
       * the first liked video.
       */
      if (!isVideoViewerOpen()) {

        send({
          type: "STATUS",
          text: "Opening a liked video..."
        });

        const opened =
          await openFirstLikedVideo();

        if (!opened) {
          throw new Error(
            "Couldn't open a liked video. " +
            "Open Profile → Liked videos and try again."
          );
        }
      }

      while (!stopRequested) {

        attempts++;

        send({
          type: "STATUS",
          text: `Checking video ${attempts}...`
        });

        const result =
          await unlikeCurrentVideo();

        if (result.success) {

          done++;

          send({
            type: "PROGRESS",
            done,
            total: attempts
          });

        } else {

          send({
            type: "STATUS",
            text: result.reason
          });

          /*
           * Don't count a video as successfully
           * unliked unless verification succeeded.
           */
        }

        if (stopRequested) {
          break;
        }

        /*
         * Move to the next liked video.
         */
        const moved =
          await moveNext();

        if (!moved) {

          send({
            type: "STATUS",
            text: "No next video button found."
          });

          break;
        }
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
          "Unexpected error."
      });

    } finally {

      running = false;
      stopRequested = false;
    }
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      if (!message) {
        return;
      }

      if (message.command === "START_UNLIKE") {

        run();

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
