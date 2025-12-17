/**
 * Vakya Content Script
 * Handles page translation, word hover tooltips, and on-demand word analysis
 */

(function() {
  'use strict';

  // Constants
  const STYLE_ID = 'vakya-styles';
  const OVERLAY_ID = 'vakya-overlay';
  const TOOLTIP_ID = 'vakya-tooltip';
  const FLOATING_BAR_ID = 'vakya-floating-bar';
  const SETTINGS_KEY = 'vakyaSettings';

  // State
  let translationState = null;
  let activeTooltip = null;
  let activeOverlay = null;
  let activeFloatingBar = null;
  let currentClickedWord = null;
  let browserTranslator = null;
  let browserTranslatorInitialized = false; // Track if we've tried to init
  let translatorLanguages = null; // Store language pair for lazy init
  let isModifierHeld = false;
  let hoveredSentence = null;

  // Initialize
  function init() {
    injectStyles();
    attachGlobalListeners();
    chrome.runtime.onMessage.addListener(handleMessage);
    checkAutoTranslate();
  }

  // Message handler
  function handleMessage(message, sender, sendResponse) {
    if (message?.type === 'translate-page') {
      translatePage();
    }
    return false;
  }

  // Check if auto-translate is enabled
  async function checkAutoTranslate() {
    try {
      const settings = await getSettings();
      if (settings.autoTranslate) {
        translatePage();
      }
    } catch (err) {
      console.error('[Vakya] Auto-translate check failed:', err);
    }
  }

  // Main translation function
  async function translatePage() {
    if (translationState) {
      showFloatingBar('Page already translated', 'info');
      return;
    }

    const articleRoot = findArticleRoot();
    if (!articleRoot) {
      showOverlay('error', 'No content found', 'Navigate to an article page with readable content.');
      return;
    }

    const paragraphs = collectParagraphs(articleRoot);
    if (paragraphs.elements.length === 0) {
      showOverlay('error', 'No readable content', 'This page doesn\'t have enough text to translate.');
      return;
    }

    showOverlay('loading', 'Translating...', `Processing ${paragraphs.texts.length} paragraphs`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'translate-blocks',
        payload: { blocks: paragraphs.texts }
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Translation failed');
      }

      hideOverlay();
      const { blocks, failedBatches, totalBatches } = response.result;
      applyTranslations(paragraphs.elements, blocks);

      // Store language pair for lazy browser translator init (requires user gesture)
      const settings = await getSettings();
      translatorLanguages = {
        source: settings.targetLanguage,
        target: settings.nativeLanguage
      };
      console.log('[Vakya] Translator will be initialized on first word click');

      // Show success message with warning if some batches failed
      if (failedBatches > 0) {
        showFloatingBar(`Translated ${paragraphs.elements.length} paragraphs (${failedBatches}/${totalBatches} batches failed - some text unchanged)`, 'warning');
      } else {
        showFloatingBar(`Translated ${paragraphs.elements.length} paragraphs`, 'success');
      }
    } catch (error) {
      handleTranslationError(error);
    }
  }

  // Handle translation errors
  function handleTranslationError(error) {
    const message = error.message || 'Translation failed';
    let hint = 'Please try again later.';
    let showSettings = false;

    if (message.includes('API key')) {
      hint = 'Add your OpenAI API key in settings.';
      showSettings = true;
    } else if (message.includes('429') || message.includes('rate')) {
      hint = 'Rate limited. Wait a moment and try again.';
    } else if (message.includes('401') || message.includes('Invalid')) {
      hint = 'Your API key may be invalid.';
      showSettings = true;
    }

    showOverlay('error', message, hint, showSettings);
  }

  // Apply translations to DOM
  function applyTranslations(elements, blocks) {
    const originals = [];
    const count = Math.min(elements.length, blocks.length);

    for (let i = 0; i < count; i++) {
      const el = elements[i];
      const block = blocks[i];

      originals.push(el.textContent || '');
      el.dataset.vakyaOriginal = el.textContent || '';
      el.dataset.vakyaContext = block.original || '';
      el.classList.add('vakya-translated');

      renderTranslatedBlock(el, block.translated || block.original);

      // Add sentence mode handlers
      el.addEventListener('mouseenter', handleSentenceEnter);
      el.addEventListener('mouseleave', handleSentenceLeave);
      el.addEventListener('click', handleSentenceClick);
    }

    translationState = {
      elements: elements.slice(0, count),
      originals
    };
  }

  // Sentence mode handlers (when Cmd/Ctrl is held)
  function handleSentenceEnter(event) {
    if (!isModifierHeld) return;
    const el = event.currentTarget;
    clearSentenceHover();
    hoveredSentence = el;
    el.classList.add('vakya-sentence-hover');
  }

  function handleSentenceLeave(event) {
    if (!isModifierHeld) return;
    const el = event.currentTarget;
    el.classList.remove('vakya-sentence-hover');
    if (hoveredSentence === el) {
      hoveredSentence = null;
    }
  }

  function handleSentenceClick(event) {
    if (!isModifierHeld) return;
    event.preventDefault();
    event.stopPropagation();

    const el = event.currentTarget;
    showOriginalTooltip(el);
  }

  // Render translated text with clickable words
  function renderTranslatedBlock(element, text) {
    element.textContent = '';
    const fragments = text.split(/(\s+)/);

    for (const fragment of fragments) {
      if (!fragment) continue;

      if (/[\p{L}]/u.test(fragment)) {
        const span = document.createElement('span');
        span.textContent = fragment;
        span.className = 'vakya-word';
        span.dataset.word = fragment.replace(/[^\p{L}\p{Pd}\p{M}']/gu, '');

        span.addEventListener('click', handleWordClick);

        element.appendChild(span);
      } else {
        element.appendChild(document.createTextNode(fragment));
      }
    }
  }

  // Word click handler
  function handleWordClick(event) {
    // If modifier is held, let the sentence click handler deal with it
    if (isModifierHeld) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const span = event.currentTarget;

    // If clicking the same word, close the tooltip
    if (currentClickedWord === span && activeTooltip) {
      hideTooltip();
      return;
    }

    currentClickedWord = span;
    // Regular click: show word popup
    showWordTooltip(span);
  }

  // Tooltip functions
  function showOriginalTooltip(el) {
    hideTooltip();

    // Get original text - el might be the translated paragraph itself or a word inside it
    const original = el.dataset?.vakyaOriginal || el.closest('[data-vakya-original]')?.dataset.vakyaOriginal || '';
    const content = `
      <div class="vakya-tooltip-label">Original Text</div>
      <div class="vakya-tooltip-original">${escapeHtml(original)}</div>
    `;

    createTooltip(content, el);
  }

  async function showWordTooltip(span) {
    hideTooltip();

    const word = span.dataset.word || span.textContent;

    // Lazy init browser translator on first click (requires user gesture)
    if (!browserTranslatorInitialized && translatorLanguages) {
      browserTranslatorInitialized = true;
      // Show loading while we try to init
      const loadingContent = `
        <div class="vakya-tooltip-header">
          <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
        </div>
        <div class="vakya-tooltip-loading">
          <span class="vakya-loading"></span>
          <span>Setting up translator...</span>
        </div>
      `;
      createTooltip(loadingContent, span);

      await initBrowserTranslator(translatorLanguages.source, translatorLanguages.target);

      if (!activeTooltip) return; // Tooltip was closed
    }

    // Try browser translation if available
    if (browserTranslator) {
      // Show loading state while browser translates
      if (!activeTooltip) {
        const loadingContent = `
          <div class="vakya-tooltip-header">
            <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
          </div>
          <div class="vakya-tooltip-loading">
            <span class="vakya-loading"></span>
            <span>Translating...</span>
          </div>
        `;
        createTooltip(loadingContent, span);
      } else {
        activeTooltip.innerHTML = `
          <div class="vakya-tooltip-header">
            <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
          </div>
          <div class="vakya-tooltip-loading">
            <span class="vakya-loading"></span>
            <span>Translating...</span>
          </div>
        `;
      }

      const browserTranslation = await translateWithBrowser(word);

      if (!activeTooltip) return; // Tooltip was closed

      if (browserTranslation) {
        // Show browser translation with Analyze button
        activeTooltip.innerHTML = `
          <div class="vakya-tooltip-header">
            <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
          </div>
          <div class="vakya-tooltip-translation">${escapeHtml(browserTranslation)}</div>
          <button class="vakya-tooltip-btn" id="vakya-analyze-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            Analyze Word
          </button>
        `;
        attachAnalyzeButton(span);
        return;
      }
    }

    // No browser translator available - show word with Analyze button only
    const content = `
      <div class="vakya-tooltip-header">
        <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
      </div>
      <button class="vakya-tooltip-btn" id="vakya-analyze-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        Analyze Word
      </button>
    `;
    if (activeTooltip) {
      activeTooltip.innerHTML = content;
    } else {
      createTooltip(content, span);
    }
    attachAnalyzeButton(span);
  }

  function attachAnalyzeButton(span) {
    document.getElementById('vakya-analyze-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      analyzeWordWithButton(span);
    });
  }

  function createTooltip(content, span) {
    activeTooltip = document.createElement('div');
    activeTooltip.id = TOOLTIP_ID;
    activeTooltip.className = 'vakya-tooltip';
    activeTooltip.innerHTML = content;

    // Prevent clicks inside tooltip from closing it
    activeTooltip.addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(activeTooltip);

    // Position near the clicked word
    const rect = span.getBoundingClientRect();
    positionTooltipNear(rect);

    // Animate in
    requestAnimationFrame(() => {
      if (activeTooltip) {
        activeTooltip.classList.add('vakya-tooltip-visible');
      }
    });
  }

  function positionTooltipNear(wordRect) {
    if (!activeTooltip) return;

    const padding = 8;
    const tooltipRect = activeTooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Position below the word by default
    let left = wordRect.left + window.scrollX;
    let top = wordRect.bottom + window.scrollY + padding;

    // If tooltip goes off right edge, align to right edge of word
    if (left + tooltipRect.width > vw - padding) {
      left = wordRect.right + window.scrollX - tooltipRect.width;
    }

    // If tooltip goes off bottom, position above the word
    if (wordRect.bottom + tooltipRect.height + padding > vh) {
      top = wordRect.top + window.scrollY - tooltipRect.height - padding;
    }

    // Ensure minimum padding from edges
    left = Math.max(padding, Math.min(left, vw - tooltipRect.width - padding));

    activeTooltip.style.left = `${left}px`;
    activeTooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
    currentClickedWord = null;
  }

  // Analyze word via API (no button, direct call)
  async function analyzeWord(span) {
    const word = span.dataset.word || span.textContent;
    const context = span.closest('[data-vakya-context]')?.dataset.vakyaContext || '';

    try {
      const settings = await getSettings();
      const response = await chrome.runtime.sendMessage({
        type: 'analyze-word',
        payload: { word, context, settings }
      });

      if (response?.ok && response.result) {
        updateTooltipWithAnalysis(word, response.result);
      } else {
        throw new Error(response?.error || 'Analysis failed');
      }
    } catch (err) {
      updateTooltipWithError(word, err.message);
    }
  }

  // Analyze word via API (with button loading state)
  async function analyzeWordWithButton(span) {
    const btn = document.getElementById('vakya-analyze-btn');
    if (btn) {
      btn.innerHTML = '<span class="vakya-loading"></span> Analyzing...';
      btn.disabled = true;
    }

    const word = span.dataset.word || span.textContent;
    const context = span.closest('[data-vakya-context]')?.dataset.vakyaContext || '';

    try {
      const settings = await getSettings();
      const response = await chrome.runtime.sendMessage({
        type: 'analyze-word',
        payload: { word, context, settings }
      });

      if (response?.ok && response.result) {
        updateTooltipWithAnalysis(word, response.result);
      } else {
        throw new Error(response?.error || 'Analysis failed');
      }
    } catch (err) {
      if (btn) {
        btn.innerHTML = 'Error - try again';
        btn.disabled = false;
        // Re-attach click handler for retry
        btn.onclick = (e) => {
          e.stopPropagation();
          analyzeWordWithButton(span);
        };
      }
    }
  }

  function updateTooltipWithError(word, errorMsg) {
    if (!activeTooltip) return;

    activeTooltip.innerHTML = `
      <div class="vakya-tooltip-header">
        <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
      </div>
      <div class="vakya-tooltip-error">
        <span>Failed to load translation</span>
      </div>
    `;
  }

  function updateTooltipWithAnalysis(word, data) {
    if (!activeTooltip) return;

    const chips = [];
    if (data.article) {
      chips.push(`<span class="vakya-chip vakya-chip-article">${escapeHtml(data.article)}</span>`);
    }
    if (data.pos) {
      chips.push(`<span class="vakya-chip">${escapeHtml(data.pos)}</span>`);
    }

    activeTooltip.innerHTML = `
      <div class="vakya-tooltip-header">
        <span class="vakya-tooltip-word">${escapeHtml(word)}</span>
        ${chips.length ? `<div class="vakya-tooltip-chips">${chips.join('')}</div>` : ''}
      </div>
      <div class="vakya-tooltip-translation">${escapeHtml(data.translation || '')}</div>
      ${data.example ? `<div class="vakya-tooltip-example">"${escapeHtml(data.example)}"</div>` : ''}
      ${data.explanation ? `<div class="vakya-tooltip-hint">${escapeHtml(data.explanation)}</div>` : ''}
    `;
  }

  // Overlay functions
  function showOverlay(type, title, subtitle, showSettingsBtn = false) {
    hideOverlay();

    let icon = '';
    if (type === 'loading') {
      icon = '<div class="vakya-spinner"></div>';
    } else if (type === 'error') {
      icon = `
        <div class="vakya-icon-error">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
      `;
    }

    activeOverlay = document.createElement('div');
    activeOverlay.id = OVERLAY_ID;
    activeOverlay.className = `vakya-overlay vakya-overlay-${type}`;
    activeOverlay.innerHTML = `
      <div class="vakya-overlay-content">
        ${icon}
        <div class="vakya-overlay-title">${escapeHtml(title)}</div>
        <div class="vakya-overlay-subtitle">${escapeHtml(subtitle)}</div>
        ${showSettingsBtn ? '<button class="vakya-overlay-btn" id="vakya-open-settings">Open Settings</button>' : ''}
        ${type === 'error' ? '<button class="vakya-overlay-dismiss" id="vakya-dismiss">Dismiss</button>' : ''}
      </div>
    `;

    document.body.appendChild(activeOverlay);

    document.getElementById('vakya-dismiss')?.addEventListener('click', hideOverlay);
    document.getElementById('vakya-open-settings')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      hideOverlay();
    });
  }

  function hideOverlay() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
  }

  // Floating bar functions
  function showFloatingBar(message, type = 'info') {
    hideFloatingBar();

    const hasTranslation = translationState !== null;

    activeFloatingBar = document.createElement('div');
    activeFloatingBar.id = FLOATING_BAR_ID;
    activeFloatingBar.className = `vakya-floating-bar vakya-bar-${type}`;
    activeFloatingBar.innerHTML = `
      <div class="vakya-bar-content">
        <span class="vakya-bar-message">${escapeHtml(message)}</span>
        ${hasTranslation ? `
          <button class="vakya-bar-btn" id="vakya-restore">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
            Restore
          </button>
        ` : ''}
        <button class="vakya-bar-close" id="vakya-close-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(activeFloatingBar);

    document.getElementById('vakya-restore')?.addEventListener('click', restoreOriginal);
    document.getElementById('vakya-close-bar')?.addEventListener('click', hideFloatingBar);

    // Auto-hide non-translation messages
    if (type === 'success' && !hasTranslation) {
      setTimeout(hideFloatingBar, 3000);
    }
  }

  function hideFloatingBar() {
    if (activeFloatingBar) {
      activeFloatingBar.remove();
      activeFloatingBar = null;
    }
  }

  // Restore original text
  function restoreOriginal() {
    if (!translationState) return;

    translationState.elements.forEach((el, i) => {
      // Remove event listeners before restoring
      el.removeEventListener('mouseenter', handleSentenceEnter);
      el.removeEventListener('mouseleave', handleSentenceLeave);
      el.removeEventListener('click', handleSentenceClick);

      el.textContent = translationState.originals[i] || '';
      el.classList.remove('vakya-translated');
      delete el.dataset.vakyaOriginal;
      delete el.dataset.vakyaContext;
    });

    translationState = null;
    browserTranslator = null;
    browserTranslatorInitialized = false;
    translatorLanguages = null;
    hideTooltip();
    hideFloatingBar();

    showFloatingBar('Original restored', 'info');
    setTimeout(hideFloatingBar, 2000);
  }

  // DOM helpers
  function findArticleRoot() {
    return document.querySelector('article') 
      || document.querySelector('main') 
      || document.querySelector('[role="main"]') 
      || document.querySelector('[role="article"]')
      || document.body;
  }

  function collectParagraphs(root) {
    const selectors = [
      'article p', 'article li', 'article h1', 'article h2', 'article h3', 'article h4',
      'main p', 'main li', 'main h1', 'main h2', 'main h3', 'main h4',
      '[role="main"] p', '[role="article"] p'
    ].join(', ');

    let elements = Array.from(root.querySelectorAll(selectors))
      .filter(el => (el.textContent || '').trim().length > 40);

    // Fallback
    if (elements.length === 0) {
      elements = Array.from(document.querySelectorAll('p, h1, h2, h3'))
        .filter(el => (el.textContent || '').trim().length > 40);
    }

    return {
      elements,
      texts: elements.map(el => el.textContent.trim())
    };
  }

  // Global listeners for closing tooltip and modifier keys
  function attachGlobalListeners() {
    // Close tooltip when clicking outside
    document.addEventListener('click', (e) => {
      if (activeTooltip && !activeTooltip.contains(e.target) && !e.target.closest('.vakya-word') && !e.target.closest('.vakya-translated')) {
        hideTooltip();
      }
    });

    // Close tooltip on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeTooltip) {
        hideTooltip();
      }
      // Track Cmd/Ctrl key for sentence mode
      if ((e.key === 'Meta' || e.key === 'Control') && !isModifierHeld) {
        isModifierHeld = true;
        document.body.classList.add('vakya-sentence-mode');
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        isModifierHeld = false;
        document.body.classList.remove('vakya-sentence-mode');
        clearSentenceHover();
      }
    });

    // Also clear if window loses focus
    window.addEventListener('blur', () => {
      isModifierHeld = false;
      document.body.classList.remove('vakya-sentence-mode');
      clearSentenceHover();
    });
  }

  function clearSentenceHover() {
    if (hoveredSentence) {
      hoveredSentence.classList.remove('vakya-sentence-hover');
      hoveredSentence = null;
    }
  }

  // Browser Translator API
  async function initBrowserTranslator(sourceLanguage, targetLanguage) {
    // Map language names to ISO codes (BCP 47)
    const langCodes = {
      'English': 'en', 'German': 'de', 'French': 'fr', 'Spanish': 'es',
      'Italian': 'it', 'Portuguese': 'pt', 'Dutch': 'nl', 'Polish': 'pl',
      'Russian': 'ru', 'Japanese': 'ja', 'Chinese': 'zh', 'Korean': 'ko'
    };

    const sourceLang = langCodes[sourceLanguage] || sourceLanguage.toLowerCase().slice(0, 2);
    const targetLang = langCodes[targetLanguage] || targetLanguage.toLowerCase().slice(0, 2);

    console.log(`[Vakya] Attempting to init Browser Translator: ${sourceLang} -> ${targetLang}`);
    console.log('[Vakya] Checking available APIs...', {
      Translator: typeof Translator !== 'undefined',
      'self.Translator': 'Translator' in self,
      'window.Translator': typeof window !== 'undefined' && 'Translator' in window,
      translation: typeof translation !== 'undefined',
      'self.translation': 'translation' in self,
      ai: typeof ai !== 'undefined',
      'self.ai': 'ai' in self
    });

    try {
      // Try different API locations
      let TranslatorAPI = null;

      if (typeof Translator !== 'undefined') {
        TranslatorAPI = Translator;
        console.log('[Vakya] Using global Translator');
      } else if ('Translator' in self) {
        TranslatorAPI = self.Translator;
        console.log('[Vakya] Using self.Translator');
      } else if (typeof translation !== 'undefined' && translation.createTranslator) {
        // Alternative API shape
        console.log('[Vakya] Using translation.createTranslator API');
        browserTranslator = await translation.createTranslator({
          sourceLanguage: sourceLang,
          targetLanguage: targetLang
        });
        console.log('[Vakya] Browser Translator initialized via translation API');
        return true;
      } else if ('ai' in self && self.ai?.translator) {
        // Older Chrome API location
        console.log('[Vakya] Using self.ai.translator API');
        browserTranslator = await self.ai.translator.create({
          sourceLanguage: sourceLang,
          targetLanguage: targetLang
        });
        console.log('[Vakya] Browser Translator initialized via ai.translator');
        return true;
      }

      if (!TranslatorAPI) {
        console.log('[Vakya] No Translator API found in this context');
        console.log('[Vakya] Note: Content scripts may not have access to Translator API');
        return false;
      }

      console.log('[Vakya] Translator API found, checking availability...');

      // Check if language pair is supported
      const availability = await TranslatorAPI.availability({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang
      });

      console.log(`[Vakya] Translator availability for ${sourceLang}->${targetLang}: ${availability}`);

      if (availability === 'unavailable' || availability === 'no') {
        console.log('[Vakya] Language pair not supported');
        return false;
      }

      console.log('[Vakya] Creating translator instance...');

      // Create translator (will download model if needed)
      browserTranslator = await TranslatorAPI.create({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            console.log(`[Vakya] Downloading language model: ${Math.round(e.loaded * 100)}%`);
          });
        }
      });

      console.log('[Vakya] Browser Translator initialized successfully');
      return true;
    } catch (err) {
      console.error('[Vakya] Failed to init Browser Translator:', err);
      console.error('[Vakya] Error details:', {
        name: err.name,
        message: err.message,
        stack: err.stack
      });
      return false;
    }
  }

  async function translateWithBrowser(text) {
    if (!browserTranslator) return null;
    try {
      return await browserTranslator.translate(text);
    } catch (err) {
      console.error('[Vakya] Browser translation failed:', err);
      return null;
    }
  }

  // Utilities
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  async function getSettings() {
    try {
      const stored = await chrome.storage.sync.get(SETTINGS_KEY);
      return {
        nativeLanguage: 'English',
        targetLanguage: 'German',
        cefrLevel: 'B1',
        simplify: true,
        autoTranslate: false,
        ...(stored?.[SETTINGS_KEY] || {})
      };
    } catch {
      return {
        nativeLanguage: 'English',
        targetLanguage: 'German',
        cefrLevel: 'B1',
        simplify: true,
        autoTranslate: false
      };
    }
  }

  // Inject styles
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Overlay */
      .vakya-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: vakya-fade-in 0.2s ease;
      }
      @keyframes vakya-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .vakya-overlay-content {
        text-align: center;
        max-width: 400px;
        padding: 32px;
      }
      .vakya-spinner {
        width: 48px;
        height: 48px;
        border: 3px solid rgba(99, 102, 241, 0.2);
        border-top-color: #6366f1;
        border-radius: 50%;
        margin: 0 auto 20px;
        animation: vakya-spin 0.8s linear infinite;
      }
      .vakya-loading {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(165, 180, 252, 0.3);
        border-top-color: #a5b4fc;
        border-radius: 50%;
        animation: vakya-spin 0.6s linear infinite;
      }
      @keyframes vakya-spin {
        to { transform: rotate(360deg); }
      }
      .vakya-icon-error {
        width: 48px;
        height: 48px;
        margin: 0 auto 20px;
        color: #f87171;
      }
      .vakya-overlay-title {
        font-size: 20px;
        font-weight: 600;
        color: #f1f5f9;
        margin-bottom: 8px;
      }
      .vakya-overlay-subtitle {
        font-size: 14px;
        color: #94a3b8;
        line-height: 1.5;
      }
      .vakya-overlay-btn {
        margin-top: 20px;
        padding: 12px 24px;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        border: none;
        border-radius: 10px;
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .vakya-overlay-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
      }
      .vakya-overlay-dismiss {
        display: block;
        margin: 16px auto 0;
        padding: 8px 16px;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: #94a3b8;
        font-size: 13px;
        cursor: pointer;
      }
      .vakya-overlay-dismiss:hover {
        background: rgba(255, 255, 255, 0.05);
        color: #e2e8f0;
      }

      /* Floating bar */
      .vakya-floating-bar {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483646;
        background: #1e293b;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: vakya-slide-in 0.3s ease;
      }
      @keyframes vakya-slide-in {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .vakya-bar-success {
        border-color: rgba(34, 197, 94, 0.3);
      }
      .vakya-bar-warning {
        border-color: rgba(251, 191, 36, 0.3);
      }
      .vakya-bar-warning .vakya-bar-message {
        color: #fbbf24;
      }
      .vakya-bar-content {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
      }
      .vakya-bar-message {
        font-size: 14px;
        color: #e2e8f0;
      }
      .vakya-bar-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: #e2e8f0;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .vakya-bar-btn:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .vakya-bar-close {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        background: transparent;
        border: none;
        color: #64748b;
        cursor: pointer;
        border-radius: 6px;
      }
      .vakya-bar-close:hover {
        background: rgba(255, 255, 255, 0.05);
        color: #94a3b8;
      }

      /* Words */
      .vakya-word {
        cursor: pointer;
        border-radius: 2px;
        transition: background 0.1s;
      }
      .vakya-word:hover {
        background: rgba(99, 102, 241, 0.2);
      }

      /* Sentence mode (Cmd/Ctrl held) */
      .vakya-sentence-mode .vakya-word {
        pointer-events: none;
      }
      .vakya-sentence-mode .vakya-translated {
        cursor: pointer;
        transition: background 0.15s, outline 0.15s;
        border-radius: 4px;
      }
      .vakya-sentence-hover {
        background: rgba(99, 102, 241, 0.15) !important;
        outline: 2px solid rgba(99, 102, 241, 0.4);
        outline-offset: 2px;
      }

      /* Tooltip */
      .vakya-tooltip {
        position: fixed;
        z-index: 2147483647;
        max-width: 320px;
        min-width: 180px;
        padding: 14px 16px;
        background: linear-gradient(145deg, #1e293b, #1e1b4b);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.15s, transform 0.15s;
        pointer-events: auto;
      }
      .vakya-tooltip-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .vakya-tooltip-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      .vakya-tooltip-word {
        font-size: 16px;
        font-weight: 700;
        color: #f1f5f9;
      }
      .vakya-tooltip-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #6366f1;
        margin-bottom: 8px;
      }
      .vakya-tooltip-chips {
        display: flex;
        gap: 6px;
      }
      .vakya-chip {
        padding: 3px 8px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        color: #94a3b8;
      }
      .vakya-chip-article {
        background: rgba(99, 102, 241, 0.2);
        color: #a5b4fc;
      }
      .vakya-tooltip-translation {
        font-size: 14px;
        color: #e2e8f0;
        line-height: 1.4;
      }
      .vakya-tooltip-original {
        font-size: 14px;
        color: #e2e8f0;
        line-height: 1.5;
        font-style: italic;
      }
      .vakya-tooltip-example {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 13px;
        color: #94a3b8;
        font-style: italic;
        line-height: 1.4;
      }
      .vakya-tooltip-hint {
        margin-top: 10px;
        font-size: 11px;
        color: #64748b;
        line-height: 1.4;
      }
      .vakya-tooltip-loading {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #94a3b8;
        font-size: 13px;
      }
      .vakya-tooltip-error {
        color: #f87171;
        font-size: 13px;
      }
      .vakya-tooltip-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        margin-top: 10px;
        padding: 8px 12px;
        background: rgba(99, 102, 241, 0.15);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 8px;
        color: #a5b4fc;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }
      .vakya-tooltip-btn:hover {
        background: rgba(99, 102, 241, 0.25);
      }
      .vakya-tooltip-btn:disabled {
        opacity: 0.6;
        cursor: wait;
      }
    `;

    document.head.appendChild(style);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
