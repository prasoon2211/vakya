const DEFAULT_SETTINGS = {
  nativeLanguage: "English",
  targetLanguage: "German",
  cefrLevel: "B1",
  simplify: true,
  autoTranslate: false
};

const SETTINGS_KEY = "vakyaSettings";
const API_KEY_KEY = "vakyaApiKey";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "translate-blocks") {
    handleTranslationRequest(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "test-api-key") {
    testApiKey(message.apiKey)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "analyze-word") {
    analyzeWord(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function analyzeWord(payload) {
  const { word, context, settings } = payload;
  const apiKey = await getApiKey();
  
  const prompt = `Analyze the word "${word}" in this context: "${context}".
Target language: ${settings.targetLanguage}. Learner speaks: ${settings.nativeLanguage}.
Return JSON: {
  "translation": "string",
  "pos": "string (noun/verb/adj etc)",
  "article": "string or null (if applicable, e.g. der/die/das)",
  "example": "simple example sentence in target language",
  "explanation": "brief explanation of usage in this context"
}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function handleTranslationRequest(payload) {
  const { blocks } = payload;
  console.log("[Vakya] Starting translation, blocks:", blocks.length);

  const settings = await getSettings();
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("Missing OpenAI API key. Set it in the options page.");
  }

  // Create batches for parallel translation - max 2 blocks per batch for speed
  const batches = [];
  for (let i = 0; i < blocks.length; i += 2) {
    batches.push(blocks.slice(i, i + 2));
  }
  console.log("[Vakya] Batches created:", batches.length, "from", blocks.length, "blocks");

  // Run all batches in parallel, tracking failures
  const totalBatches = batches.length;
  let failedCount = 0;

  const results = await Promise.all(
    batches.map(async (batch, index) => {
      const result = await translateBatch(batch, settings, apiKey, index + 1, totalBatches);
      if (result.failed) {
        failedCount++;
      }
      return result.blocks;
    })
  );

  const flatResults = results.flat();

  // Return results along with failure info
  return {
    blocks: flatResults,
    failedBatches: failedCount,
    totalBatches: totalBatches
  };
}

async function translateBatch(blocks, settings, apiKey, batchNum, totalBatches) {
  const prompt = buildPrompt(blocks, settings);
  console.log(`[Vakya] Batch ${batchNum}/${totalBatches} SENDING - ${blocks.length} blocks, ${prompt.length} chars`);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.log("[Vakya] Request timeout after 120s");
    controller.abort();
  }, 120000);

  try {
    const startTime = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Translate the numbered text blocks. Return JSON with 'blocks' array: [{ original, translated }]. Do NOT include the #1:, #2: etc. prefixes in your translations - just the translated text."
          },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    console.log(`[Vakya] Batch ${batchNum}/${totalBatches} RECEIVED - ${Date.now() - startTime}ms, status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Vakya] API error response:", errorText);
      throw new Error(`API Error: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    console.log("[Vakya] Response parsed, has choices:", !!data.choices);

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("[Vakya] No content in response:", JSON.stringify(data).slice(0, 500));
      throw new Error("Empty response from API");
    }

    const parsed = JSON.parse(content);
    // Strip any #N: prefixes that the LLM might have included
    const cleanedBlocks = (parsed.blocks || []).map(block => ({
      original: block.original,
      translated: (block.translated || '').replace(/^#\d+:\s*/, '')
    }));
    console.log(`[Vakya] Batch ${batchNum}/${totalBatches} DONE - got ${cleanedBlocks.length} translated blocks`);
    return { blocks: cleanedBlocks, failed: false };
  } catch (error) {
    clearTimeout(timeout);
    console.error(`[Vakya] Batch ${batchNum}/${totalBatches} FAILED - ${error.name}: ${error.message}`);
    // Return original text as fallback, mark as failed
    return {
      blocks: blocks.map(b => ({ original: b, translated: b })),
      failed: true
    };
  }
}

function buildPrompt(blocks, settings) {
  const { targetLanguage, nativeLanguage, cefrLevel } = settings;
  const numbered = blocks.map((block, index) => `#${index + 1}: ${block}`).join("\n\n");
  return `Translate to ${targetLanguage} (Level ${cefrLevel}) for a ${nativeLanguage} speaker.\n\n${numbered}`;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored?.[SETTINGS_KEY] || {}) };
}

async function getApiKey() {
  const stored = await chrome.storage.local.get(API_KEY_KEY);
  return stored?.[API_KEY_KEY] || "";
}

async function testApiKey(providedKey) {
  const apiKey = providedKey || "";
  if (!apiKey.trim()) {
    throw new Error("Please enter an API key first.");
  }
  const response = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`
    }
  });
  if (!response.ok) {
    throw new Error(`Invalid API key (${response.status})`);
  }
}
