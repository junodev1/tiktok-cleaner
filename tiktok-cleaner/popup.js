"use strict";

const likesButton = document.getElementById("likes");
const repostsButton = document.getElementById("reposts");
const favoritesButton = document.getElementById("favorites");
const stopButton = document.getElementById("stop");

const statusElement = document.getElementById("status");
const countElement = document.getElementById("count");
const progressElement = document.getElementById("progress");
const detailsElement = document.getElementById("details");

let running = false;

function setStatus(value) {
  statusElement.textContent = value;
}

function setButtons(disabled) {
  likesButton.disabled = disabled;
  repostsButton.disabled = disabled;
  favoritesButton.disabled = disabled;

  stopButton.disabled = !disabled;
}

async function getTikTokTab() {

  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];

  if (!tab || !tab.url) {
    throw new Error("No active tab.");
  }

  if (!tab.url.startsWith("https://www.tiktok.com/")) {
    throw new Error(
      "Open TikTok in the current tab first."
    );
  }

  return tab;
}

async function start(type) {

  if (running) {
    return;
  }

  let tab;

  try {
    tab = await getTikTokTab();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  const names = {
    likes: "Remove All Likes",
    reposts: "Remove All Reposts",
    favorites: "Remove All Favorites"
  };

  const confirmed = confirm(
    `${names[type]}\n\n` +
    "This will modify your TikTok account using " +
    "the normal TikTok website controls.\n\n" +
    "Continue?"
  );

  if (!confirmed) {
    return;
  }

  running = true;

  setButtons(true);

  setStatus("Starting...");
  countElement.textContent = "0";
  progressElement.style.width = "0%";
  detailsElement.textContent = "";

  chrome.tabs.sendMessage(
    tab.id,
    {
      command: "START",
      type
    },
    response => {

      if (chrome.runtime.lastError) {

        setStatus(
          "Refresh TikTok and try again."
        );

        setButtons(false);
        running = false;
      }
    }
  );
}

likesButton.addEventListener(
  "click",
  () => start("likes")
);

repostsButton.addEventListener(
  "click",
  () => start("reposts")
);

favoritesButton.addEventListener(
  "click",
  () => start("favorites")
);

stopButton.addEventListener(
  "click",
  async () => {

    try {

      const tab =
        await getTikTokTab();

      chrome.tabs.sendMessage(
        tab.id,
        {
          command: "STOP"
        }
      );

      setStatus("Stopping...");

    } catch (error) {

      setStatus(error.message);
    }
  }
);

chrome.runtime.onMessage.addListener(
  message => {

    if (!message) {
      return;
    }

    if (message.type === "STATUS") {

      setStatus(
        message.text || "Working..."
      );

      if (message.detail) {
        detailsElement.textContent =
          message.detail;
      }
    }

    if (message.type === "PROGRESS") {

      countElement.textContent =
        message.done || 0;

      if (
        message.total &&
        message.total > 0
      ) {

        progressElement.style.width =
          `${Math.min(
            100,
            (message.done / message.total) * 100
          )}%`;
      }

      if (message.detail) {
        detailsElement.textContent =
          message.detail;
      }
    }

    if (message.type === "FINISHED") {

      setStatus(
        `Finished — ${message.done} removed`
      );

      countElement.textContent =
        message.done || 0;

      progressElement.style.width = "100%";

      setButtons(false);
      running = false;
    }

    if (message.type === "STOPPED") {

      setStatus(
        `Stopped — ${message.done} removed`
      );

      countElement.textContent =
        message.done || 0;

      setButtons(false);
      running = false;
    }

    if (message.type === "ERROR") {

      setStatus(
        message.text || "An error occurred."
      );

      setButtons(false);
      running = false;
    }
  }
);
