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

## Known Broken / Incomplete Features

### Default Note Title (`buildDefaultNoteTitle`)

**Status: not working reliably.**

Located in `App.tsx` just before `startCreateNote`. Intended format: `[Jun 3, 14:23] Article Title…`

```ts
const buildDefaultNoteTitle = () => {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ts = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${HH}:${MM}`;
  const pageTitle = context?.metadata?.title || context?.title || '';
  ...
  return pageTitle ? `[${ts}] ${shortened}` : `[${ts}]`;
};
```

Called in `startCreateNote` to pre-populate `newNoteTitle`. The issue is likely one or more of:
1. `context` is null when the form opens (async executeScript on mount hasn't resolved, or the page blocks scripting)
2. The title IS being set but then overwritten/reset somewhere in state
3. There may be a React closure/stale-state issue since `buildDefaultNoteTitle` closes over `context` state

**To debug**: `console.log(context)` inside `buildDefaultNoteTitle`, and `console.log(newNoteTitle)` inside `saveNewNote`. Check if context is populated at click time.

### Note Naming Conventions (`resolveNoteTitle`)

**Status: not working reliably.**

Located in `lib/researchStorage.ts`. Logic:
- If desired title is not taken → use as-is
- If taken in a **different** folder → append ` (FolderName)`
- If taken in the **same** folder → append ` (2)`, ` (3)`, …

Called from `saveNewNote` and `saveEditNote` in App.tsx, passing the current React `notes` and `folders` state arrays.

Likely issues:
1. `notes` state passed to `resolveNoteTitle` may be stale (React state snapshot from last render, not including a note just saved milliseconds ago via `saveQuickNote`)
2. `getNoteTitle` compares against all notes including ones with `metadata?.title` from web pages — these can be long strings like "Title | Site Name" that never conflict with user-typed titles, so the deduplication may appear to do nothing for realistic cases
3. The function was not tested against actual storage state, only React state snapshot

**To fix**: Instead of passing `notes` from React state, call `getQuickNotes()` inside `resolveNoteTitle` (make it async) to always work against live storage. This avoids stale-state issues entirely.

Suggested rewrite in `researchStorage.ts`:

```ts
export async function resolveNoteTitle(
  desired: string,
  targetFolderId: string,
  folders: NoteFolder[],
  excludeNoteId?: string,
): Promise<string> {
  const allNotes = await getQuickNotes(); // always fresh
  // ... rest of logic unchanged
}
```

Then update call sites in App.tsx to `await resolveNoteTitle(...)`.

## Current Branch & PR

Branch `feat-citations` is open as PR #3 against `main`.

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
