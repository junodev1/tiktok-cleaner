(() => {
  "use strict";

  let stopRequested = false;
  let running = false;

  const WAIT_AFTER_ACTION = 1200;
  const WAIT_BETWEEN_ITEMS = 1800;

  function sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function send(message) {
    chrome.runtime.sendMessage(message);
  }

  function visible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getBoundingClientRect().width > 0 &&
      element.getBoundingClientRect().height > 0
    );
  }

  function allButtons() {
    return [
      ...document.querySelectorAll(
        'button, [role="button"], [data-e2e]'
      )
    ].filter(visible);
  }

  function findButton(keywords) {
    const buttons = allButtons();

    for (const button of buttons) {

      const text = normalize(
        button.innerText ||
        button.textContent ||
        ""
      );

      const aria = normalize(
        button.getAttribute("aria-label") ||
        ""
      );

      const title = normalize(
        button.getAttribute("title") ||
        ""
      );

      const e2e = normalize(
        button.getAttribute("data-e2e") ||
        ""
      );

      const combined =
        `${text} ${aria} ${title} ${e2e}`;

      if (
        keywords.some(keyword =>
          combined.includes(keyword)
        )
      ) {
        return button;
      }
    }

    return null;
  }

  function click(element) {
    if (!element) return false;

    element.scrollIntoView({
      behavior: "instant",
      block: "center"
    });

    element.click();

    return true;
  }

  async function clickMenuItem(keywords) {
    await sleep(500);

    const elements = [
      ...document.querySelectorAll(
        '[role="menuitem"], button, [role="button"], div'
      )
    ].filter(visible);

    for (const element of elements) {
      const text = normalize(
        element.innerText ||
        element.textContent ||
        ""
      );

      if (
        text.length < 100 &&
        keywords.some(keyword =>
          text.includes(keyword)
        )
      ) {
        click(element);
        return true;
      }
    }

    return false;
  }

  function getActionKeywords(type) {
    if (type === "unlike") {
      return [
        "unlike",
        "liked"
      ];
    }

    if (type === "repost") {
      return [
        "remove repost",
        "repost"
      ];
    }

    if (type === "favorite") {
      return [
        "remove from favorites",
        "remove from favorite",
        "unfavorite",
        "favorite"
      ];
    }

    return [];
  }

  async function processCurrentItem(type) {

    if (stopRequested) {
      return false;
    }

    const keywords = getActionKeywords(type);

    /*
     * Find the relevant action button.
     *
     * TikTok changes its selectors frequently, so we
     * intentionally look at accessible labels and text
     * rather than relying on one class name.
     */

    let button = findButton(keywords);

    if (button) {
      click(button);

      await sleep(WAIT_AFTER_ACTION);

      return true;
    }

    /*
     * Some TikTok actions are inside a "Share" or
     * "More" menu.
     */

    const moreButton = findButton([
      "more",
      "more options",
      "share"
    ]);

    if (moreButton) {
      click(moreButton);

      await sleep(500);

      const menuClicked =
        await clickMenuItem(keywords);

      if (menuClicked) {
        await sleep(WAIT_AFTER_ACTION);
        return true;
      }
    }

    return false;
  }

  function collectCandidateItems() {

    /*
     * Candidate containers are deliberately broad.
     * TikTok's DOM changes between desktop layouts,
     * account pages and video pages.
     */

    const candidates = [
      ...document.querySelectorAll(
        '[data-e2e*="video"], ' +
        '[data-e2e*="item"], ' +
        'article'
      )
    ];

    return [
      ...new Set(
        candidates.filter(visible)
      )
    ];
  }

  async function scrollPage() {
    window.scrollBy({
      top: window.innerHeight * 0.85,
      behavior: "smooth"
    });

    await sleep(1200);
  }

  async function runCleanup(type) {

    if (running) {
      return;
    }

    running = true;
    stopRequested = false;

    let done = 0;
    let total = 0;

    send({
      type: "PROGRESS",
      status: "Scanning...",
      done,
      total
    });

    try {

      /*
       * This first implementation processes visible
       * candidates and keeps scrolling until no new
       * candidates appear.
       */

      const processed = new WeakSet();

      let unchangedRounds = 0;

      while (!stopRequested) {

        const items = collectCandidateItems();

        let newItemFound = false;

        for (const item of items) {

          if (stopRequested) {
            break;
          }

          if (processed.has(item)) {
            continue;
          }

          processed.add(item);
          newItemFound = true;

          total++;

          send({
            type: "PROGRESS",
            status: `Processing ${type}...`,
            done,
            total
          });

          /*
           * Move the item into view.
           */
          item.scrollIntoView({
            behavior: "instant",
            block: "center"
          });

          await sleep(400);

          const success =
            await processCurrentItem(type);

          if (success) {
            done++;
          }

          send({
            type: "PROGRESS",
            status: success
              ? "Processed"
              : "No matching action found",
            done,
            total
          });

          await sleep(WAIT_BETWEEN_ITEMS);
        }

        if (!newItemFound) {
          unchangedRounds++;
        } else {
          unchangedRounds = 0;
        }

        /*
         * Give TikTok time to load more content.
         */
        await scrollPage();

        /*
         * Don't run forever if the page stopped
         * producing new items.
         */
        if (unchangedRounds >= 5) {
          break;
        }
      }

      if (stopRequested) {

        send({
          type: "STOPPED",
          done,
          total
        });

      } else {

        send({
          type: "FINISHED",
          done,
          total
        });
      }

    } catch (error) {

      console.error(
        "TikTok Cleaner:",
        error
      );

      send({
        type: "ERROR",
        message: error.message || "Cleanup failed."
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

      if (message.command === "START") {

        if (!running) {
          runCleanup(message.type);
        }

        sendResponse({
          started: true
        });

        return true;
      }

      if (message.command === "STOP") {

        stopRequested = true;

        sendResponse({
          stopped: true
        });

        return true;
      }
    }
  );

})();
