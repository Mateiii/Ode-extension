# Ode Extension Hand-over

## App Overview

Ode is a Chromium MV3 research assistant extension built with WXT + React. It has:

- content script selection toolbar: Ask AI, Fact Check, Save to Notes
- Chrome side panel UI
- background service worker for privileged actions, storage, Tavily/OpenAI calls, and active-tab page capture
- local `chrome.storage.local` persistence for notes, folders, and pending sidepanel actions

## Setup

Install/build commands:

```bash
npm install
npm run dev
npm run build
npm run compile
```

Fact-check env vars go in `.env` at repo root:

```bash
WXT_TAVILY_API_KEY=...
WXT_OPENAI_API_KEY=...
WXT_OPENAI_MODEL=gpt-4.1-mini
```

`WXT_TAVILY_API_KEY` is required for live fact checks. OpenAI is optional; if unavailable or rate-limited, the app falls back to Tavily evidence heuristics.

## Key Files

- `entrypoints/content.ts`: Injects the highlight toolbar and extracts page text for page-note capture.
- `entrypoints/background.ts`: Routes selection actions, opens side panel, saves notes, runs fact checks, captures active page notes.
- `entrypoints/sidepanel/App.tsx`: Main React side panel UI for chat, notes, folders, exports, citations, context panel.
- `entrypoints/sidepanel/style.css`: Side panel styles.
- `lib/factCheck.ts`: Tavily search + optional OpenAI analysis + fallback fact-check behavior.
- `lib/researchStorage.ts`: Notes/folders/citation storage helpers.
- `lib/sidepanelQueue.ts`: Pending-action handoff for cold-opening the side panel.
- `lib/pageMetadata.ts`: Page metadata scraping.
- `types/chrome.d.ts`: Local Chrome API typings used by TypeScript.

## Current Features

### Selection Toolbar

When text is highlighted on a web page, the content script shows:

- Ask AI
- Fact Check
- Save to Notes

Clicking an action sends `selection-action` to the background.

### Side Panel Cold Open

The background calls `chrome.sidePanel.open({ tabId })` when toolbar actions are clicked. It also writes the action into `chrome.storage.local` via `lib/sidepanelQueue.ts` so the side panel can recover the first action even if it was not mounted when the runtime message was sent.

Important: keep `chrome.sidePanel.open` as early as possible in the click-triggered flow; Chrome may require it to stay tied to the user gesture.

### Fact Check

Flow:

1. Content script sends highlighted claim.
2. Background opens side panel and sends a user message.
3. Side panel shows loading dots.
4. Background calls `factCheckClaim`.
5. Tavily search runs.
6. OpenAI analyzes sources if configured.
7. If OpenAI fails, fallback classifier returns a structured result.
8. Side panel replaces loading message with verdict paragraph and sources.

Result shape:

```ts
{
  status: 'True' | 'False' | 'Disputed';
  summary: string;
  sources: Array<{ title: string; url: string }>;
}
```

There is a regression test for false Great Wall claims and the platypus partial-truth case:

```bash
npm run verify:fact-check
```

### Notes Workspace

Notes tab supports:

- `Take page notes`: captures readable text from current active tab
- folders
- selection notes from highlighted text
- page notes from whole page capture
- export current folder as Markdown
- export current folder as JSON

Storage keys:

- `quickNotes`
- `noteFolders`
- `ode:pending-sidepanel-action`

Default folder id is `default`.

### Citations

Citation tab formats APA/MLA from current context metadata.

## Known Caveats

- Chrome native PDF viewer may not expose full PDF text to the content script. If page-note capture fails or returns little text for PDFs, add a PDF-specific extraction path.
- Fact-check fallback is heuristic. OpenAI gives better nuanced summaries when available.
- `Ask AI` is still placeholder transport text, not a real chat integration.
- Notes page capture currently creates an extractive summary from page text, not an LLM-generated lecture summary.
- There is no folder delete/rename yet.
- There is no note edit/delete UI yet.
- Export uses browser Blob download from the side panel.

## Verification Commands

Run before handing off:

```bash
npm run compile
npm run verify:persistence
npm run verify:fact-check
npm run build
```

`verify:fact-check` intentionally logs an OpenAI 429 fallback warning from a mocked test; that is expected.

## Git/Workspace Notes

`.env` may exist locally and should remain untracked. It contains API keys.
