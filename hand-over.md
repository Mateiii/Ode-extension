# Ode Extension Hand-over

## App Overview

Ode is a Chromium MV3 research assistant extension built with WXT + React. It has:

- content script selection toolbar: Ask AI, Fact Check, Save to Notes, Cite
- Chrome side panel UI with Chat / Notes / Source / Account tabs
- **page-context AI chat**: streaming answers grounded in the active tab's text (or an uploaded document), with conversation memory and click-to-jump source citations
- **document ingest**: drag-and-drop or click-to-upload PDF / DOCX / PPTX in the Chat tab; auto-fetches web-hosted PDFs when the active tab URL ends in `.pdf`
- **context menu actions**: right-click on any selection (including inside Chrome's native PDF viewer) → Save to Øde Notes / Fact Check with Øde / Cite with Øde
- background service worker for privileged actions, storage, Tavily/OpenAI calls, and active-tab page capture
- local `chrome.storage.local` persistence for projects, folders, notes, and pending sidepanel actions
- **Supabase auth + cloud sync**: premium users get notes/citations mirrored to Supabase in real time
- **Stripe payments**: hosted Payment Link flow upgrades a user to premium; local webhook server flips the `is_premium` flag in Supabase

## Setup

```bash
npm install
npm run dev       # hot-reload dev build
npm run build     # production build
npm run compile   # tsc type-check only (no emit)
```

Env vars go in `.env` at repo root. **All `WXT_*` vars are baked into the extension bundle at build time; the others are server-side only.**

```bash
# AI features
WXT_TAVILY_API_KEY=...
WXT_OPENAI_API_KEY=...
WXT_OPENAI_MODEL=gpt-4o-mini        # optional; defaults to gpt-4o-mini

# Supabase (anon key is safe to bundle; service role key is server-side only)
WXT_SUPABASE_URL=https://your-project.supabase.co
WXT_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...       # webhook server only — never in the bundle

# Stripe
WXT_STRIPE_PAYMENT_LINK=https://buy.stripe.com/test_...   # baked into bundle
STRIPE_SECRET_KEY=sk_test_...                              # webhook server only
STRIPE_WEBHOOK_SECRET=whsec_...                            # webhook server only
```

`.env` is gitignored.

## Key Files

| File | Purpose |
|---|---|
| `entrypoints/content.ts` | Injects the highlight toolbar; extracts page text for page-note capture; **guards against non-HTML documents** |
| `entrypoints/background.ts` | Routes selection actions, opens side panel, runs fact checks, captures page notes, formats citation text, serves `request-page-text` for chat |
| `entrypoints/sidepanel/App.tsx` | Main React side panel — all UI: chat, notes, folders, Source tab, projects, account tab; auth state; `saveNoteWithSync` |
| `entrypoints/sidepanel/AccountPanel.tsx` | Sign-in / sign-up / user card / upgrade CTA panel |
| `entrypoints/sidepanel/SettingsPanel.tsx` | Settings panel (theme, citation style, layout, cloud sync toggle) |
| `entrypoints/sidepanel/style.css` | Side panel styles |
| `lib/researchStorage.ts` | All storage helpers; canonical `QuickNote` / `NoteFolder` / `Project` types; `getNoteTitle`, `resolveNoteTitle`, `formatCitation` |
| `lib/supabase.ts` | Supabase client; `signInWithEmail`, `signUpWithEmail`, `signOut`, `getIsPremiumUser`, `SupabaseUser` type |
| `lib/cloudSync.ts` | `syncNoteToCloud(note, userId)` — upserts to `notes` table; also `citations` for `kind === 'citation'` |
| `lib/stripe.ts` | `openStripeCheckout(userId, email)` — opens Payment Link in new tab; `IS_STRIPE_CONFIGURED` build-time flag |
| `lib/pageChat.ts` | AI chat: streaming OpenAI Chat Completions (SSE), system-prompt assembly, `ChatTurn` history type |
| `lib/bibtex.ts` | BibTeX formatting — `formatBibtex(note)`, `formatBibtexBundle(notes[])` |
| `lib/factCheck.ts` | Tavily search + OpenAI analysis + fallback fact-check |
| `lib/pageNotes.ts` | AI page-note summarisation (OpenAI) + boilerplate cleaning + extractive fallback |
| `lib/pageMetadata.ts` | Page metadata scraping — title, author, canonical URL, date, site name |
| `lib/fileParsers.ts` | Document text extraction: `extractPdfText` (unpdf), `extractDocxText` (mammoth), `extractPptxText` (jszip), `extractFileText` dispatcher, `extractTextFromPdfUrl` fetch helper |
| `lib/sidepanelQueue.ts` | Pending-action handoff for cold-opening the side panel |
| `lib/useSettings.ts` | `useSettings` hook — reads/writes `AppSettings` (theme, citation style, storage mode, panel alignment) from `chrome.storage.local` |
| `scripts/stripe-webhook-server.mjs` | Local Node server — receives Stripe webhook events and upgrades Supabase users to premium |
| `types/chrome.d.ts` | Local Chrome API typings (incl. `tabs.create`, `executeScript` args, `sendMessage` response callback, `tabs.onActivated/onUpdated`, `contextMenus`) |

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
| `save-note` | `openAndAnnounce()` — opens panel, sends message | Saves note via `saveNoteWithSync` to `selectedFolderIdRef.current` |
| `extract-citation` | Formats APA/MLA, sends `citationText` in message | Saves citation note via `saveNoteWithSync` to selected folder |
| `fact-check` | Runs `factCheckClaim`, sends result message | Renders result in chat |
| `ask-ai` | `openAndAnnounce()` — opens panel, sends message | Switches to Chat tab, pre-fills input with selection as block-quote, focuses textarea |

`clearPendingSidepanelAction()` is called after `handleSelectionAction` in the live `onMessage` listener to prevent stale loading states on panel refresh.

The same four actions are also available via the **context menu** (see Context Menu section below). Context menu messages are structurally identical to toolbar messages so `handleSelectionAction` processes both without distinguishing the source.

---

## Supabase Auth & Cloud Sync

### Client (`lib/supabase.ts`)

```ts
export const supabase = createClient(WXT_SUPABASE_URL, WXT_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
```

Uses the browser's `localStorage` for session persistence (available in the sidepanel; **not** in service workers — do not import from `background.ts`).

Exports:
- `signInWithEmail(email, password)` → `{ error: string | null }`
- `signUpWithEmail(email, password)` → `{ error: string | null }` — Supabase sends a confirmation email; user is not active until they click it
- `signOut()`
- `getIsPremiumUser()` — reads `session.user.user_metadata.is_premium`
- `SupabaseUser` type

### Auth state in App.tsx

```ts
const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
const [isPremiumUser, setIsPremiumUser] = useState(false);
```

Initialised on mount via `supabase.auth.getSession()`, kept live via `supabase.auth.onAuthStateChange()`. Two refs mirror the state for use inside `[]`-dep effects:

```ts
const isPremiumUserRef = useRef(false);   // updated in useEffect([isPremiumUser])
const authUserIdRef   = useRef<string | null>(null); // updated in useEffect([authUser])
```

### Save middleware (`saveNoteWithSync`)

Every note-save path calls `saveNoteWithSync` instead of `saveQuickNote` directly:

```ts
const saveNoteWithSync = useCallback(async (input) => {
  const note = await saveQuickNote(input);           // local first — always works offline
  if (isPremiumUserRef.current && authUserIdRef.current) {
    void syncNoteToCloud(note, authUserIdRef.current).catch(() => {});  // fire-and-forget
  }
  return note;
}, []);
```

`saveEditNote` also syncs edits after `updateQuickNote`.

### Cloud sync (`lib/cloudSync.ts`)

```ts
export async function syncNoteToCloud(note: QuickNote, userId: string): Promise<void> {
  await supabase.from('notes').upsert({ ...note, user_id: userId });
  if (note.kind === 'citation') {
    await supabase.from('citations').upsert({ ...note, user_id: userId });
  }
}
```

### Supabase tables required

| Table | Columns |
|---|---|
| `notes` | All `QuickNote` fields + `user_id uuid` |
| `citations` | Same shape — citation-kind notes are dual-written |

Set `is_premium: true` in a user's `user_metadata` via the Supabase dashboard (Authentication → Users → Edit) to grant premium access.

### Premium folder gate

`handleCreateFolder` in App.tsx blocks non-premium users who already have ≥ 1 custom folder (beyond the two system folders — General and Sources) and shows the `showPremiumUpsell` modal instead. The modal's "See plans →" CTA navigates to the `account` tab.

---

## Stripe Payments

### Extension side (`lib/stripe.ts`)

```ts
export const IS_STRIPE_CONFIGURED: boolean   // false when env var is missing or is a placeholder
export function openStripeCheckout(userId: string, email?: string): boolean
```

`openStripeCheckout` appends `?client_reference_id=<userId>&prefilled_email=<email>` to the Payment Link URL and calls `chrome.tabs.create`. Returns `false` (and logs a setup guide) if `IS_STRIPE_CONFIGURED` is false — **no tab is opened**. App.tsx shows a toast in that case.

`AccountPanel` imports `IS_STRIPE_CONFIGURED` directly and renders the upgrade button as disabled with label "Payments not configured" when it's false.

### Local webhook server (`scripts/stripe-webhook-server.mjs`)

Receives Stripe events and upgrades the Supabase user to premium. Handles `checkout.session.completed` only; extend `EVENT_HANDLERS` for renewals / cancellations.

```
checkout.session.completed
  → reads client_reference_id (= Supabase user ID)
  → supabase.auth.admin.updateUserById(userId, { user_metadata: { is_premium: true } })
```

Uses the **service-role key** (not the anon key) for the Supabase admin API.

### Local dev workflow

```bash
# Terminal 1
npm run dev                 # extension hot-reload

# Terminal 2
npm run stripe:server       # starts webhook server on :4242

# Terminal 3
npm run stripe:listen       # Stripe CLI → forwards test events to :4242
                            # copy the whsec_… it prints → STRIPE_WEBHOOK_SECRET in .env
```

### One-time Stripe setup

1. Create a product in the Stripe dashboard → **Products → Payment Links** → copy the URL
2. Add to `.env`: `WXT_STRIPE_PAYMENT_LINK=https://buy.stripe.com/test_...`
3. `npm run dev` to rebuild — `IS_STRIPE_CONFIGURED` becomes `true` and the button activates
4. Test with card `4242 4242 4242 4242`, any future expiry, any CVC

---

## Account Tab

`ActiveTab` value: `'account'`. Toggled via a `LogIn` icon button in the panel header (alongside the Settings gear), both wrapped in `.panel-header-actions`.

`AccountPanel` (`entrypoints/sidepanel/AccountPanel.tsx`) has three views:

| State | Renders |
|---|---|
| Not logged in | Sign-in / Sign-up tab toggle + form |
| Post sign-up | Confirmation screen ("Check your inbox") with back link |
| Logged in | User card (email + plan badge) + upgrade upsell card (free) or sync-active indicator (premium) + sign-out button |

Sign-up includes a **confirm password** field with client-side mismatch and minimum-length validation before hitting Supabase.

The input section and chat bar are hidden when `activeTab === 'account'` (same as `'settings'`).

---

## Selection Toolbar (content.ts)

### Non-HTML document guard

Added at the very top of `main()`, before any DOM mutation:

```ts
const contentType = document.contentType?.toLowerCase() ?? '';
const rootTag = document.documentElement?.nodeName ?? '';
if (
  rootTag !== 'HTML' ||              // XML / SVG / S3 error root ≠ "HTML"
  contentType.includes('xml') ||     // text/xml, application/xml, image/svg+xml
  contentType.includes('json') ||    // application/json
  contentType.includes('text/plain') // raw .txt responses
) {
  return;
}
```

Without this guard, navigating to an S3 XML error page, JSON API endpoint, or plain-text URL caused the toolbar's shadow-DOM CSS and button text to be injected as raw text nodes, polluting the document tree and corrupting clipboard copies.

### Toolbar behaviour

- Fact Check button disabled + relabelled "Text too long" when selection > 400 chars (`FACT_CHECK_MAX_LENGTH`)
- Disabled buttons: `opacity: 0.55`, `cursor: not-allowed`

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
- `updateQuickNote(id, { text, customTitle? })` in researchStorage; premium users also get `syncNoteToCloud` called
- Edited badge: small pencil icon (`.note-edited-icon`) in the type label

### Save AI Response to Notes

Every completed, non-error assistant chat message shows a quiet **"Save to notes"** footer button (`.message-save-btn`, `BookmarkPlus` icon). Clicking it opens an inline folder picker (`.message-save-picker`) in place:

- A native `<select>` listing all project folders, defaulting to `selectedFolderIdRef.current`
- **Save** (dark filled button) and **Cancel** (ghost button)

State: `savingMessageId: string | null` tracks which message's picker is open; `saveAiFolderId: string` tracks the chosen folder.

`handleSaveAiResponse(content)`:
1. Calls `stripScrollQuotes(content)` — strips `[label](#scroll-quote=phrase)` to plain `label`
2. Builds a `[Jun 7, 14:23] first 35 chars…` title from the stripped text
3. Calls `resolveNoteTitle` for deduplication
4. Calls `saveNoteWithSync({ text: stripped, kind: 'ai-chat', folderId, customTitle })`
5. Clears `savingMessageId`, shows "AI response saved to notes." toast

`stripScrollQuotes` is a module-level pure function in `App.tsx`:
```ts
function stripScrollQuotes(text: string): string {
  return text.replace(/\[([^\]]+)\]\(#scroll-quote=[^)]+\)/g, '$1');
}
```

**Note:** the welcome seed message (`id: 'welcome'`) technically shows a "Save to notes" button. Add a `message.id !== 'welcome'` guard in the message rendering if this is undesirable.

### Manual Note Creation

- "New note" button → form appears at top of list
- `kind: 'manual'`; pre-populated title via `buildDefaultNoteTitle()`: `[Jun 3, 14:23] Page Title…`

### Notes Toolbar Layout

2-column CSS grid (`.notes-toolbar`):
- Row 1: **New note** (spans both columns, full width)
- Row 2: **Take page notes** | **Export .bbt**

### Folder creation

New folders are created via a **`+` circle button** (`.folder-add-btn`) at the end of the folder chip row. Clicking it opens a name modal (`isCreatingFolder` state), Enter/"Create folder" submits via `handleCreateFolder`, Escape/overlay cancels.

**Premium gate:** `handleCreateFolder` checks whether the user is non-premium and already has ≥ 1 custom folder (beyond General + Sources). If so, it aborts and sets `showPremiumUpsell = true` — the upsell modal's "See plans →" button navigates to the `account` tab.

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

Called from all save paths: `handleSelectionAction` (save-note, extract-citation), `saveNewNote`, `saveEditNote`, `handleSaveAiResponse`.

---

## Source Tab

The third panel tab is labelled **Source** (internal `ActiveTab` value: `'source'`). It shows, wrapped in `.source-area`:

1. **Context box** — collapsible current-page context (title, author, canonical URL, captured selection), at the top
2. **Source header** — current page title + canonical URL (`.citation-source-info`)
3. **APA row** — formatted citation + Copy button + Save to Notes button
4. **MLA row** — same

The **Save to Notes** button (`BookmarkPlus` icon) calls `saveCitationAsNote(label, value)`:
- Targets `projectSourcesFolder?.id ?? selectedFolderIdRef.current ?? DEFAULT_FOLDER_ID`
- Saves a `kind: 'citation'` note with the citation text via `saveNoteWithSync`
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

## Fact Check

- Tavily query truncated to 400 chars (`MAX_TAVILY_QUERY_LENGTH` in `lib/factCheck.ts`)
- Pending action cleared after `handleSelectionAction` in the live listener (prevents stuck "Checking…" state)

---

## Known Broken / Incomplete Features

- **AI chat not yet verified end-to-end in a live browser.** Code type-checks and builds; runtime behavior (streaming, memory, quote-jump) was not observed because this machine's Chrome has developer mode disabled by enterprise policy (`ExtensionDeveloperModeSettings`), which blocks loading the unpacked extension. Verify on an unmanaged Chrome/Chromium or via manual "Load unpacked".
- **Document ingest not live-tested** for the same reason. The extraction logic (`unpdf`, `mammoth`, `jszip`) is browser-compatible and the build succeeds, but end-to-end behaviour (large PDFs, password-protected files, malformed PPTX) has not been exercised in a real extension session.
- **Welcome message save button** — the welcome seed assistant message (`id: 'welcome'`) technically shows a "Save to notes" button. Add a `message.id !== 'welcome'` guard in the message rendering if this is unwanted.
- **Stripe payment link not yet wired** — `WXT_STRIPE_PAYMENT_LINK` is a placeholder in `.env`. The upgrade button renders as disabled ("Payments not configured") until a real Payment Link URL is set and the extension is rebuilt.
- **`SUPABASE_SERVICE_ROLE_KEY` not yet set** — needed by the webhook server (`npm run stripe:server`) to write `user_metadata`. Copy it from the Supabase dashboard (Project Settings → API → service_role).

## Current Branch & PR

`feat-ask-ai` — PR #8 open, targeting `main`.

**Merged to `main`:**
- PR #3 / #4 — `feat-citations` (citation saving)
- PR #5 — Source tab, pinning, `.bbt` export, Sources folder
- PR #6 — page-context AI chat, Notes UI cleanup
- PR #7 — document ingest (PDF/DOCX/PPTX dropzone + auto PDF tab detection + context menu Save / Fact Check / Cite)
- PR #8 — Ask AI selection flow + save AI responses to notes *(open)*

**Unmerged work (current session, on top of PR #8):**
- Supabase auth + cloud sync (`lib/supabase.ts`, `lib/cloudSync.ts`, `AccountPanel.tsx`)
- Stripe payment gateway (`lib/stripe.ts`, `scripts/stripe-webhook-server.mjs`)
- Content script non-HTML document guard (`entrypoints/content.ts`)
- Premium folder gate + `showPremiumUpsell` modal
- `saveNoteWithSync` middleware replacing all direct `saveQuickNote` calls
- `IS_STRIPE_CONFIGURED` build-time flag with graceful disabled-button state
- `chrome.tabs.create` added to `types/chrome.d.ts`

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

# Stripe local dev
npm run stripe:server   # webhook receiver on :4242
npm run stripe:listen   # Stripe CLI → forwards test events (requires Stripe CLI installed)
```
