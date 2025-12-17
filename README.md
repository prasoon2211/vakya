# Vakya

A Chrome extension for language learners that translates articles and provides word-level translations with grammar analysis.

## Features

- **Page Translation**: Translates articles to your target language at your CEFR level
- **Word Click**: Click any word to see instant translation (uses Chrome's built-in Translator API)
- **Deep Analysis**: Click "Analyze Word" for grammar details, examples, and usage explanations (powered by OpenAI)
- **Sentence View**: Hold Cmd/Ctrl and click a paragraph to see the original text
- **Restore**: One-click restore to original text

## Installation

### Step 1: Download the Extension

```bash
git clone https://github.com/prasoon2211/vakya.git
```

Or download as ZIP and extract.

### Step 2: Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right corner)
3. Click **Load unpacked**
4. Select the `vakya` folder you downloaded

### Step 3: Enable Chrome Translator API (Optional but Recommended)

For instant word translations without API calls:

1. Go to `chrome://flags/#translation-api`
2. Set "Experimental translation API" to **Enabled**
3. Restart Chrome
4. Go to `chrome://on-device-translation-internals/`
5. Install language packs for your language pair (e.g., German → English)

### Step 4: Add OpenAI API Key

1. Click the Vakya extension icon in your toolbar
2. Click **Settings**
3. Enter your [OpenAI API key](https://platform.openai.com/api-keys)
4. Configure your native language, target language, and CEFR level
5. Click **Save**

## Usage

| Action | Result |
|--------|--------|
| Click extension → "Translate Page" | Translates the article to your target language |
| Click on any word | Shows translation (instant if Translator API enabled) |
| Click "Analyze Word" | Fetches grammar, examples, usage from OpenAI |
| Cmd/Ctrl + hover paragraph | Highlights the whole paragraph |
| Cmd/Ctrl + click paragraph | Shows original text |
| Click "Restore" in floating bar | Restores original page content |

## Requirements

- **Chrome 141+** (for built-in Translator API)
- **OpenAI API key** (for deep word analysis feature)

## Tech Stack

- Chrome Extension Manifest V3
- Chrome Translator API (on-device translation)
- OpenAI GPT-4o-mini (word analysis)

## License

MIT
