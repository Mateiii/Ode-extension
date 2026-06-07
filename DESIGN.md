---
name: Øde
description: A research co-pilot living in the Chrome side panel.
colors:
  ochre: "oklch(0.51 0.11 89)"
  ochre-hover: "oklch(0.44 0.10 89)"
  ochre-tint: "oklch(0.960 0.025 91)"
  ink: "oklch(0.151 0.022 247)"
  surface: "oklch(0.975 0.004 91)"
  white: "oklch(1.000 0.000 0)"
  muted: "oklch(0.491 0.014 248)"
  faint: "oklch(0.555 0.018 248)"
  border: "oklch(0.905 0.009 248)"
  border-light: "oklch(0.835 0.015 248)"
  hover-bg: "oklch(0.954 0.006 248)"
  link: "oklch(0.474 0.138 249)"
  danger: "oklch(0.437 0.148 29)"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.2
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  xs: "4px"
  sm: "7px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.ochre}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.ochre-hover}"
    textColor: "{colors.white}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.faint}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 12px"
  note-card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "12px"
  folder-chip:
    backgroundColor: "{colors.white}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    height: "30px"
  folder-chip-active:
    backgroundColor: "{colors.ochre-tint}"
    textColor: "{colors.ochre}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "34px"
---

# Design System: Øde

## 1. Overview

**Creative North Star: "The Annotated Margin"**

Øde is the layer of precision that sits alongside original research. Every element in this system asks: is this the mark of someone who read carefully, or someone who decorated a template? The answer is always the former. Surfaces are spare. Type does the structural work. The ochre accent appears like a pencil underlining — rare, intentional, exact.

The palette is built around the principle that warmth belongs to the accent, not the background. Crisp white pages carry the content; deep ochre (the pigment-name hue, not a tech-brand orange) marks what matters. The neutral ramp leans cool — a slate family with faint blue undertones — so the ochre reads as a considered mark against an academic field, not a product accent against a warm-neutral SaaS canvas.

This system explicitly rejects: the white-bubble-on-dark-sidebar AI chat aesthetic (ChatGPT, Perplexity), the warm-cream-with-rounded-everything SaaS register (Notion-adjacent products), and the "browser extension grey" starting point — the current state before this system was established.

**Key Characteristics:**
- Flat surfaces at rest; tonal separation between `surface` and `white` creates depth without shadows
- Single accent color used at ≤10% surface area: ochre for primary actions, active states, and no other purpose
- Inter alone, tuned through weight and size — five tracked roles, no display/body split
- 8px radius throughout; gently curved but not soft
- Transitions at 120–160ms ease-out; state changes only, no choreography

## 2. Colors: The Annotated Margin Palette

The palette is restrained: one warm brand accent against a cool-neutral field. Ochre earns its presence through rarity.

### Primary
- **Ochre** (`oklch(0.51 0.11 89)`): The sole brand accent. Used for: primary buttons, active folder chip, the panel header wordmark background accent. Appears at ≤10% of any given screen. White text on this fill at all times — the hue is warm-saturated and Helmholtz-Kohlrausch makes dark text on it read muddy. Never used for borders, dividers, or passive states.
- **Ochre Hover** (`oklch(0.44 0.10 89)`): Pressed and hover state for ochre-filled elements. Roughly 15% darker in lightness; same hue.
- **Ochre Tint** (`oklch(0.960 0.025 91)`): Near-white with 2.5% ochre chroma. Active folder chip background, selected note ring. Pairs with a thin ochre border at `{colors.ochre}` opacity 0.35.

### Neutral
- **Ink** (`oklch(0.151 0.022 247)`): Body text, primary button fill, toast background. Must never drop below 7:1 contrast against `{colors.white}`. Slightly cool (hue 247) — it reads as "heavy stock" not warm.
- **White** (`oklch(1.000 0.000 0)`): Card surfaces, modal backgrounds, input backgrounds. Pure white. Never off-white, never cream.
- **Surface** (`oklch(0.975 0.004 91)`): Panel backgrounds (chat area, notes area, project bar). Near-white with 0.4% ochre chroma — imperceptible as a hue but gives a slightly warmer cast than cool white. Distinguishes panels from cards without a border.
- **Hover Background** (`oklch(0.954 0.006 248)`): Hover state fill for ghost buttons and list items. Slightly darker surface-family step.
- **Muted** (`oklch(0.491 0.014 248)`): Secondary labels, tab text, note metadata timestamps. Must reach ≥4.5:1 against `{colors.white}` (it does — confirmed at 5.2:1).
- **Faint** (`oklch(0.555 0.018 248)`): Tertiary text, placeholder labels, icon default state. ≥3.5:1 against `{colors.white}`.
- **Border** (`oklch(0.905 0.009 248)`): Dividers, card borders, section separators.
- **Border Light** (`oklch(0.835 0.015 248)`): Input and select borders, lighter structural lines.

### Secondary
- **Link** (`oklch(0.474 0.138 249)`): Inline hyperlinks, scroll-quote anchor text, wiki-link pills. Cool steel blue — a functional color, not a brand color. Used exclusively for navigational text.
- **Danger** (`oklch(0.437 0.148 29)`): Destructive action buttons, error states, delete confirmations. Red-orange family. Never used for warnings (there is no warning role in this system currently).

**The One Ochre Rule.** Ochre appears once per screen in a meaningful way: the primary action, or the active selection state. Never both on the same screen at full saturation. When the active folder chip is ochre-tinted, the primary CTA button may still be full ochre — but no third ochre element should appear at the same time.

**The No-Tinted-Background Rule.** `{colors.surface}` exists; it is the only background that carries any hue. Body backgrounds, modal overlays, and panel containers do not use cream, beige, warm white, or cool blue — those are the SaaS-default registers this system rejects.

## 3. Typography

**Body Font:** Inter (with `ui-sans-serif, system-ui, sans-serif` fallback chain)

**Character:** Single family, five tracked roles differentiated purely by size and weight. No display/body pairing needed in a 400px panel — Inter's large weight range handles all hierarchy. The absence of a second typeface is a deliberate choice: multiplying families in a utility tool reads as indecision, not richness.

### Hierarchy

- **Title** (700, 19px, line-height 1.2): Panel heading "Øde" and section titles at the top of each tab. One per screen.
- **Headline** (700, 16px, line-height 1.3): Modal headers, major section heads within a view.
- **Body** (400–500, 13px, line-height 1.45): Note content, chat messages, citation text, all readable prose. The dominant role.
- **Label** (700, 12px, line-height 1.2): Button labels, tab navigation, folder chip names, note type badges. Weight carries hierarchy; size stays compact.
- **Micro** (600, 11px, line-height 1.3): Timestamps, source URLs, metadata fields. Reserved for secondary, non-scanning reads.

**The Single Family Rule.** Inter is the only typeface. Adding a display face, a serif for headings, or a mono for labels is forbidden. Weight contrast (400 vs 700 within the same family) provides all the hierarchy this panel needs.

**The Weight Rule.** Labels are 700; body is 400 (or 500 for tight inline contexts). Never use 600 as the sole differentiator between a label and body text at the same size — jump to 700 or drop to 400.

## 4. Elevation

Øde is flat by default. Depth is conveyed through tonal layering: `{colors.surface}` (panels) beneath `{colors.white}` (cards) against `{colors.white}` (modals). Borders exist for structure, not decoration.

Shadows appear only when an element genuinely needs to break the stacking context: modals and toasts.

### Shadow Vocabulary
- **Modal lift** (`0 20px 50px rgba(15, 23, 42, 0.30)`): Full modal overlays. Conveys: this layer is above everything.
- **Toast rise** (`0 12px 30px rgba(15, 23, 42, 0.28)`): Fixed-position toast notifications. Conveys: ephemeral, above the panel.
- **Focus ring** (`0 0 0 3px rgba(51, 65, 85, 0.12)`): Input and textarea focus state. Conveys: active keyboard target.

**The Flat-by-Default Rule.** Cards, note items, messages, and folder chips have no ambient shadow at rest. Introducing a hover shadow on note cards or chat messages is prohibited — it introduces choreography into a tool where the user is reading, not browsing.

## 5. Components

### Buttons

Precise and measured: 8px radius, weight-separated labels, no decorative softness.

- **Shape:** Gently curved (8px radius). Not rounded, not sharp.
- **Primary (Ochre):** `{colors.ochre}` fill, white text, 700 weight, 36px min-height, 14px horizontal padding. Transitions to `{colors.ochre-hover}` in 120ms ease-out on hover. White text at all times — do not switch to ink on any ochre variant.
- **Secondary:** White fill, `{colors.border-light}` 1px border, `{colors.muted}` text. Hover: `{colors.hover-bg}` fill, `{colors.border}` border.
- **Ghost:** Transparent fill, no border, `{colors.faint}` text. Hover: `{colors.hover-bg}` fill. Used for cancel/dismiss actions only.
- **Danger:** `#dc2626` fill, white text. Only in destructive confirmation flows. Never as a primary action surface.
- **Focus:** `outline: 2px solid {colors.ochre}; outline-offset: 2px`. All interactive elements.
- **Disabled:** `opacity: 0.55`. Never change color or radius.

### Folder Chips

Pill-shaped navigation tabs in the notes toolbar. The active chip is the only tab affordance that uses ochre.

- **Default:** White fill, `{colors.border-light}` 1px border, `{colors.muted}` text, 30px height, 999px radius.
- **Active:** `{colors.ochre-tint}` fill, `{colors.ochre}` border at 35% opacity, `{colors.ochre}` text.
- **Hover (default):** `{colors.hover-bg}` fill, `{colors.border}` border.
- **New folder button:** Same pill shape (30px × 30px), plus icon centered, ghost treatment.

### Note Cards

Content-first: the card chrome is minimal, the text is the substance.

- **Shape:** 8px radius, white fill, `{colors.border}` 1px border.
- **Internal grid:** 24px reorder strip + content column, 6px gap.
- **Header:** Note title at Body weight 700 (`{colors.ink}`), type label at Micro (`{colors.faint}`), timestamp at Micro.
- **Pinned state:** Full `{colors.link}` 2px solid border on all sides — **not** a left-stripe. Pin state must use a full perimeter border or a background tint, never a left-border stripe.
- **Collapsed:** Content rows hidden; header and action strip remain visible.

### Chat Messages

- **Assistant (Øde):** White fill, `{colors.border}` 1px border, 8px radius, aligned left (max 92% width).
- **User:** `{colors.ochre-tint}` fill, `{colors.ochre}` border at 35% opacity, 8px radius, aligned right.
- **Loading dots:** Three `{colors.faint}` dots, 6px size, `loading-pulse` animation at 1s/0.15s stagger. Show only when `loading && !content`.
- **Error:** `{colors.danger}` text appended below content. Never replace content; append.
- **Save footer:** Appears on completed assistant messages only. Thin `{colors.border}` top separator, ghost-style `{colors.faint}` "Save to notes" label with BookmarkPlus icon. Expands inline to a folder-select row on click.

### Inputs and Textareas

- **Shape:** 8px radius, white fill, `{colors.border-light}` 1px border.
- **Focus:** Border shifts to `{colors.ink}`. Box shadow: `0 0 0 3px rgba(51, 65, 85, 0.12)`.
- **Disabled:** `opacity: 0.50; cursor: not-allowed`. Border unchanged.
- **Placeholder text:** `{colors.faint}` — must reach ≥4.5:1 against white (confirmed).

### Modals

Structural overlays for irreversible or complex confirmations.

- **Overlay:** `rgba(15, 23, 42, 0.45)` — ink-family scrim.
- **Container:** White fill, 12px radius, 18px padding, modal-lift shadow. Max-width 320px.
- **Heading:** Headline role (700, 16px, `{colors.ink}`).
- **Body copy:** Body role (13px, `{colors.muted}`, line-height 1.45).
- **Actions:** Flex row, right-aligned. Primary destructive uses Danger button; dismiss uses Secondary.

**The Modal-Last Rule.** Modals are used only for irreversible multi-step confirmations (project deletion, folder deletion with counts). Single-step confirmations and folder/project creation use inline forms. A modal should never appear for a reversible action.

### Toast

Ephemeral status feedback. Auto-dismisses; never interactive.

- **Style:** `{colors.ink}` fill, `{colors.surface}` text (near-white), 9px radius, 600 weight, 13px.
- **Position:** Fixed, bottom 80px, horizontally centered.
- **Shadow:** Toast-rise shadow.

## 6. Do's and Don'ts

### Do:
- **Do** use ochre exclusively for the single most important interactive signal on any given screen (primary button or active selection — never both at full saturation).
- **Do** keep `{colors.white}` as the card background in every view. Notes, messages, modals, and inputs are always white — never surface-tinted.
- **Do** use tonal separation (`{colors.surface}` panel + `{colors.white}` card) as the primary depth affordance before reaching for a border or shadow.
- **Do** use `focus-visible` focus rings (2px solid ochre, 2px offset) on every interactive element. Never suppress focus rings.
- **Do** put white text on any ochre fill. The hue is warm-saturated; dark ink text reads as muddy against it regardless of WCAG pass.
- **Do** reserve modal dialogs for irreversible multi-step confirmations only. Folder creation, renaming, and single-step deletions use inline patterns.
- **Do** keep transitions at 120–160ms ease-out. State changes only — no entrance choreography, no hover reveals.
- **Do** use `{colors.danger}` (`oklch(0.437 0.148 29)`) for destructive actions with white text. Never tint a button partially red.

### Don't:
- **Don't** use a left-border stripe (border-left > 1px with a brand or status color) as the affordance for pinned notes or any other state indicator. Replace with a full perimeter border, a background tint, or a leading icon.
- **Don't** introduce a cream, sand, parchment, or warm-neutral body background. The warmth lives in the ochre accent; the background is pure white or near-white cool surface. This is the single most distinguishing break from the AI-SaaS register.
- **Don't** add a second typeface. Inter at weight 400/700 is the only typographic vocabulary. A serif display heading, a geometric display font for "personality," or a mono for labels each undermine the system's restraint.
- **Don't** use the dark-sidebar / white-bubble chat layout. This is the ChatGPT/Perplexity register — the primary anti-reference. Øde's chat is a panel-native layout: white cards on a surface-tinted scroll area.
- **Don't** add ambient hover shadows to note cards, message bubbles, or list items. The Flat-by-Default Rule is structural.
- **Don't** use ochre as a text color on a white background for anything other than an active folder chip label. At `oklch(0.51)` lightness it fails 4.5:1 against white (contrast ≈ 3.7:1). Use `{colors.ink}` for body text.
- **Don't** use 600 weight as the sole weight step between body and label. The weight hierarchy is 400 (body) → 700 (label). A 600-only label next to 400 body is insufficiently differentiated.
- **Don't** render ghost/secondary buttons with transparent borders on a white card background — they disappear. Always render the `{colors.border-light}` border on secondary buttons.
- **Don't** use generic SaaS button copy ("OK", "Yes", "Cancel"). Every label is verb + object: "Delete project", "Save note", "Create folder".
