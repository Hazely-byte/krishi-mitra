# Krishi Mitra (SIH) — Architecture, Design System & Changes Documentation

## 1. Repository Structure & Boundaries

### Teammates' Git Repository (`SIH/`)
Branch: `feature/backend-integration`
Allowed to modify:
- `SIH/market.html`
- `SIH/js/market.js`
- `SIH/ai-help.html`
- `SIH/js/ai-help.js`
- `SIH/js/i18n.js` (Append-only: new keys only; existing 101 keys never edited or removed)
New files in `SIH/`:
- `SIH/js/location.js` (Geolocation resolver and fallback manager)
- `SIH/js/market-api.js` (Client-side mandi API fetcher)
- `SIH/js/chat.js` (Chat client streaming & tool handler)
- `SIH/js/voice.js` (Extracted Gemini Live audio & WebSocket client)
- `SIH/js/audio-processor.js` (AudioWorklet processor, copied unchanged from `public/`)
- `SIH/css/market-extra.css` (Mandi info banner, loading skeletons, error/empty states)
- `SIH/css/ai-assistant.css` (Mode switch, history sheet, voice indicators, markdown styles)

### Server & Root Repository (`./`)
Allowed to modify:
- `server.js` (Express + WebSocket proxy, serving `SIH` at `/`, `public` at `/lab`, `/live`, and `/api/*`)
- `package.json` (Dependencies and scripts)
- `.env` (Secret management)
- `.gitignore` (Ignore `.env`, `node_modules`, `data/`, `*.jsonl`, report files, `SIH_backup/`)
New files in root:
- `server/db.js` (SQLite connection, schema, parameterized SQL statements)
- `server/mandi.js` (data.gov.in fetcher, normalizer, upsert, cooldown)
- `server/location.js` (Nominatim reverse geocoder with caching & 1 req/s rate limit)
- `server/tools.js` (5 Gemini function declarations & database query execution)
- `server/chat.js` (NDJSON streaming chat endpoint with server-side tool loop)
- `server/sessions.js` (Session & message persistence endpoints)
- `server/sync-cli.js` (CLI entry point for manual sync)
- `data/krishi.db` (SQLite database; gitignored)
- `data/commodity_names.json` (Discovered commodity name mappings)
- `CHANGES.md` (This document)

---

## 2. Design System Audit

### Font-Family
- Strict font stack from `SIH/css/style.css`:
  ```css
  font-family: 'Inter', 'Noto Sans Devanagari', system-ui, -apple-system, sans-serif;
  ```
- Google Fonts loaded via `<link>` in HTML `<head>`:
  - `Inter`: weights 400, 500, 600, 700, 800
  - `Noto Sans Devanagari`: weights 400, 500, 600, 700, 800
- **Rule**: NO new fonts, external font imports, or CSS `@import` rules are added.

### CSS Custom Properties (Variables)
Defined in `:root` of `SIH/css/style.css`:
- **Green (Primary Brand)**:
  - `--green-900`: `#14532d`, `--green-800`: `#166534`, `--green-700`: `#15803d`
  - `--green-600`: `#16a34a`, `--green-500`: `#22c55e`, `--green-400`: `#4ade80`
  - `--green-300`: `#86efac`, `--green-200`: `#bbf7d0`, `--green-100`: `#dcfce7`, `--green-50`: `#f0fdf4`
- **Earth (Secondary / Agricultural Warmth)**:
  - `--earth-900`: `#422006`, `--earth-700`: `#92400e`, `--earth-500`: `#d97706`
  - `--earth-300`: `#fcd34d`, `--earth-100`: `#fef3c7`, `--earth-50`: `#fffbeb`
- **Semantic Accents**:
  - `--orange-500`: `#f97316`, `--orange-100`: `#ffedd5`
  - `--red-500`: `#ef4444`, `--red-100`: `#fee2e2`
  - `--blue-500`: `#3b82f6`, `--blue-100`: `#dbeafe`
- **Grayscale Palette**:
  - `--gray-50`: `#f9fafb`, `--gray-100`: `#f3f4f6`, `--gray-200`: `#e5e7eb`
  - `--gray-300`: `#d1d5db`, `--gray-400`: `#9ca3af`, `--gray-500`: `#6b7280`
  - `--gray-600`: `#4b5563`, `--gray-700`: `#374151`, `--gray-800`: `#1f2937`, `--gray-900`: `#111827`
  - `--white`: `#ffffff`
- **Shadows**:
  - `--shadow-sm`: `0 1px 2px rgba(0,0,0,0.05)`
  - `--shadow-md`: `0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)`
  - `--shadow-lg`: `0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04)`
  - `--shadow-xl`: `0 20px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.04)`
- **Border Radii**:
  - `--radius-sm`: `8px`, `--radius-md`: `12px`, `--radius-lg`: `16px`, `--radius-xl`: `20px`, `--radius-full`: `9999px`
- **Dimensions**:
  - `--nav-height`: `72px` (mobile), `--header-height`: `56px`

### Icon References
- **Method**: 100% native Unicode emoji and UTF-8 symbols directly inside text nodes or JavaScript strings.
- **Zero** `<img>` tags for icons.
- **Zero** `<svg>` icons (except one data-URI background arrow for `<select>`).
- **Zero** icon fonts (no FontAwesome, Material Icons, etc.).
- **Canonical App Icons**:
  - Navigation / Sections: `🏠` Home, `🌾` Crops, `📈` Market, `🤖` AI Assistant, `👤` Profile
  - Actions / Controls: `🔍` Search, `🎤` Voice / Mic, `➤` Send, `←` Back, `📍` Location / Best Market, `🔄` Update / Refresh, `💾` Save, `⏰` Time / History
  - Crop Emojis: `🌾` Wheat/Rice/Paddy, `🫘` Soybean/Pulses, `🧶` Cotton, `🧅` Onion, `🥔` Potato, `🍅` Tomato, `🌽` Maize, `🎋` Sugarcane, `📦` Other
  - Trends: `⬆` Price up, `⬇` Price down, `➡` Price stable

---

## 3. i18n Translation System Architecture

- **Dictionary file**: `SIH/js/i18n.js` exports `const i18n = { hi: { ... }, en: { ... } };`.
- **Runtime engine**: `SIH/js/main.js` provides:
  - `setLanguage(lang)`: sets `currentLang`, saves to `localStorage('language')`, updates `.lang-btn` styling and `.lang-toggle-small` button text (`EN` vs `हि`), invokes `applyTranslations()`, and triggers page callback `onLanguageChange()`.
  - `toggleLang()`: switches between `hi` and `en`.
  - `applyTranslations()`: replaces `textContent` on all `[data-i18n]` elements and `placeholder` on all `[data-i18n-placeholder]` elements with active dictionary values.
  - `onLanguageChange()`: hook implemented on individual pages (`market.js`, `buyers.js`, `crops.js`) to re-render dynamic template elements.
- **Existing Keys**: Exactly 101 keys per language (101 in `hi`, 101 in `en`).
- **Scope Rule**: Existing 101 keys are strictly preserved and never modified or deleted. All new UI strings are appended at the end of both `hi` and `en` dictionaries.

---

## 4. Existing Page Rendering Mechanics

### `SIH/market.html` & `SIH/js/market.js`
- **DOM Container**: `<div class="market-list" id="market-list"></div>`
- **Search Input**: `<input type="text" class="search-input" id="market-search-input" oninput="filterMarket()">`
- **Language Toggle**: `<button class="lang-toggle-small" onclick="toggleLang()">EN</button>`
- **Functions**:
  - `renderMarket(filter = '')`: filters `marketData` array and populates `#market-list.innerHTML` with `.market-crop-card` HTML.
  - `filterMarket()`: reads `#market-search-input.value` and calls `renderMarket(q)`.
  - `onLanguageChange()`: reads `#market-search-input.value` and re-renders via `renderMarket(q)`.

### `SIH/ai-help.html` & `SIH/js/ai-help.js`
- **DOM Elements**:
  - `#ai-suggestions`: Horizontal scroll row with `.suggestion-chip` buttons (`askAI(this.textContent)`).
  - `#chat-messages`: Scrollable message container with `.chat-bubble.bot` and `.chat-bubble.user`.
  - `#chat-input`: Text input field.
  - `#mic-btn`: Voice recording toggle button.
- **Functions**:
  - `askAI(question)`: appends user bubble, displays loading dots, sets 1200ms timer, appends mock response from `aiResponses` object.
  - `sendChat()`: reads `#chat-input`, clears input, calls `askAI(q)`.
  - `toggleMic()`: simulates recording state with 3000ms timeout and sends simulated question.

---

## 5. Data.gov.in Mandi API Probing Results

The API probe against resource `9ef84268-d588-465a-a308-a864a43d0070` revealed critical facts:
1. **Filter Exposed Fields**: The resource exposed filter fields are ONLY: `state`, `district`, `market`, `commodity`, `variety`, `grade`.
2. **`arrival_date` Filter Support**: `arrival_date` is NOT in `field_exposed`. Any filter parameter `filters[arrival_date]=...` is ignored by the upstream server and does NOT filter historical records.
3. **Daily Snapshot Dataset**: The resource contains ONLY today's daily arrivals (`20/09/2026`). All 9,018 rows across India have `arrival_date: "20/09/2026"`.
4. **State Records (Chattisgarh)**: Exactly **3 total records** exist in the entire dataset for `state=Chattisgarh`:
   - `Surajpur` district, `Surajpur APMC`: `Paddy(Common)`, variety `Mahamaya`, modal price `₹2,390/quintal`.
   - `Raipur` district, `Neora APMC`: `Paddy(Common)`, variety `Mahamaya`, modal price `₹1,970/quintal`.
   - `Raipur` district, `Kharora APMC`: `Paddy(Common)`, variety `Mahamaya`, modal price `₹1,815/quintal`.
5. **Gate B Evaluation**:
   - Distinct commodities for Raipur district: **1** (`Paddy(Common)`).
   - Distinct markets in Raipur: **2** (`Neora APMC`, `Kharora APMC`).
   - Dates available: **1** (`20/09/2026`).
   - This triggers the user-specified **GATE condition**: Fewer than 8 distinct commodities exist in the upstream API.
   - Per Gate B rules: "if fewer than 8 distinct commodities exist for Raipur district after backfilling, STOP after the sync phase and report: the commodity list, dates available, and rows per market. Otherwise continue."
