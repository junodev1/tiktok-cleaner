const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusElement = document.getElementById("status");
const counterElement = document.getElementById("counter");
const barElement = document.getElementById("bar");

let running = false;

function status(text) {
  statusElement.textContent = text;
}

function setRunning(value) {
  running = value;

  startButton.disabled = value;
  stopButton.disabled = !value;
}

async function getTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];

  if (!tab?.url?.startsWith("https://www.tiktok.com/")) {
    throw new Error(
      "Open TikTok in the current tab first."
    );
  }

  return tab;
}

startButton.addEventListener("click", async () => {
  if (running) return;

  try {
    const tab = await getTab();

    const confirmed = confirm(
      "This will remove your likes from videos using TikTok's Like button.\n\n" +
      "Start?"
    );

    if (!confirmed) return;

    setRunning(true);

    status("Starting...");
    counterElement.textContent = "0 processed";
    barElement.style.width = "0%";

    chrome.tabs.sendMessage(
      tab.id,
      {
        command: "START_UNLIKE"
      },
      response => {
        if (chrome.runtime.lastError) {
          status(
            "Refresh TikTok, open Likes, then try again."
          );

          setRunning(false);
        }
      }
    );

  } catch (error) {
    status(error.message);
  }
});

stopButton.addEventListener("click", async () => {
  try {
    const tab = await getTab();

    chrome.tabs.sendMessage(
      tab.id,
      {
        command: "STOP"
      }
    );

    status("Stopping...");
  } catch {
    status("Unable to stop.");
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (!message) return;

  if (message.type === "STATUS") {
    status(message.text);
  }

  if (message.type === "PROGRESS") {
    counterElement.textContent =
      `${message.done} processed`;

    if (message.total > 0) {
      barElement.style.width =
        `${Math.min(
          100,
          (message.done / message.total) * 100
        )}%`;
    }
  }

  if (message.type === "FINISHED") {
    status(
      `Finished — ${message.done} videos unliked`
    );

    counterElement.textContent =
      `${message.done} processed`;

    barElement.style.width = "100%";

    setRunning(false);
  }

  if (message.type === "STOPPED") {
    status(
      `Stopped — ${message.done} videos processed`
    );

    setRunning(false);
  }

  if (message.type === "ERROR") {
    status(`Error: ${message.text}`);
    setRunning(false);
  }
});
