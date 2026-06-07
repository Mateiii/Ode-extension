# Ode Extension Hand-over

## App Overview

Ode is a Chromium MV3 research assistant extension built with WXT + React. It has:

- content script selection toolbar: Ask AI, Fact Check, Save to Notes, Cite
- Chrome side panel UI with Chat / Notes / Source tabs
- **page-context AI chat**: streaming answers grounded in the active tab's text (or an uploaded document), with conversation memory and click-to-jump source citations
- **document ingest**: drag-and-drop or click-to-upload PDF / DOCX / PPTX in the Chat tab; auto-fetches web-hosted PDFs when the active tab URL ends in `.pdf`
- **context menu actions**: right-click on any selection (including inside Chrome's native PDF viewer) → Save to Øde Notes / Fact Check with Øde / Cite with Øde
- background service worker for privileged actions, storage, Tavily/OpenAI calls, and active-tab page capture
- local `chrome.storage.local` persistence for projects, folders, notes, and pending sidepanel actions

## Setup

```bash
npm install
npm run dev       # hot-reload dev build
npm run build     # production build
npm run compile   # tsc type-check only (no emit)
```

Env vars go in `.env` at repo root (used by fact-check, page notes, and AI chat):

```bash
WXT_TAVILY_API_KEY=...
WXT_OPENAI_API_KEY=...
WXT_OPENAI_MODEL=gpt-4o-mini   # optional; all OpenAI calls default to gpt-4o-mini
```

`.env` is gitignored. `WXT_OPENAI_API_KEY` is read via `import.meta.env` and baked into the build bundle.

## Key Files

| File | Purpose |
|---|---|
| `entrypoints/content.ts` | Injects the highlight toolbar; extracts page text for page-note capture |
| `entrypoints/background.ts` | Routes selection actions, opens side panel, runs fact checks, captures page notes, formats citation text, serves `request-page-text` for chat |
| `entrypoints/sidepanel/App.tsx` | Main React side panel — all UI: chat, notes, folders, Source tab, projects |
| `entrypoints/sidepanel/style.css` | Side panel styles |
| `lib/researchStorage.ts` | All storage helpers; canonical `QuickNote` / `NoteFolder` / `Project` types; `getNoteTitle`, `resolveNoteTitle`, `formatCitation` |
| `lib/pageChat.ts` | AI chat: streaming OpenAI Chat Completions (SSE), system-prompt assembly, `ChatTurn` history type |
| `lib/bibtex.ts` | BibTeX formatting — `formatBibtex(note)`, `formatBibtexBundle(notes[])` |
| `lib/factCheck.ts` | Tavily search + OpenAI analysis + fallback fact-check |
| `lib/pageNotes.ts` | AI page-note summarisation (OpenAI) + boilerplate cleaning + extractive fallback |
| `lib/pageMetadata.ts` | Page metadata scraping — title, author, canonical URL, date, site name |
| `lib/fileParsers.ts` | Document text extraction: `extractPdfText` (unpdf), `extractDocxText` (mammoth), `extractPptxText` (jszip), `extractFileText` dispatcher, `extractTextFromPdfUrl` fetch helper |
| `lib/sidepanelQueue.ts` | Pending-action handoff for cold-opening the side panel |
| `types/chrome.d.ts` | Local Chrome API typings (incl. `executeScript` `args`, `sendMessage` response callback, `tabs.onActivated/onUpdated`, `contextMenus`) |

---

## Data Model

### `QuickNote`

```ts
type QuickNote = {
  id: string;
  text: string;
  createdAt: string;
  folderId?: string;
  kind?: 'selection' | 'page' | 'manual' | 'citation' | 'ai-chat';
  edited?: boolean;
  pinned?: boolean;         // floats note to top of folder view
  customTitle?: string;     // user-set or auto-generated; takes priority over metadata.title
  metadata?: PageMetadata;
  title?: string;           // browser tab title at save time
  url?: string;
};
```

`getNoteTitle(note)` in `lib/researchStorage.ts` is the canonical resolver — import it, never redefine:
```ts
note.customTitle || note.metadata?.title || note.title || 'Untitled page'
```

### `NoteFolder`

```ts
type NoteFolder = {
  id: string;
  name: string;
  createdAt: string;
  projectId: string;   // required; migrated from legacy records on load
};
```

### `Project`

```ts
type Project = {
  id: string;
  name: string;
  createdAt: string;
  defaultFolderId: string;   // the "General" folder
  sourcesFolderId?: string;  // the "Sources" folder (always set after migration)
};
```

### Storage keys

| Constant | Key string | Type |
|---|---|---|
| `QUICK_NOTES_STORAGE_KEY` | `'quickNotes'` | `QuickNote[]` |
| `NOTE_FOLDERS_STORAGE_KEY` | `'noteFolders'` | `NoteFolder[]` |
| `PROJECTS_STORAGE_KEY` | `'projects'` | `Project[]` |
| `ACTIVE_PROJECT_STORAGE_KEY` | `'activeProjectId'` | `string` |
| `DEFAULT_FOLDER_ID` | `'default'` | hardcoded ID for the default project's General folder |
| `SOURCES_FOLDER_ID` | `'sources'` | hardcoded ID for the default project's Sources folder |
| `DEFAULT_PROJECT_ID` | `'default-project'` | hardcoded ID for the default project |

---

## Project Architecture

Projects are the top-level entity. Each project owns folders; each folder owns notes. All UI and AI context use only the active project's data.

### Startup / migration (`loadInitialData` in App.tsx)

```ts
const [storedNotes, { projects, folders }] = await Promise.all([
  getQuickNotes(),
  ensureProjectSourcesFolders(),   // also runs Sources-folder migration
]);
```

`ensureProjectSourcesFolders()` creates a Sources folder for any project missing one and patches `sourcesFolderId` on the project record. It returns updated `{projects, folders}` so no second fetch is needed.

### Storage functions

| Function | Description |
|---|---|
| `getProjects()` | Returns projects; creates the default "General Research" project on first call |
| `getNoteFolders()` | Returns folders; migrates legacy records missing `projectId`; creates General + Sources folders on fresh install |
| `ensureProjectSourcesFolders()` | Migration: creates missing Sources folders per project; returns `{projects, folders}` |
| `createProject(name)` | Atomically creates project + General folder + Sources folder |
| `deleteProject(id)` | Cascades: removes project, all its folders, all their notes. Default project is protected |
| `createNoteFolder(name, projectId)` | `projectId` is required (defaults to `DEFAULT_PROJECT_ID`) |

### Derived state in App.tsx

```ts
const activeProject         = projects.find(p => p.id === activeProjectId);
const projectFolders        = folders.filter(f => f.projectId === activeProjectId);
const activeProjectFolderIds = new Set(projectFolders.map(f => f.id));
const projectNotes          = notes.filter(n => activeProjectFolderIds.has(n.folderId || DEFAULT_FOLDER_ID));
const projectSourcesFolder  = projectFolders.find(f => f.id === activeProject?.sourcesFolderId);
const selectedFolder        = projectFolders.find(f => f.id === selectedFolderId) ?? projectFolders[0];
const visibleNotes          = projectNotes.filter(n => (n.folderId || DEFAULT_FOLDER_ID) === selectedFolder?.id);
const sortedVisibleNotes    = [...visibleNotes.filter(n => n.pinned), ...visibleNotes.filter(n => !n.pinned)];
```

All UI uses the scoped variables above — **never** raw `folders` / `notes`.

### Project UI

- **Project bar**: narrow bar above the header — `<select>` dropdown, "+" new project button, trash delete button.
- **New project**: modal with name input.
- **Delete project**: multi-step confirmation modal showing exact folder/note counts, "Delete everything" CTA. Default project is protected.
- Switching projects resets `selectedFolderId` to the new project's `defaultFolderId`.

---

## Architecture: Toolbar Action Flow

**All note-saving actions save in App.tsx, NOT the background.** Only App.tsx knows the selected folder via `selectedFolderIdRef`.

| Action | Background role | App.tsx role |
|---|---|---|
| `save-note` | `openAndAnnounce()` — opens panel, sends message | Saves note to `selectedFolderIdRef.current` |
| `extract-citation` | Formats APA/MLA, sends `citationText` in message | Saves citation note to selected folder |
| `fact-check` | Runs `factCheckClaim`, sends result message | Renders result in chat |
| `ask-ai` | `openAndAnnounce()` — opens panel, sends message | Switches to Chat tab, pre-fills input with selection as block-quote, focuses textarea |

`clearPendingSidepanelAction()` is called after `handleSelectionAction` in the live `onMessage` listener to prevent stale loading states on panel refresh.

The same four actions are also available via the **context menu** (see Context Menu section below). Context menu messages are structurally identical to toolbar messages so `handleSelectionAction` processes both without distinguishing the source.

---

## AI Chat (page-context)

The Chat tab is a streaming, page-grounded assistant. Core logic: `sendChatMessage()` in `App.tsx` + `streamPageChat()` in `lib/pageChat.ts`.

### Flow per message

1. **Nav-intent shortcut** — if the message matches `NAV_INTENT_RE` ("take me there", "show me", etc.), no API call is made; it scrolls to the last cited quote (see Quote jumping) and returns.
2. **Page / file harvest** — if `fileText !== null` (a document was uploaded or auto-loaded from a PDF tab), that string is used directly as `pageText`. Otherwise App.tsx sends `{ type: 'request-page-text' }` to the background, which runs `getActiveTab()` + `requestPageText()` (service-worker `chrome.scripting` — reliable; the in-sidepanel `executeScript` returned empty and was abandoned). Returns `{ text }`.
3. **History** — last 6 real turns (excludes the welcome seed, loading placeholders, and fact-check cards) mapped to OpenAI `{ role, content }` `ChatTurn[]`.
4. **Stream** — `streamPageChat(pageText, history, onChunk, signal)` POSTs to `https://api.openai.com/v1/chat/completions` with `stream: true`, parses the SSE byte stream, and calls `onChunk(delta)` per token. Tokens render into the placeholder assistant message live; loading dots show only while `loading && !content`.
5. **Post-process** — `injectScrollQuotes(text, pageText)` converts any plain-quoted page text the model didn't already wrap into scroll-quote links.

`chatAbortRef` aborts any in-flight stream before starting a new one. `AbortError` is swallowed.

### Prompt (`buildSystemPrompt`)

System message frames an "academic research co-pilot" with two rules: **semantic reasoning** (match synonyms/themes, don't refuse when thematically relevant material exists) and **citation hooks** (cite page text as `[label](#scroll-quote=verbatim phrase)`, never plain quotes). Page text is truncated to `PAGE_TEXT_LIMIT` (12 000 chars). A short citation reminder is folded into the latest user turn to keep `gpt-4o-mini` compliant.

### Ask AI (selection → chat pre-fill)

When the `ask-ai` toolbar or context-menu action fires, `handleSelectionAction` in App.tsx:
1. Switches `activeTab` to `'chat'`
2. Sets `input` to `> "${selection}"\n\n` (markdown block-quote, double newline so the user can type below it)
3. Returns early — no messages are pushed to the chat history
4. After a 100 ms timeout (lets React flush the tab switch), focuses the `<Textarea>` via `chatInputRef` and moves the cursor to the end

The user then types their question and sends normally. `sendChatMessage` uses `fileText` when a document is loaded, so the flow works identically for web pages and uploaded documents.

### Quick-action chips

Two static chips above the input (`QUICK_ACTIONS`): **Summarize Page** and **List Limitations**. Clicking submits the canned prompt via `sendChatMessage`. Disabled while a stream is in flight.

### Quote jumping (click-to-source)

- The model emits `[label](#scroll-quote=verbatim)` links. `parseScrollLinks()` renders the markdown into `<a class="scroll-quote-link">` (the raw quote lives in the click handler, not the DOM; a `↗` is appended via CSS).
- Clicking calls `handleScrollToQuote` → `executeScrollToQuote(quote)`, which `chrome.scripting.executeScript`s into the **active tab**: tries the native text fragment (`location.hash = ':~:text=' + encodeURIComponent(...)`), then falls back to `window.find` + `scrollIntoView({block:'center'})` + a 2 s amber outline highlight.
- `SCROLL_QUOTE_RE` is the shared matcher for both rendering and the nav-intent shortcut.

---

## Notes Features

### Note article layout

Each note renders as a **two-column CSS grid** (`article.note-item { grid-template-columns: 24px 1fr }`):

- **Left strip** (`.note-reorder`): ↑ / ↓ ghost buttons to reorder within the folder
- **Right** (`.note-content`): header + body content

The create-form (`div.note-item.note-create-form`) is a `<div>` not `<article>`, so it keeps the single-column layout.

### Action buttons (left → right in `.note-button-row`)

1. **Pin** — `Pin` icon; toggles `note.pinned`; blue tint when active (`.note-pin-btn--active`)
2. **Export Markdown** — downloads note as `.md`
3. **Copy** — copies `note.text` to clipboard, shows toast
4. **Edit** — (non-citation only) enters inline edit mode
5. **Delete** — removes note + toast
6. **Collapse toggle** — `ChevronDown`; all other buttons disabled while editing

### Pinning

- `handlePinNote(note)` toggles `pinned`, optimistic UI + `pinQuickNote(id, pinned)` in storage
- `sortedVisibleNotes` keeps pinned notes first, then unpinned — each group in their stored array order
- Pinned notes get a blue left border (`.note-item--pinned`)
- Toast: "Note pinned." / "Note unpinned."

### Reordering

- Up/down arrows in the `.note-reorder` strip
- `handleReorderNote(note, 'up'|'down')`: finds the note's group (`pinned` or `unpinned`), swaps with adjacent note in that group
- Optimistic UI swap in `notes` state + `swapQuickNotes(idA, idB)` in storage
- Arrows disabled at group edges (first/last in the group)

### Inline Editing

- Pencil button (non-citation only) → edit mode: title input + textarea, all other buttons disabled
- Save with button or Ctrl/Cmd+Enter; cancel with button or Escape
- Saves `customTitle` and `text`, marks `edited: true`
- `updateQuickNote(id, { text, customTitle? })` in researchStorage
- Edited badge: small pencil icon (`.note-edited-icon`) in the type label

### Save AI Response to Notes

Every completed, non-error assistant chat message shows a quiet **"Save to notes"** footer button (`.message-save-btn`, `BookmarkPlus` icon). Clicking it opens an inline folder picker (`.message-save-picker`) in place:

- A native `<select>` listing all project folders, defaulting to `selectedFolderIdRef.current`
- **Save** (dark filled button) and **Cancel** (ghost button)

State: `savingMessageId: string | null` tracks which message's picker is open; `saveAiFolderId: string` tracks the chosen folder.

`handleSaveAiResponse(content)`:
1. Calls `stripScrollQuotes(content)` — strips `[label](#scroll-quote=phrase)` to plain `label` (scroll-quote links are chat-only; they'd be dead in notes)
2. Builds a `[Jun 7, 14:23] first 35 chars…` title from the stripped text
3. Calls `resolveNoteTitle` for deduplication (same as all other save paths)
4. Calls `saveQuickNote({ text: stripped, kind: 'ai-chat', folderId, customTitle })`
5. Clears `savingMessageId`, shows "AI response saved to notes." toast

`stripScrollQuotes` is a module-level pure function in `App.tsx`:
```ts
function stripScrollQuotes(text: string): string {
  return text.replace(/\[([^\]]+)\]\(#scroll-quote=[^)]+\)/g, '$1');
}
```

**Note:** the welcome seed message (`id: 'welcome'`) is technically an assistant message and will also show the save button. Add a `message.id !== 'welcome'` guard if this is undesirable.

### Manual Note Creation

- "New note" button → form appears at top of list
- `kind: 'manual'`; pre-populated title via `buildDefaultNoteTitle()`: `[Jun 3, 14:23] Page Title…`

### Notes Toolbar Layout

2-column CSS grid (`.notes-toolbar`):
- Row 1: **New note** (spans both columns, full width)
- Row 2: **Take page notes** | **Export .bbt**

### Folder creation

New folders are created via a **`+` circle button** (`.folder-add-btn`) at the end of the folder chip row — not an always-visible input. Clicking it opens a name modal (`isCreatingFolder` state), Enter/“Create folder” submits via `handleCreateFolder` → `createNoteFolder(name, activeProjectId)`, Escape/overlay cancels.

### [[WikiLink]] References

- `[[NoteName]]` patterns in note text render as clickable blue pills in read mode
- Clicking navigates to the referenced note: switches folder, expands note, scrolls via `scrollIntoView`
- Case-insensitive match against `getNoteTitle(n)` for all project notes
- Broken links render with strikethrough in grey
- Raw syntax visible in textarea during edit mode

Navigation: `scrollToNoteId` state + `useEffect` with 50 ms timeout. Note articles have `id={`note-${note.id}`}`.

### Note Type Labels

| `kind` | Label |
|---|---|
| `'page'` | "Page notes" |
| `'citation'` | "Citation" (blue badge) |
| `'manual'` | "Note" |
| `'ai-chat'` | "AI response" |
| anything else | "Selection note" |

---

## Note Title Naming

### Selection notes (`kind: 'selection'`)

Generated at save time in `handleSelectionAction`:
```ts
const _ts    = `${MONTHS[month]} ${day}, ${HH}:${MM}`;
const _short = _raw.length > 35 ? _raw.slice(0, 34).trimEnd() + '…' : _raw;
const title  = `[${_ts}] ${_short}`;
// e.g. "[Jun 3, 14:23] The quick brown fox jumps ov…"
```
Stored as `customTitle`.

### Manual notes (`kind: 'manual'`)

`buildDefaultNoteTitle()` pre-populates the form: `[Jun 3, 14:23] Page Title…`. User can edit before saving.

### Citation notes (`kind: 'citation'`)

Raw title: `message.metadata?.title || message.title || 'Citation'` → run through `resolveNoteTitle` → stored as `customTitle`.

---

## Note Title Deduplication (`resolveNoteTitle`)

Located in `lib/researchStorage.ts`:

```ts
export async function resolveNoteTitle(
  desired: string,
  targetFolderId: string,
  excludeNoteId?: string,
): Promise<string>
```

Reads fresh notes/folders from storage (no stale React state). Rules:

| Situation | Result |
|---|---|
| No conflict | `desired` unchanged |
| Conflict in a **different** folder | `desired (FolderName)` |
| Conflict in the **same** folder | `desired (2)`, `desired (3)`, … |

Called from all save paths: `handleSelectionAction` (save-note, extract-citation), `saveNewNote`, `saveEditNote`.

---

## Source Tab

The third panel tab is labelled **Source** (internal `ActiveTab` value: `'source'`). The tab nav sits directly under the header (the page **context box** was moved out of the global header into this tab to declutter). It shows, wrapped in `.source-area`:

1. **Context box** — collapsible current-page context (title, author, canonical URL, captured selection), at the top
2. **Source header** — current page title + canonical URL (`.citation-source-info`)
3. **APA row** — formatted citation + Copy button + Save to Notes button
4. **MLA row** — same

The **Save to Notes** button (`BookmarkPlus` icon) calls `saveCitationAsNote(label, value)`:
- Targets `projectSourcesFolder?.id ?? selectedFolderIdRef.current ?? DEFAULT_FOLDER_ID`
- Saves a `kind: 'citation'` note with the citation text
- Toast: "APA citation saved to notes."

`formatCitation('apa'|'mla', metadata, fallback)` lives in `lib/researchStorage.ts`.

---

## Sources Folder

Every project has a **Sources** folder for bibliography-style citation notes.

| Scenario | How the folder gets created |
|---|---|
| Fresh install | `getNoteFolders()` creates General + Sources together |
| New project | `createProject()` creates General + Sources atomically |
| Existing project (migration) | `ensureProjectSourcesFolders()` at startup |

`SOURCES_FOLDER_ID = 'sources'` is the hardcoded ID for the default project's Sources folder (parallel to `DEFAULT_FOLDER_ID = 'default'`). Other projects get a random UUID stored in `project.sourcesFolderId`.

---

## BibTeX Export (`lib/bibtex.ts`)

Pure formatting module — no storage access.

```ts
formatBibtex(note: QuickNote, keyOverride?: string): string
formatBibtexBundle(notes: QuickNote[]): string
```

- Entry type: `@misc`
- Fields: `author`, `title`, `organization` (site name), `year`, `url`, `howpublished`, `note` (accessed date)
- Citation key: `{lastName}{year}_{firstTitleWord}` (e.g. `smith2023browser`)
- `formatBibtexBundle` deduplicates keys by appending `_b`, `_c`, … and prepends a generation timestamp header
- Special characters are escaped via `bbtEscape()` (`{}`, `&`, `%`, `#`, `_`, `\`)

**Export .bbt** button in the notes toolbar exports all `sortedVisibleNotes` for the current folder to `<folder-name>.bbt`. Toast if folder is empty.

---

## Document Ingest (`lib/fileParsers.ts`)

Extends the chat context source beyond the active web page.

### Extraction adapters

| Function | Library | Notes |
|---|---|---|
| `extractPdfText(buffer)` | `unpdf` (`pdfjs-dist`) | `getDocumentProxy` + `extractText({ mergePages: true })` |
| `extractDocxText(buffer)` | `mammoth` | `mammoth.extractRawText({ arrayBuffer })` |
| `extractPptxText(buffer)` | `jszip` | Unzips archive, reads `ppt/slides/slideN.xml` in order, extracts `<a:t>` DrawingML text runs |
| `extractFileText(file)` | — | Dispatcher: reads `File.arrayBuffer()`, branches on extension |
| `extractTextFromPdfUrl(url)` | — | `fetch(url)` → `arrayBuffer()` → `extractPdfText`; only `http/https` (browser `fetch` cannot reach `file://`) |

### Dropzone UI (Chat tab, `input-section`)

- Sits between the quick-action chips and the chat input bar
- Accepts drag-and-drop or click-to-browse; `accept=".pdf,.docx,.pptx"`
- CSS classes: `.file-dropzone`, `.file-dropzone--over` (drag hover), `.file-dropzone--loading`
- On success: sets `fileText` + `fileSourceName` state, shows banner, calls `showToast`

### Active-file banner

- Renders at the top of the `.chat-area` scroll region when `fileSourceName` is set
- CSS class: `.file-source-banner` — blue tinted, shows filename, has ✕ dismiss button
- Dismiss calls `clearFileSource()` which resets both `fileText` and `fileSourceName` and clears `fileSourceIsAutoRef`

### Relevant App.tsx state

| State / ref | Type | Purpose |
|---|---|---|
| `fileText` | `string \| null` | Extracted document text; replaces page text in `sendChatMessage` when set |
| `fileSourceName` | `string \| null` | Display name shown in the banner |
| `isFileLoading` | `boolean` | Disables dropzone and shows "Reading file…" during extraction |
| `isDragOver` | `boolean` | Drives `.file-dropzone--over` style |
| `fileSourceIsAutoRef` | `useRef<boolean>` | `true` = auto-loaded from a PDF tab; `false` = manual upload. Only auto sources are cleared on tab navigation |
| `fileInputRef` | `useRef<HTMLInputElement>` | Hidden `<input type="file">` triggered by dropzone click |

### Auto PDF tab detection (useEffect, runs once on mount)

Monitors the active tab for web-hosted PDF URLs and ingests them automatically:

1. On mount: `chrome.tabs.query({ active, currentWindow })` → checks URL
2. On tab switch: `chrome.tabs.onActivated` → `chrome.tabs.get(tabId)` → checks URL
3. On navigation: `chrome.tabs.onUpdated` filtered to `status === 'complete' && tab.active` → checks URL

URL check (`isPdfUrl`): must start with `http://` or `https://`, pathname must end with `.pdf`.

De-duplication: a closure variable `lastIngestedUrl` inside the effect prevents re-fetching the same URL on repeated events.

**Tab-switch behaviour:**
- Switch to PDF tab → always auto-ingest, set `fileSourceIsAutoRef = true`
- Switch to non-PDF tab → clears source only if `fileSourceIsAutoRef === true` (manual uploads survive tab switches)
- Manual upload (`handleFileUpload`) → sets `fileSourceIsAutoRef = false`

---

## Context Menu (`background.ts`)

Three items registered in `chrome.runtime.onInstalled` (inside `chrome.contextMenus.removeAll()` callback to prevent stale duplicates on reload):

| ID | Title | Behaviour |
|---|---|---|
| `ode-save-note` | Save to Øde Notes | Identical to toolbar save-note: `openSidePanel` → `setPendingSidepanelAction` → `chrome.runtime.sendMessage` with `sidepanel-selection-action / save-note` |
| `ode-fact-check` | Fact Check with Øde | Sends announcement first (creates loading bubble), then calls `factCheckClaim`, sends `sidepanel-fact-check-result`. If selection > 400 chars: sends announcement + immediate error result instead of calling the API |
| `ode-cite` | Cite with Øde | Calls `formatCitation('apa'/'mla', undefined, { title, url })` with no metadata (only tab title + URL available in PDF viewer), builds `citationText`, sends `sidepanel-selection-action / extract-citation` |

**Why this matters for PDFs:** Chrome's native PDF viewer (`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/`) blocks content script injection, so the toolbar cannot appear. Context menu is the only mechanism for users to act on selected PDF text.

**Message routing:** context menu messages are structurally identical to toolbar messages. `handleSelectionAction` in App.tsx handles them without modification.

**Fact-check result key:** `sidepanel-fact-check-result` must carry the same `text` field as the announcement so `getActionKey({ action: 'fact-check', text })` matches the loading placeholder's `pendingActionKey`.

---

## Selection Toolbar (content.ts)

- Fact Check button disabled + relabelled "Text too long" when selection > 400 chars
- `FACT_CHECK_MAX_LENGTH = 400` constant
- Disabled buttons: `opacity: 0.38`, `cursor: not-allowed`

## Fact Check

- Tavily query truncated to 400 chars (`MAX_TAVILY_QUERY_LENGTH` in `lib/factCheck.ts`)
- Pending action cleared after `handleSelectionAction` in the live listener (prevents stuck "Checking…" state)

---

## Known Broken / Incomplete Features

- **AI chat not yet verified end-to-end in a live browser.** Code type-checks and builds; runtime behavior (streaming, memory, quote-jump) was not observed because this machine's Chrome has developer mode disabled by enterprise policy (`ExtensionDeveloperModeSettings`), which blocks loading the unpacked extension. Verify on an unmanaged Chrome/Chromium or via manual "Load unpacked".
- **Document ingest not live-tested** for the same reason. The extraction logic (`unpdf`, `mammoth`, `jszip`) is browser-compatible and the build succeeds, but end-to-end behaviour (large PDFs, password-protected files, malformed PPTX) has not been exercised in a real extension session.
- **Welcome message save button** — the welcome seed assistant message (`id: 'welcome'`) technically shows a "Save to notes" button. Add a `message.id !== 'welcome'` guard in the message rendering if this is unwanted.

## Current Branch & PR

`feat-ask-ai` — PR #8 open, targeting `main`.

**Merged to `main`:**
- PR #3 / #4 — `feat-citations` (citation saving)
- PR #5 — Source tab, pinning, `.bbt` export, Sources folder
- PR #6 — page-context AI chat, Notes UI cleanup
- PR #7 — document ingest (PDF/DOCX/PPTX dropzone + auto PDF tab detection + context menu Save / Fact Check / Cite)
- PR #8 — Ask AI selection flow + save AI responses to notes *(open)*

> Note: GitHub's repo **default branch is set to `feat/notes-overhaul`**, but trunk in practice is `main` (all PRs target it). Consider fixing the default-branch setting.

## Git/Workspace Notes

- `.env` is gitignored and contains API keys
- `gh` must be logged in as `Mateiii` (repo owner) to push/create PRs

## Verification Commands

```bash
npm run compile
npm run verify:persistence
npm run verify:fact-check
npm run build
```
