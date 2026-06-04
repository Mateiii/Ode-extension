# Ode Extension Hand-over

## App Overview

Ode is a Chromium MV3 research assistant extension built with WXT + React. It has:

- content script selection toolbar: Ask AI, Fact Check, Save to Notes, Cite
- Chrome side panel UI with Chat / Notes / Source tabs
- background service worker for privileged actions, storage, Tavily/OpenAI calls, and active-tab page capture
- local `chrome.storage.local` persistence for projects, folders, notes, and pending sidepanel actions

## Setup

```bash
npm install
npm run dev       # hot-reload dev build
npm run build     # production build
npm run compile   # tsc type-check only (no emit)
```

Fact-check env vars go in `.env` at repo root:

```bash
WXT_TAVILY_API_KEY=...
WXT_OPENAI_API_KEY=...
WXT_OPENAI_MODEL=gpt-4.1-mini
```

`.env` is gitignored.

## Key Files

| File | Purpose |
|---|---|
| `entrypoints/content.ts` | Injects the highlight toolbar; extracts page text for page-note capture |
| `entrypoints/background.ts` | Routes selection actions, opens side panel, runs fact checks, captures page notes, formats citation text |
| `entrypoints/sidepanel/App.tsx` | Main React side panel — all UI: chat, notes, folders, Source tab, projects |
| `entrypoints/sidepanel/style.css` | Side panel styles |
| `lib/researchStorage.ts` | All storage helpers; canonical `QuickNote` / `NoteFolder` / `Project` types; `getNoteTitle`, `resolveNoteTitle`, `formatCitation` |
| `lib/bibtex.ts` | BibTeX formatting — `formatBibtex(note)`, `formatBibtexBundle(notes[])` |
| `lib/factCheck.ts` | Tavily search + OpenAI analysis + fallback fact-check |
| `lib/pageNotes.ts` | AI page-note summarisation (OpenAI) + boilerplate cleaning + extractive fallback |
| `lib/pageMetadata.ts` | Page metadata scraping — title, author, canonical URL, date, site name |
| `lib/sidepanelQueue.ts` | Pending-action handoff for cold-opening the side panel |
| `types/chrome.d.ts` | Local Chrome API typings |

---

## Data Model

### `QuickNote`

```ts
type QuickNote = {
  id: string;
  text: string;
  createdAt: string;
  folderId?: string;
  kind?: 'selection' | 'page' | 'manual' | 'citation';
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
| `ask-ai` | `openAndAnnounce()` (placeholder) | — |

`clearPendingSidepanelAction()` is called after `handleSelectionAction` in the live `onMessage` listener to prevent stale loading states on panel refresh.

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

### Manual Note Creation

- "New note" button → form appears at top of list
- `kind: 'manual'`; pre-populated title via `buildDefaultNoteTitle()`: `[Jun 3, 14:23] Page Title…`

### Notes Toolbar Layout

2-column CSS grid (`.notes-toolbar`):
- Row 1: **New note** (spans both columns, full width)
- Row 2: **Take page notes** | **Export .bbt**

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

The third panel tab is labelled **Source** (internal `ActiveTab` value: `'source'`). It shows:

1. **Source header** — current page title + canonical URL (`.citation-source-info`)
2. **APA row** — formatted citation + Copy button + Save to Notes button
3. **MLA row** — same

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

## Selection Toolbar (content.ts)

- Fact Check button disabled + relabelled "Text too long" when selection > 400 chars
- `FACT_CHECK_MAX_LENGTH = 400` constant
- Disabled buttons: `opacity: 0.38`, `cursor: not-allowed`

## Fact Check

- Tavily query truncated to 400 chars (`MAX_TAVILY_QUERY_LENGTH` in `lib/factCheck.ts`)
- Pending action cleared after `handleSelectionAction` in the live listener (prevents stuck "Checking…" state)

---

## Known Broken / Incomplete Features

*(none currently)*

## Current Branch & PR

`feat-projects` branch — PR #5 open against `main`.
PRs #3 and #4 (`feat-citations`) already merged to `main`.

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
