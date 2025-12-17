# Vakya

A Chrome extension for language learners that translates articles and provides word-level translations with grammar analysis.

## Features

- **Page Translation**: Translates articles to your target language at your CEFR level
- **Word Click**: Click any word to see instant translation (uses Chrome's built-in Translator API)
- **Deep Analysis**: Click "Analyze Word" for grammar details, examples, and usage explanations (powered by OpenAI)
- **Sentence View**: Hold Cmd/Ctrl and click a paragraph to see the original text
- **Restore**: One-click restore to original text

## Installation

1. Clone this repository
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select this folder
5. Click the extension icon and add your OpenAI API key in settings

## Requirements

- Chrome 141+ (for built-in Translator API)
- OpenAI API key (for deep word analysis)
- Enable `chrome://flags/#translation-api` for instant word translations

## Usage

1. Navigate to any article
2. Click the Vakya extension icon
3. Click "Translate Page"
4. Click any word to see its translation
5. Click "Analyze Word" for detailed grammar info
6. Hold Cmd/Ctrl + click a paragraph to see the original text

## Tech Stack

- Chrome Extension Manifest V3
- Chrome Translator API (on-device translation)
- OpenAI GPT-4o-mini (word analysis)

## License

MIT
