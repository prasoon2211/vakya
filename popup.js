const SETTINGS_KEY = "vakyaSettings";
const API_KEY_KEY = "vakyaApiKey";

const translateBtn = document.getElementById("translate-btn");
const settingsBtn = document.getElementById("settings-btn");
const setupKeyBtn = document.getElementById("setup-key-btn");
const noKeyWarning = document.getElementById("no-key-warning");
const displayTarget = document.getElementById("display-target");
const displayLevel = document.getElementById("display-level");

init();

async function init() {
  const [settings, hasKey] = await Promise.all([getSettings(), hasApiKey()]);
  
  displayTarget.textContent = settings.targetLanguage || "German";
  displayLevel.textContent = settings.cefrLevel || "B1";
  
  if (!hasKey) {
    noKeyWarning.classList.remove("hidden");
    translateBtn.disabled = true;
  }
}

translateBtn?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  
  try {
    // Try to send message first
    await chrome.tabs.sendMessage(tab.id, { type: "translate-page" });
    window.close();
  } catch (error) {
    // Content script not loaded - inject it first
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["contentScript.js"]
      });
      // Now send the message
      await chrome.tabs.sendMessage(tab.id, { type: "translate-page" });
      window.close();
    } catch (injectError) {
      // Can't inject on this page (chrome://, etc.)
      alert("Cannot translate this page. Try a regular webpage.");
    }
  }
});

settingsBtn?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

setupKeyBtn?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return stored?.[SETTINGS_KEY] || {};
}

async function hasApiKey() {
  const stored = await chrome.storage.local.get(API_KEY_KEY);
  return Boolean(stored?.[API_KEY_KEY]);
}
