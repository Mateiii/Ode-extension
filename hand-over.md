# Ode Extension Hand-over

## App Overview

Ode is a Chromium MV3 research assistant extension built with WXT + React. It has:

- content script selection toolbar: Ask AI, Fact Check, Save to Notes, Cite
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

`.env` is gitignored.

## Project Architecture (Phase 3)

Projects are a top-level entity above folders. Each project owns a set of folders; each folder owns notes. The UI and AI context window show only data belonging to the active project.

### Storage keys added
| Key | Type | Notes |
|---|---|---|
| `projects` | `Project[]` | id, name, createdAt, defaultFolderId |
| `activeProjectId` | string | persisted; restored on panel open |

### Type changes
- `NoteFolder` now has `projectId: string` (required).
- `getNoteFolders()` auto-migrates old folders (no `projectId`) to `DEFAULT_PROJECT_ID = 'default-project'`.

### New constants (lib/researchStorage.ts)
`PROJECTS_STORAGE_KEY`, `ACTIVE_PROJECT_STORAGE_KEY`, `DEFAULT_PROJECT_ID`

### New storage functions
- `getProjects()` — creates default "General Research" project on first call.
- `createProject(name)` — atomically creates project + its "General" folder.
- `deleteProject(id)` — cascades: removes project, all its folders, all their notes. Default project is protected.
- `createNoteFolder(name, projectId)` — projectId is now required (defaults to DEFAULT_PROJECT_ID).

### App.tsx derived state
```ts
const activeProject    = projects.find(p => p.id === activeProjectId);
const projectFolders   = folders.filter(f => f.projectId === activeProjectId);
const projectNotes     = notes.filter(n => activeProjectFolderIds.has(n.folderId));
```
All UI (folder list, note list, WikiLinks, move-note dropdown) uses `projectFolders`/`projectNotes` — never raw `folders`/`notes`.

### UI
- **Project bar**: narrow bar above the header — `<select>` dropdown, "+" new project button, trash delete button.
- **New project**: modal with name input.
- **Delete project**: severe multi-step modal showing exact folder/note counts, "Delete everything" CTA.
- Switching projects resets `selectedFolderId` to the new project's `defaultFolderId`.

## Key Files

- `entrypoints/content.ts`: Injects the highlight toolbar and extracts page text for page-note capture.
- `entrypoints/background.ts`: Routes selection actions, opens side panel, runs fact checks, captures active page notes, formats citation text.
- `entrypoints/sidepanel/App.tsx`: Main React side panel UI for chat, notes, folders, exports, citations, context panel.
- `entrypoints/sidepanel/style.css`: Side panel styles.
- `lib/factCheck.ts`: Tavily search + optional OpenAI analysis + fallback fact-check behavior.
- `lib/pageNotes.ts`: AI page-note summarization (OpenAI) + boilerplate cleaning + extractive fallback.
- `lib/researchStorage.ts`: Notes/folders/citation storage helpers. Central source of truth for `QuickNote` type, `getNoteTitle`, `resolveNoteTitle`.
- `lib/sidepanelQueue.ts`: Pending-action handoff for cold-opening the side panel.
- `lib/pageMetadata.ts`: Page metadata scraping — author detection.
- `types/chrome.d.ts`: Local Chrome API typings.

## Architecture: Toolbar Action Flow

**All three note-saving actions (save-note, extract-citation) now save in App.tsx, NOT the background.** This was necessary because only App.tsx knows the currently selected folder via `selectedFolderIdRef`.

Background role for each action:
- `save-note`: calls `openAndAnnounce()` — opens panel, sets pending action, sends `sidepanel-selection-action` message with highlighted text + metadata
- `extract-citation`: formats APA/MLA, sends `citationText` field in message; App.tsx saves the note
- `fact-check`: calls `openAndAnnounce()`, runs `factCheckClaim`, sends `sidepanel-fact-check-result`
- `ask-ai`: calls `openAndAnnounce()` (placeholder)

App.tsx `handleSelectionAction` for `save-note` and `extract-citation` reads `selectedFolderIdRef.current` and calls `saveQuickNote` directly. This ensures notes land in the correct folder.

## QuickNote Type

```ts
type QuickNote = {
  id: string;
  text: string;
  createdAt: string;
  folderId?: string;
  kind?: 'selection' | 'page' | 'manual' | 'citation';
  edited?: boolean;
  customTitle?: string;   // user-set title override; takes priority over metadata.title
  metadata?: PageMetadata;
  title?: string;         // browser tab title at save time
  url?: string;
};
```

`getNoteTitle(note)` in `lib/researchStorage.ts` is the canonical resolver:
```ts
note.customTitle || note.metadata?.title || note.title || 'Untitled page'
```

Import it from researchStorage everywhere — do NOT redefine locally.

## Notes Features

### Inline Editing
- Pencil button in note header (non-citation notes only) → enters edit mode
- Edit mode: title input + textarea, all other buttons disabled
- Save with button or Ctrl/Cmd+Enter; cancel with button or Escape
- Saves `customTitle` and `text`, marks `edited: true`
- `updateQuickNote(id, { text, customTitle? })` in researchStorage

### Note Creation (Manual)
- "New note" button in notes toolbar
- Form appears at top of notes list with title input + textarea
- `kind: 'manual'`; always gets a `customTitle`

### Edited Badge
- Small pencil icon shown in note type label when `note.edited === true`
- CSS class `.note-edited-icon`

### Clipboard Copy
- Second icon button on each note copies `note.text` to clipboard and shows toast

### Markdown Export
- First icon button downloads note as `.md` file

### [[WikiLink]] References
- In read mode, `[[NoteName]]` patterns in note text are parsed and rendered as clickable blue pills
- Clicking a link navigates to the referenced note: switches folder, expands note, scrolls to it via `scrollIntoView`
- Match is case-insensitive against `getNoteTitle(n)` for all notes
- Broken links (no matching note) render with strikethrough in grey
- In edit mode: raw `[[NoteName]]` syntax visible in textarea

Navigation uses `scrollToNoteId` state + a `useEffect` with a 50ms timeout to let React render before scrolling. Note articles have `id={`note-${note.id}`}` for targeting.

### Note Type Labels
- `'page'` → "Page notes"
- `'citation'` → "Citation" (with blue badge)
- `'manual'` → "Note"
- anything else → "Selection note"

## Selection Toolbar (content.ts)

- Fact Check button is disabled and relabeled "Text too long" when selection exceeds 400 characters
- `FACT_CHECK_MAX_LENGTH = 400` constant at top of content.ts
- Disabled buttons: `opacity: 0.38`, `cursor: not-allowed`, hover does nothing

## Fact Check

- Tavily query is truncated to 400 chars before sending to avoid API errors on long selections (`MAX_TAVILY_QUERY_LENGTH` in `lib/factCheck.ts`)
- Pending action is cleared from the live `onMessage` handler after processing, preventing stale "Checking…" state on panel refresh

## Pending Action / Stale Loading Fix

`clearPendingSidepanelAction()` is called (no ID, clears whatever is pending) after `handleSelectionAction(message)` in the live `onMessage` listener. This prevents the fact-check loading state from getting stuck after a panel refresh.

## Note Title Naming

### Selection notes (`kind: 'selection'`)

Title is generated at save time in `handleSelectionAction` (App.tsx):

```ts
const _ts = `${MONTHS[month]} ${day}, ${HH}:${MM}`;
const _raw = message.text.replace(/\s+/g, ' ').trim();
const _short = _raw.length > 35 ? _raw.slice(0, 34).trimEnd() + '…' : _raw;
const selectionCustomTitle = `[${_ts}] ${_short}`;
```

Result example: `[Jun 3, 14:23] The quick brown fox jumps ov…`

Stored as `customTitle` so it takes priority over the fallback page-title chain.

### Manual notes (`kind: 'manual'`)

`buildDefaultNoteTitle()` in App.tsx pre-populates the title input when the "New note" form opens. Format: `[Jun 3, 14:23] Page Title…` (uses `context?.metadata?.title || context?.title`). User can edit before saving.

Known caveat: if `context` is null when the button is clicked (page blocks scripting, or async executeScript hasn't resolved yet), the title falls back to just `[Jun 3, 14:23]`. Not a blocker.

### Citation notes (`kind: 'citation'`)

Raw title derived from `message.metadata?.title || message.title || 'Citation'`, then run through `resolveNoteTitle` and stored as `customTitle`.

## Note Title Deduplication (`resolveNoteTitle`)

**Status: working.**

Located in `lib/researchStorage.ts`. Signature:

```ts
export async function resolveNoteTitle(
  desired: string,
  targetFolderId: string,
  excludeNoteId?: string,
): Promise<string>
```

Fetches fresh notes and folders from storage internally — no stale React state. Rules:

| Situation | Result |
|---|---|
| No conflict | `desired` unchanged |
| Conflict in a **different** folder | `desired (FolderName)` |
| Conflict in the **same** folder | `desired (2)`, `desired (3)`, … |

Called from all four save paths in App.tsx:
- `handleSelectionAction` save-note — chained before `saveQuickNote`
- `handleSelectionAction` extract-citation — chained before `saveQuickNote`
- `saveNewNote` — `await resolveNoteTitle(rawTitle, folderId)`
- `saveEditNote` — `await resolveNoteTitle(trimmedTitle, folderId, note.id)`

## Source Tab (formerly Citations)

The third tab is now labelled **Source** (internal value `'source'`). It shows:
- A source header: page title + canonical URL
- APA and MLA citation rows, each with a **Copy** and a **Save to Notes** (bookmark-plus) button
- The save button targets the active project's `sourcesFolderId` (the "Sources" folder)

## Sources Folder

Every project now has a `sourcesFolderId` (alongside `defaultFolderId`). The Sources folder is created:
- On fresh install (alongside "General") via `getNoteFolders()`
- When creating a new project via `createProject()`
- For existing projects via `ensureProjectSourcesFolders()` — a migration called at startup in `loadInitialData()`

`SOURCES_FOLDER_ID = 'sources'` is the hardcoded ID for the default project's Sources folder (mirrors the `DEFAULT_FOLDER_ID = 'default'` pattern).

## Note Pinning & Reordering

Each note article now has a two-column layout:
- **Left (24 px)**: `note-reorder` strip with up (↑) and down (↓) ghost buttons
- **Right**: `note-content` — all existing header + body content

Pinned notes float to the top of the folder view (`sortedVisibleNotes = [...pinned, ...unpinned]`). Up/down arrows reorder within each group (pinned ↔ pinned, unpinned ↔ unpinned). Arrows are disabled at group boundaries.

Storage: `pinQuickNote(id, pinned)`, `swapQuickNotes(idA, idB)` in `researchStorage.ts`.

Visual: pinned notes get a blue left border (`.note-item--pinned`); the pin button turns blue when active (`.note-pin-btn--active`).

## BibTeX Export (`.bbt`)

`lib/bibtex.ts` — pure formatting module:
- `formatBibtex(note, keyOverride?)` — single `@misc` entry with author, title, organization, year, url, howpublished, note (accessed date)
- `formatBibtexBundle(notes[])` — full file with header comment and deduplicated citation keys

"Export .bbt" button in the notes toolbar exports all visible notes in the current folder. The toolbar layout is a 2-column grid with "New note" spanning full width (top row) and "Take page notes" + "Export .bbt" sharing the second row.

## Known Broken / Incomplete Features

*(none currently)*

## Current Branch & PR

`feat-projects` branch — Phase 3 project workspaces + Source tab + pinning/reordering + .bbt export. PRs #3 and #4 (`feat-citations`) merged to `main`.

## Git/Workspace Notes

`.env` is gitignored and contains API keys.
`gh` must be logged in as `Mateiii` (repo owner) to push/create PRs.

## Verification Commands

```bash
npm run compile
npm run verify:persistence
npm run verify:fact-check
npm run build
```
