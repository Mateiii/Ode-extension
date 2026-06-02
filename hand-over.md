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

`WXT_TAVILY_API_KEY` is required for live fact checks. OpenAI powers both fact-check analysis and AI page-note summaries; if unavailable or rate-limited, both fall back to heuristics/extractive summaries.

`.env` is gitignored as of this session.

## Key Files

- `entrypoints/content.ts`: Injects the highlight toolbar and extracts page text for page-note capture.
- `entrypoints/background.ts`: Routes selection actions, opens side panel, saves notes, runs fact checks, captures active page notes.
- `entrypoints/sidepanel/App.tsx`: Main React side panel UI for chat, notes, folders, exports, citations, context panel.
- `entrypoints/sidepanel/style.css`: Side panel styles.
- `lib/factCheck.ts`: Tavily search + optional OpenAI analysis + fallback fact-check behavior.
- `lib/pageNotes.ts`: AI page-note summarization (OpenAI) + boilerplate cleaning + extractive fallback.
- `lib/researchStorage.ts`: Notes/folders/citation storage helpers (incl. delete/move).
- `lib/sidepanelQueue.ts`: Pending-action handoff for cold-opening the side panel.
- `lib/pageMetadata.ts`: Page metadata scraping.
- `types/chrome.d.ts`: Local Chrome API typings used by TypeScript (incl. `scripting`, `runtime.lastError`).

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

- `Take page notes`: captures the active tab's text via `chrome.scripting.executeScript` (from `background.ts` `requestPageText`), then summarizes it.
- AI summarization in `lib/pageNotes.ts`: `cleanForNotes` strips article boilerplate (author lists, PMCID/PMID/DOI, jumps to Abstract/Introduction) → OpenAI bullet summary → falls back to extractive bullets if OpenAI is missing/fails.
- folders (create only; no rename yet)
- selection notes from highlighted text
- page notes from whole page capture
- per-note actions: **delete**, **move to folder**, export single note as **Markdown** or **JSON**
- collapsible notes (collapse state is in-memory only)
- toast notification on save / delete / move

Capture flow note: extraction uses `executeScript` (not `tabs.sendMessage`), which is why it works even when the content script isn't mounted. Chrome's native PDF viewer still cannot be read this way.

Layout: notes tab is split into a fixed `.notes-header` (toolbar + folder create + folder list) and a scrollable `.notes-list`, so notes never cover the folder names.

Storage keys:

- `quickNotes`
- `noteFolders`
- `ode:pending-sidepanel-action`

Default folder id is `default`. Storage helpers: `saveQuickNote`, `savePageNote`, `createNoteFolder`, `deleteQuickNote`, `moveQuickNote`.

### Context Panel

Populates on side-panel mount via `executeScript` scraping the active tab's metadata (title, author, canonical URL, published date, site name), and updates when text is highlighted. Used by the Citations tab.

### Citations

Citation tab formats APA/MLA from current context metadata.

## Known Caveats

- Chrome native PDF viewer may not expose full PDF text even to `executeScript`. If page-note capture fails or returns little text for PDFs, add a PDF-specific extraction path.
- Fact-check fallback is heuristic. OpenAI gives better nuanced summaries when available.
- `Ask AI` is still placeholder transport text, not a real chat integration.
- AI page notes need `WXT_OPENAI_API_KEY`; without it, notes fall back to extractive bullets.
- Existing notes saved before AI summarization won't reformat retroactively — re-take to regenerate.
- There is no folder delete/rename yet (create only). No note edit (delete/move/export exist).
- Transient UI state not persisted: toast, note collapse state, selected folder tab.
- Export uses browser Blob download from the side panel (per-note now, not per-folder).

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

`.env` is gitignored and contains API keys — keep it untracked.

Current branch `feat/notes-overhaul` is open as PR #1 (https://github.com/Mateiii/Ode-extension/pull/1) against `main`. `gh` must be logged in as `Mateiii` (the repo owner) to push/create PRs; a second account (`lopotarumatei23`) lacks collaborator access.
