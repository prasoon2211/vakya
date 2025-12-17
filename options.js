const SETTINGS_KEY = "vakyaSettings";
const API_KEY_KEY = "vakyaApiKey";

// Elements
const apiKeyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key");
const testKeyBtn = document.getElementById("test-key");
const keyStatus = document.getElementById("key-status");
const nativeInput = document.getElementById("native-language");
const targetInput = document.getElementById("target-language");
const levelInputs = document.querySelectorAll('input[name="cefr-level"]');
const simplifyInput = document.getElementById("simplify");
const autoTranslateInput = document.getElementById("auto-translate");
const saveBtn = document.getElementById("save");
const saveStatus = document.getElementById("save-status");

init();

async function init() {
  await restore();
  attachListeners();
}

function attachListeners() {
  toggleKeyBtn?.addEventListener("click", toggleKeyVisibility);
  testKeyBtn?.addEventListener("click", testKey);
  saveBtn?.addEventListener("click", save);
  
  // Live validation for API key
  apiKeyInput?.addEventListener("input", () => {
    keyStatus.className = "status-badge";
    keyStatus.textContent = "";
  });
}

function toggleKeyVisibility() {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  toggleKeyBtn.classList.toggle("showing", isPassword);
}

async function restore() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(API_KEY_KEY)
  ]);
  
  const settings = syncData?.[SETTINGS_KEY] || {};
  const apiKey = localData?.[API_KEY_KEY] || "";
  
  apiKeyInput.value = apiKey;
  nativeInput.value = settings.nativeLanguage || "English";
  targetInput.value = settings.targetLanguage || "German";
  
  const level = settings.cefrLevel || "B1";
  levelInputs.forEach(input => {
    input.checked = input.value === level;
  });
  
  simplifyInput.checked = settings.simplify ?? true;
  autoTranslateInput.checked = settings.autoTranslate ?? false;
  
  // Show saved key status
  if (apiKey) {
    keyStatus.className = "status-badge success";
    keyStatus.textContent = "Saved";
  }
}

async function testKey() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setKeyStatus("error", "Enter a key first");
    return;
  }
  
  setKeyStatus("testing", "Testing...");
  setTestingState(true);
  
  try {
    const response = await chrome.runtime.sendMessage({ type: "test-api-key", apiKey });
    if (response?.ok) {
      setKeyStatus("success", "Valid");
    } else {
      throw new Error(response?.error || "Invalid key");
    }
  } catch (error) {
    setKeyStatus("error", error.message || "Invalid key");
  } finally {
    setTestingState(false);
  }
}

function setKeyStatus(type, text) {
  keyStatus.className = `status-badge ${type}`;
  keyStatus.textContent = text;
}

function setTestingState(testing) {
  testKeyBtn.disabled = testing;
  testKeyBtn.querySelector(".btn-text").textContent = testing ? "Testing..." : "Test connection";
  testKeyBtn.querySelector(".spinner").classList.toggle("hidden", !testing);
}

async function save() {
  const selectedLevel = document.querySelector('input[name="cefr-level"]:checked')?.value || "B1";
  
  const settings = {
    nativeLanguage: nativeInput.value.trim() || "English",
    targetLanguage: targetInput.value.trim() || "German",
    cefrLevel: selectedLevel,
    simplify: simplifyInput.checked,
    autoTranslate: autoTranslateInput.checked
  };
  
  const apiKey = apiKeyInput.value.trim();
  
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    if (apiKey) {
      await chrome.storage.local.set({ [API_KEY_KEY]: apiKey });
      setKeyStatus("success", "Saved");
    }
    showSaveStatus("Settings saved", false);
  } catch (error) {
    showSaveStatus("Failed to save", true);
  }
}

function showSaveStatus(text, isError) {
  saveStatus.textContent = text;
  saveStatus.className = `save-status visible ${isError ? "error" : ""}`;
  setTimeout(() => {
    saveStatus.className = "save-status";
  }, 2500);
}
