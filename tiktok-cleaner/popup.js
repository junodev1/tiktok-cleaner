let activeTabId = null;
let running = false;

const unlikeBtn = document.getElementById("unlikeBtn");
const repostBtn = document.getElementById("repostBtn");
const favoriteBtn = document.getElementById("favoriteBtn");
const stopBtn = document.getElementById("stopBtn");

const statusText = document.getElementById("status");
const counterText = document.getElementById("counter");
const progressBar = document.getElementById("progress");

function setStatus(text) {
  statusText.textContent = text;
}

function setProgress(done, total) {
  counterText.textContent = `${done} / ${total}`;

  const percentage =
    total > 0
      ? Math.min(100, (done / total) * 100)
      : 0;

  progressBar.style.width = `${percentage}%`;
}

function setButtonsDisabled(disabled) {
  unlikeBtn.disabled = disabled;
  repostBtn.disabled = disabled;
  favoriteBtn.disabled = disabled;
  stopBtn.disabled = !disabled;
}

async function getTikTokTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];

  if (!tab || !tab.url || !tab.url.startsWith("https://www.tiktok.com/")) {
    throw new Error(
      "Open TikTok in the active browser tab first."
    );
  }

  return tab;
}

async function start(type) {
  if (running) return;

  let tab;

  try {
    tab = await getTikTokTab();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  const confirmed = confirm(
    `Start "${type}" cleanup?\n\n` +
    `This will perform actions on your TikTok account ` +
    `using the currently logged-in page.`
  );

  if (!confirmed) {
    return;
  }

  running = true;
  activeTabId = tab.id;

  setButtonsDisabled(true);

  setStatus("Starting...");
  setProgress(0, 0);

  chrome.tabs.sendMessage(
    activeTabId,
    {
      command: "START",
      type
    },
    response => {
      if (chrome.runtime.lastError) {
        setStatus(
          "Refresh TikTok and try again."
        );
        resetUI();
        return;
      }

      if (!response) {
        setStatus("No response from TikTok.");
        resetUI();
      }
    }
  );
}

function stop() {
  if (!running || !activeTabId) {
    return;
  }

  chrome.tabs.sendMessage(
    activeTabId,
    {
      command: "STOP"
    }
  );

  setStatus("Stopping...");
}

function resetUI() {
  running = false;
  activeTabId = null;

  setButtonsDisabled(false);
}

unlikeBtn.addEventListener(
  "click",
  () => start("unlike")
);

repostBtn.addEventListener(
  "click",
  () => start("repost")
);

favoriteBtn.addEventListener(
  "click",
  () => start("favorite")
);

stopBtn.addEventListener(
  "click",
  stop
);

chrome.runtime.onMessage.addListener(
  message => {

    if (!message) return;

    if (message.type === "PROGRESS") {
      setStatus(message.status || "Processing...");
      setProgress(
        message.done || 0,
        message.total || 0
      );
    }

    if (message.type === "FINISHED") {
      setStatus(
        `Finished: ${message.done} processed`
      );

      setProgress(
        message.done,
        message.total
      );

      resetUI();
    }

    if (message.type === "STOPPED") {
      setStatus(
        `Stopped: ${message.done} processed`
      );

      setProgress(
        message.done,
        message.total
      );

      resetUI();
    }

    if (message.type === "ERROR") {
      setStatus(
        message.message || "Something went wrong."
      );

      resetUI();
    }
  }
);
