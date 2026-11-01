---
name: field-repo-frontend
description: The definitive SHRIII Behavioural Games frontend reference — tokens, theming, the island nav, the motion vocabulary, every UI primitive (ActionGroup, ProgressBar, PageHeader, states, DataTable, charts), form/screen/data conventions, the kiosk and game-screen rules (physical touch targets, voice-first, no reading, multilingual, child-safe, reduced motion), the card-sort tablet's staff screens, cross-portal parity with Field Repository and Design Workshop, and an index of traps. Load before ANY frontend UI work in this repo — web console, /kiosk, apps/kiosk, kiosk-electron's renderer, card-sort-app or packages/kiosk-game.
---

# SHRIII Behavioural Games — frontend reference

This file is the **contract**, not a summary. It exists so a change can be made correctly without
re-reading twenty components, and every number in it was read off this repo's code. Where a rule looks
odd, the reason follows it.

It is the same skill as the Field Repository (`documentation-portal`) and Design Workshop
(`designer-portal`) copies — same non-negotiables, same design bar, same tokens, same motion and
primitive vocabulary — adapted to this repo's stack and files. Where this product genuinely differs (a
public village-fair kiosk for participants who may not read, plus a supervised card-sort tablet), §20
writes the kiosk rules out instead of forcing data-screen rules onto games.

**The surfaces.**

| Surface | Path | Stack | Who uses it | Rules that apply |
|---|---|---|---|---|
| Research + admin console | `frontend/apps/web` (`/research/*`, `/admin/*`, `/login`, `/`) | Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui on `radix-ui`, TanStack Query/Table, ECharts 6 | researchers, analysts, field administrators, system admins | everything (§1–§19) |
| Kiosk in the browser | `frontend/apps/web/src/app/kiosk/*` | mounts `@shriii/kiosk-game` client-side, no console providers | village participants | §20 + universal rules |
| Kiosk shell | `frontend/apps/kiosk` | Vite + React, the renderer Electron loads | participants | §20 + universal rules |
| Kiosk runtime | `frontend/apps/kiosk-electron` | hardened Electron main (kiosk window, `app://`, CSP, watchdog) | — (no UI of its own) | §20.9 |
| Game library | `frontend/packages/kiosk-game` | Pixi 8 stage + GSAP, XState session, React fallback screens | participants | §20 |
| Card-sort tablet | `frontend/apps/card-sort-app` | Capacitor + Vite + React, plain CSS | trained administrators (staff screens), participants (test stage) | staff screens: universal rules (§21); test stage: §20 |

**Sources of truth, in this order.** `frontend/apps/web/src/app/globals.css` owns the console's visual
language (there is no `tailwind.config.ts`: Tailwind 4 reads `@theme` blocks in the CSS).
`frontend/packages/kiosk-game/src/art/palettes.ts` (`KIOSK_PALETTE`, `MELA`) and `core/contracts.ts`
(`TOUCH_TARGET_MIN_MM`, `TOUCH_SPACING_MIN_MM`) own the kiosk's. `content/i18n/lines.yaml` owns every
word a participant hears. `backend/api/src/shriii_api/auth/rbac.py` owns permissions; the console mirrors
them in `src/lib/auth/permissions.ts` (parity-tested) and never invents one. The sibling portals own the
shared visual language: a token that moves there moves here in the same release (§16).

**How to use it.** Skim §1 always. Then read the section for what you are touching. §17 is an index of
traps — check it before "simplifying" anything that looks redundant. Kiosk or game work: §20 first.

---

## 1. Non-negotiables

1. **Purple-700 `oklch(0.47 0.198 305)` is the only action colour** on the console. A filled button is
   purple-700 with white text in BOTH themes (7.59:1). No second accent on a data screen, ever. There is
   no gold in this product. Chart series colours are data, not actions (§3.6); the kiosk's game palette
   is §20's, not this one.
2. **Never hardcode a neutral.** Every grey goes through the themed ladders (`ink-*`, `line-200`,
   `surface-*`, `bg-0`, `card`) or their shadcn aliases (`foreground`, `muted-foreground`, `border`,
   `background`, `card`, `muted`, `secondary`, `accent`), which flip under `data-theme="dark"`. No
   `gray-*`, `zinc-*`, `bg-white`, `text-black`.
3. **Purple text on a dark ground is `text-accent-foreground`, never `text-primary`.** `--primary` is
   the literal purple-700 in both themes (it fills buttons), and purple-700 on the dark card is 2.32:1.
   `--accent-foreground` is purple-700 light / purple-200 dark (12.86:1).
4. **Reduced motion is honoured at the source.** The console has no JS animation library: every motion
   is CSS (Tailwind transitions, `tw-animate-css` on Radix `data-state`, two keyframes), and the global
   rule in `globals.css` zeroes durations AND delays and stops loops. The kiosk's GSAP motion goes
   through `art/motion.ts` (`motionSettings.timeScale`) and the art kit's `ArtQuality.reducedMotion`.
   Anything that animates outside those two paths must branch on reduced motion itself.
5. **A signal that only exists as motion is a signal reduced-motion readers never get.** Pair every
   pulse with a static state (a ring, a border, a word). The kiosk fallback's attention pulse leaves a
   static cream ring under reduced motion (§20.6).
6. **One way up per page — the breadcrumbs in the shell.** `PageHeader` has no back arrow and you do
   not add one. A wizard's own "Back" step control (administer-page) is a step, not navigation.
7. **Mount app-wide providers once** (`components/providers.tsx`: theme, query cache, auth, tooltips,
   one toaster). A nested copy shadows the real one.
8. **Never invent a z-index.** Pick from the ladder in §6.4.
9. **Statistics carry their honesty on screen.** Every figure shows N, its uncertainty, exclusions and
   provenance (`provenance` prop); thresholds come from the server or YAML as `referenceLines` /
   `salience`, never constants in the UI. The kiosk never shows numbers.
10. **Truncation, caps and skipped work are stated on screen** — in a few words ("Showing the latest
    200."). A list that quietly stops is indistinguishable from an empty one.
11. **One control per job.** A choice from a list is the shadcn `Select`; a setting is a `Checkbox` or
    a `Switch`-shaped control with its label; a segmented choice is a `radiogroup` of pills
    (`ThemeSegmented`, the chart Chart/Table toggle). Never a native `<select>` on the console.
12. **Copy says only what the person needs to act — one short sentence, often a few words, or nothing
    when the label already says it.** No explanations of how the software works, no rationale, no
    hedging, no internal terms (endpoint paths, YAML file names, table names, feature ids like
    `PRV-08`), **no gap admissions** ("needs API", "not built yet", "coming soon"). §19.1.
13. **Every row of buttons goes through `ActionGroup`** (`components/ui/action-group.tsx`). One button is
    centred, two share one line, three or more stack on a phone and become pills from `sm`; a
    destructive action goes last. §19.2.
14. **Kiosk screens need no reading** (§20): no text or numerals a participant must read, touch targets
    ≥ 20 mm with ≥ 8 mm spacing, colour never the only cue, every interactive element has an audio key,
    nothing private is ever spoken through the speakers.

---

## 2. Type

Two **local** variable faces in `frontend/apps/web/src/fonts/` (byte-identical to the sibling portals'
`frontend/fonts/`), loaded by `next/font/local` in `src/app/layout.tsx`. Never load Google-hosted fonts.

| Slot | Variable | Face | File | Weights |
|---|---|---|---|---|
| `font-sans` | `--font-inter` | Inter — body/UI | `inter-latin-var.woff2` | 100–900 |
| `font-display` | `--font-jakarta` | Plus Jakarta Sans — headings | `jakarta-latin-var.woff2` | 200–800 |
| `font-mono` | — | `ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace` | — | — |

- Both `display: "swap"`. The `className` with both variables sits on `<html>`, `font-sans` on `<body>`
  (via `@layer base`). Body keeps `font-feature-settings: "cv11", "ss01"`.
- **Headings are `font-display`:** `.display-title` (page `h1`), `Section` `h2`, `CardTitle`,
  `DialogTitle`, the brand word. Body copy never is.
- **Latin only.** The console is `en-IN`. Devanagari/Tamil fall back to the system stack after Inter.
  The kiosk speaks those languages and prints none of them (§20.4); the card-sort tablet's CSS lists
  `"Noto Sans Devanagari", "Noto Sans Tamil"` for its participant-language labels.
- **ECharts cannot read a CSS variable.** `readChartTokens()` hands it
  `getComputedStyle(document.body).fontFamily` (Inter under next/font's generated name); `LIGHT_TOKENS`
  keeps a system-stack fallback for SSR.
- Breakpoints are stock Tailwind 4: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536.
  Spacing, letter-spacing and z-index are stock. Tables use `tabular-nums` (`table, .tabular`).

---

## 3. Colour

### 3.1 Brand purple — literal OKLCH, hue 305°, **never inverts**

Declared as `--purple-50` … `--purple-950` in `:root`, exposed as `purple-*` utilities by `@theme inline`
(so the stock Tailwind purple is REPLACED — `bg-purple-300` is the brand rung).

| Rung | Value | sRGB | Rung | Value | sRGB |
|---|---|---|---|---|---|
| 50 | `oklch(0.977 0.013 305)` | #f9f5ff | 500 | `oklch(0.648 0.19 305)` | — |
| 100 | `oklch(0.946 0.03 305)` | — | 600 | `oklch(0.56 0.205 305)` | #9148d2 |
| 200 | `oklch(0.9 0.058 305)` | #e7d5fe | **700** | **`oklch(0.47 0.198 305)`** | **#762cb1 ← the action colour** |
| 300 | `oklch(0.828 0.1 305)` | #d6b6fb | 800 | `oklch(0.4 0.18 305)` | #5f1c93 (hover) |
| 400 | `oklch(0.738 0.15 305)` | #c090f5 | 900 | `oklch(0.34 0.15 305)` | — |
| | | | 950 | `oklch(0.255 0.108 305)` | #2f0d4b |

### 3.2 No gold

The sibling portals spend gold on their marketing hero and auth screens. This product has neither; the
landing page `/` and `/login` use the purple brand chip (`grad-brand`) and nothing else. Do not import
gold to "match".

### 3.3 Themed neutrals — `:root` and `[data-theme="dark"]` in `globals.css`

Hex values, not bare `R G B` triples (Tailwind 4 mixes alpha with `color-mix()`, so `bg-card/85` works on
a hex variable). The values are the sibling portals' rung for rung.

| Token | Light | Dark | Utility |
|---|---|---|---|
| `--bg-0` (page canvas) | #f7f6fb | #110f19 | `bg-bg-0`, alias `bg-background` |
| `--card` | #ffffff | #1a1725 | `bg-card` (also `popover`) |
| `--surface-50` | #faf9fd | #201c2d | `bg-surface-50`, alias `bg-muted` |
| `--surface-100` | #f3f1fa | #262135 | `bg-surface-100`, alias `bg-secondary` |
| `--surface-200` | #e9e6f5 | #2e2840 | `bg-surface-200` |
| `--surface-300` | #dcd7ee | #3a3350 | `bg-surface-300` |
| `--line-200` | #e4e2ef | #342e47 | `border-line-200`, alias `border-border`, `border-input` |
| `--ink-900` (headings, body) | #1e1b2e | #f2f0f9 | `text-ink-900`, alias `text-foreground` |
| `--ink-700` | #3a3651 | #d0cbdf | `text-ink-700` |
| `--ink-500` (muted) | #615d7a | #9e98b2 | `text-ink-500`, alias `text-muted-foreground` |
| `--ink-300` | #a7a3bc | #6e6884 | `text-ink-300` (never for text a person must read) |

Unlike the sibling portals, **every `surface-*` rung compiles here** (`bg-surface-100/200/300` are real
utilities; there is no legacy `field-*` scale).

### 3.4 shadcn aliases (all in `:root`, re-pointed in dark where noted)

`background`=bg-0 · `foreground`=ink-900 · `card` · `popover`=card · `primary`=purple-700 (**both
themes**) · `primary-hover`=purple-800 · `primary-foreground`=#fff · `secondary`=surface-100 ·
`muted`=surface-50 · `muted-foreground`=ink-500 · `accent`=purple-50 / **purple-950 dark** ·
`accent-foreground`=purple-700 / **purple-200 dark** · `border`=`input`=line-200 · `ring`=purple-600 /
**purple-400 dark** · `--focus`=purple-700 / **purple-400 dark** (the outline, §5.3).

### 3.5 Status colours — themed, always with an icon and a word

| Token | Light | Dark | Measured |
|---|---|---|---|
| `--success` | #166534 (green-800) | #4ade80 | word on its own `/10` tint over the card ≥ 6:1 / 8.35:1 |
| `--warning` | #92400e (amber-800) | #fbbf24 | 6.08:1 / 8.64:1 |
| `--destructive` | #b91c1c (red-700) | #f87171 | 6.5:1 on white / 6.36:1 on the dark card |
| `--info` | purple-700 | purple-300 | 6.46:1 / 8.16:1 |
| `--status-serious` | #9a3412 (orange-800) | #fb923c | ≥ 6:1 / 6.65:1 |

The light rungs are one step darker than the sibling portals' (`success-600`, `error-600`): those read
4.38:1 and 4.15:1 as an xs badge word on their own 10% tint, which axe fails (§18). `StatusBadge`
(`components/data/status-badge.tsx`) maps lifecycle words to tones and always renders icon + word;
unknown words read neutral. **`info` is purple on purpose** — a blue info tone was a second accent on
every data screen.

### 3.6 Chart tokens — data, not actions

`--chart-surface/-ink/-ink-secondary/-ink-muted/-grid/-axis` follow the ladders (card, ink-900, ink-700,
ink-500, line-200, surface-300). The **categorical** `--series-1…8`, **diverging** and **sequential**
palettes keep the validated data-viz values (series-1 #2a78d6 … series-8 #e34948; dark twins in
`[data-theme="dark"]`). Order is the colour-vision-deficiency safety mechanism: never reorder, never
cycle; scatter-type charts cap at 3 identity colours (`SCATTER_SERIES_CAP`) and fold the rest into
"Other". `--status-good/-warning/-critical` are chart marks only, never text. `readChartTokens()` reads
them at runtime; a chart variable must resolve to hex/rgb — **ECharts does not parse `oklch()`**, so no
chart token may reference `--purple-*`.

### 3.7 Two traps that bite every new component

- **`ring-*` without a colour** is Tailwind 4's `currentColor`. Name it: `ring-ring/15`.
- **`border` alone** is fine here (the base layer sets `* { border-color: var(--border) }`), but a
  `border-transparent` sibling rule will win; write `border border-border` when in doubt.

---

## 4. Radius, shadow, easing, gradients

**Radius (`@theme`, overrides stock):** `rounded-sm` 8px · `rounded-md` 12px · `rounded-lg` 16px ·
`rounded-xl` 24px. **Not** overridden: `rounded` 4px, `rounded-xs` 2px, `rounded-2xl` 16px (= `lg`),
`rounded-3xl` 24px, `rounded-full`. Buttons, inputs, selects, menus: `md`. Cards, panels, dialogs: `lg`.
The nav sheet: `xl`. Pills (island, bottom island, nav items, 3+ action rows): `full`.

**Shadows — purple-tinted `rgba(46,16,101,…)`:**

| Utility | Value |
|---|---|
| `shadow-xs` / `shadow-sm` | `0 1px 2px rgba(46,16,101,0.06)` |
| `shadow-md` | `0 4px 16px rgba(46,16,101,0.08)` |
| `shadow-lg` | `0 8px 32px rgba(46,16,101,0.12)` |
| `shadow-island` | `0 4px 16px rgba(46,16,101,0.12), 0 1px 2px rgba(46,16,101,0.06)` |
| `shadow-cta` | `0 8px 24px oklch(0.47 0.198 305 / 0.28)` (primary button hover) |

`shadow-xl`, `shadow-2xl`, `shadow-inner` are stock black — do not use them.

**Easing (`@theme`).** `ease-out` IS the brand expo curve `cubic-bezier(0.16, 1, 0.3, 1)`;
`ease-spring` = `cubic-bezier(0.34, 1.56, 0.64, 1)`. ⚠ The keyword `ease-out` inside handwritten CSS is
the spec curve — write `var(--ease-out)` there (`.console-main`, `.progress-fill` do).

**Gradients — one.** `.grad-brand` = `linear-gradient(135deg, purple-700, purple-900)`: the brand chip
in the island, the top bar, `/` and `/login`. Nothing else.

**Keyframes — two.** `console-main-in` (§6.2) and `tw-animate-css`'s `animate-in/out` family that Radix
`data-state` drives (fade, zoom-95, slide-in-from-top-2). Add a new one beside `console-main-in`.

---

## 5. Theming and accessibility modes

### 5.1 Theme

`next-themes` in `components/providers.tsx`: `attribute="data-theme"`, `defaultTheme="system"`,
`enableSystem`, `disableTransitionOnChange`. It writes `data-theme="light" | "dark"` on `<html>` before
hydration (hence `suppressHydrationWarning` on `<html>` — removing it floods the console).

- `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` — **`class="dark"` does
  nothing.** `dark:` is an exception mechanism, not the theming mechanism: a token already flips.
- The choice lives in the island's `ThemeToggle` (desktop) and the menu sheet's `ThemeSegmented`
  (every width): Light · Dark · System.
- `THEME_COLOR = { light: '#f7f6fb', dark: '#110f19' }` (`src/lib/theme.ts`) feeds the viewport
  `themeColor` pair. **Kept in step with `--bg-0` by hand.** (Next.js refuses extra exports from a
  layout file — that is why it lives in `lib/`.)
- The toaster follows `resolvedTheme` (`ConsoleToaster`).
- Charts re-read their tokens when `resolvedTheme` changes (`useChartTokens`).
- `/kiosk` renders outside `Providers`: no `data-theme`, literal kiosk colours, `color-scheme: light`.
  The kiosk is light only, on purpose (§20).

### 5.2 Reduced motion

One block in `@layer base`:

```css
@media (prefers-reduced-motion: reduce) {
  *:not([data-motion="essential"]), *::before, *::after {
    animation-duration: 0.01ms !important; animation-delay: 0ms !important;
    animation-iteration-count: 1 !important; transition-duration: 0.01ms !important;
    transition-delay: 0ms !important; scroll-behavior: auto !important;
  }
}
```

- **Zeroing the delays is load-bearing:** a zero-length transition that still honours its delay is a
  staggered pop, not "no motion".
- **`data-motion="essential"` exempts information, never decoration.** Today exactly one element: the
  kiosk walkaway countdown ring (time left before the session ends) — the root layout's CSS reaches
  `/kiosk` too, and without the exemption the ring would jump to empty and tell a participant they had
  no time left.
- There is no in-app reduced-motion toggle and no high-contrast / larger-text mode on this console (the
  sibling portals have them through `/preferences/me`; this API has no preferences endpoint). Do not
  add `data-reduced-motion` selectors that nothing writes.

### 5.3 Focus

`:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` in `@layer base` —
purple-700 on light (7.06:1 on the canvas), **purple-400 on dark** (7.73:1; purple-700 would be
2.3:1). It is the keyboard's mark on every control.

- **No component removes it.** `Button` carries no `outline-none` and no focus ring of its own; the
  shadcn originals did (`outline-none focus-visible:ring-[3px]`), and an `outline-none` utility beats
  the base layer. Inputs, selects and textareas add their own decoration on top
  (`focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15`) — their recipe, not the
  keyboard's mark; do not conflate them.
- The outline is drawn **outside** the border box: a card holding a full-bleed button must not be
  `overflow-hidden`.
- `<main id="main" tabIndex={-1}>` is the skip link's target and carries `outline-none` (a programmatic
  focus target, not a control).

### 5.4 Scrollbars

10px; track `--bg-0`; thumb `--line-200` with a 2px `--bg-0` border, `border-radius: 9999px`; hover
purple-300. Firefox fallback is guarded by `@supports not selector(::-webkit-scrollbar)` — an unguarded
`scrollbar-color` disables the styled `::-webkit-scrollbar` in Chromium.

---

## 6. Layout, the page frame, and the z-index ladder

### 6.1 Provider order

```
app/layout.tsx              (server) html.{inter,jakarta}[lang=en-IN][suppressHydrationWarning] > body
app/(app)/layout.tsx        Providers: ThemeProvider > QueryClientProvider > AuthProvider > TooltipProvider
                                       > { children, ConsoleToaster }
app/(app)/(console)/layout  StudyScopeProvider > AppShell > ConsoleGuard > page
app/kiosk/layout.tsx        a fixed full-bleed div (no providers, no shell)
```

Signed-out pages (`/`, `/login`, `/no-access`, `/auth/callback`) are inside `Providers` but outside
`AppShell`.

### 6.2 `AppShell` (`components/shell/app-shell.tsx`)

`div.min-h-dvh.bg-background` → skip link → `<IslandNav />` →

```tsx
<main id="main" tabIndex={-1} key={pathname}
  className="console-main mx-auto w-full max-w-7xl px-4 pt-[calc(3.5rem+1.25rem)]
             pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:pt-24 lg:pb-12">
  <DemoBanner /> <PasswordChangeBanner /> <Breadcrumbs /> {children}
```

- **`lg:pt-24` (96px) is the island clearance contract**; below `lg` the top padding clears the 56px top
  bar plus 20px, and the bottom padding clears the bottom island (≈64px + 12px offset + the safe area).
  Never add your own top or bottom padding for the nav.
- `key={pathname}` replays `.console-main`'s 6px-rise fade (`0.22s var(--ease-out) backwards`) on every
  navigation. **`backwards`, never `both`:** a transform left filled on `<main>` would make it the
  containing block of every `position: fixed` child (the administer overlay, any fixed toolbar).
- Banners are rounded `warning/10` panels at the top of `<main>` (`mb-4`), not full-bleed bars.
- Breadcrumbs render only with two or more crumbs (`lib/nav.ts` `breadcrumbs()`), chevron separators,
  `aria-current="page"` on the last.

### 6.3 `PageHeader` / `Section` (`components/data/page-header.tsx`)

```tsx
<PageHeader title="…" description="…" meta={…} actions={<>…</>} />
```

- Root `flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between`.
- **Icon chip** `mt-1 grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground`,
  derived from the owning nav item (`navItemFor(pathname)`) so it never disagrees with the menu;
  `icon={null}` draws none, `icon={<X/>}` overrides.
- Title `display-title break-words text-3xl md:text-4xl` (an `h1`; tests find pages by it).
- Description `mt-2 max-w-3xl text-sm leading-6 text-muted-foreground` — one short sentence (§19.1).
- `actions` go through `ActionGroup align="end"` (`max-sm:w-full`). Do not wrap them yourself.
- `Section`: `h2 font-display text-lg font-semibold tracking-tight`, optional one-line description,
  `actions` through `ActionGroup`. Pages compose `space-y-6` stacks of `PageHeader` → `Section`s.

### 6.4 The z-index ladder — pick from it, never invent

| z | What |
|---|---|
| 0–10 | in-flow; sticky table heads (`chart-frame`'s table `sticky top-0`) |
| 40 | the island (desktop), the phone top bar, the bottom island |
| 50 | every Radix portal: dialogs, the nav sheet and its scrim, sheets, dropdowns, selects, tooltips; the administer full-screen overlay |
| 60 | skip link (focused) |
| sonner | the toaster's own stacking (above everything); `offset` keeps it clear of the bottom island |

Radix portals all sit at 50 and stack by DOM order (the newest portal is last in `<body>`), which is why
a dropdown opened from the island (40) or from a dialog (50) always lands on top. The sibling portals'
"scrim below the island so its X stays lit" does not apply: here the sheet is a modal Radix dialog with
its own close button, and the island beneath it is dimmed.

---

## 7. The island navigation

`components/shell/island-nav.tsx` + `components/shell/nav-sheet.tsx`, fed by `src/lib/nav.ts`.

### 7.1 The frame (from `lg`)

```tsx
<div className="nav-island-frame fixed inset-x-0 top-3 z-40 hidden justify-center px-4 lg:flex">
  <header data-testid="island-nav" data-compact={…}
    className="flex max-w-full items-center gap-1 rounded-full border border-border bg-card/85
               shadow-island backdrop-blur-xl transition-[padding] duration-200 ease-out
               {compact ? 'px-3 py-1.5' : 'px-4 py-2'}">
    Brand · divider · <nav aria-label="Sections"> pinned links + one dropdown per section </nav>
    · divider · StudySwitcher · ThemeToggle · UserMenu · Menu button
```

`.nav-island-frame` is `pointer-events: none` with its children back to `auto`, so the empty space beside
the pill never eats a page click. The brand (`grad-brand` chip + "SHRIII" + "Behavioural Games") links
to `/research`; compact drops the second line.

### 7.2 Collapse/expand — exact thresholds (`useCompactOnScroll`)

```ts
if (latest < 24) setCompact(false);              // always expanded in the top 24px
else if (latest > previous + 2) setCompact(true);    // compact travelling down
else if (latest < previous - 2) setCompact(false);   // expand on ANY upward scroll
```

The ±2px band is the only hysteresis. A passive `scroll` listener, no animation library: the padding
change is a 200ms `ease-out` transition (zeroed by reduced motion).

### 7.3 `RESEARCH_NAV` / `ADMIN_NAV` — the single registry

`NAV_SECTIONS = [Research, Admin]` fixes render order. Each entry:
`{ href, label, description, icon, section, requires, pinned? }`. `requires` is a `Requirement`
(`{ all: [...] }` / `{ any: [...] }`) over `rbac.py` permissions. **`pinned: true` puts an entry on the
bar as a standalone link** (Overview — the place everyone starts); every other entry lives in its
section's dropdown.

**Add a destination by appending ONE object.** That one row feeds the island dropdown, the menu sheet,
the bottom island, breadcrumbs, the page-header icon chip, the route guard (`routeRequirement`) and the
role-navigation test (`e2e/shell.spec.ts` `EXPECTED_NAV`). Never add JSX to the bar. Deeper routes that
need more than their owner use `ROUTE_OVERRIDES`; unlisted signed-in routes use `EXTRA_ROUTES`. The
`description` is one short line — it is printed in the dropdown and the sheet.

### 7.4 Permission gating

`visibleNav(principal)` filters each section by `satisfies(principal, item.requires)` and drops empty
sections. A failing entry is **not rendered**, never rendered disabled. Both renderers and the bottom
island read the same `visibleNav` result, so a hidden entry cannot reappear anywhere. Field
administrators never see score-bearing pages (PRV-08) — that is `rbac.py`'s matrix, mirrored, not a UI
rule.

### 7.5 Section dropdowns — keyboard first

Each section is a Radix `DropdownMenu` (`modal={false}`) whose trigger is a real button (`aria-expanded`,
arrow keys, Escape, typeahead come with it — the sibling portals' hover-only dropdowns are **not**
copied). Items are `DropdownMenuItem asChild` → `Link` with an icon chip (`bg-accent` / `bg-primary`
when current), the label and the one-line description; `w-[22rem]`, `sideOffset 10`. The trigger of the
section holding the current page wears the active pill (`bg-accent text-accent-foreground`,
`data-active="true"`).

### 7.6 The menu sheet — every destination, the keyboard route

`NavSheet` is a Radix `Dialog`: focus trap, Escape, scroll lock (with scrollbar-gutter compensation) and
focus return to whichever button opened it come from Radix — do not hand-roll them.

- Content `nav-sheet fixed inset-x-0 top-0 z-50 mx-auto w-[min(680px,92vw)] rounded-xl`; the
  `.nav-sheet` recipe drops it `5rem` from the top (`4.25rem` and tighter padding under
  `max-height: 560px`) and caps it with **`max-height` twice — `100vh` then `100dvh`**: progressive
  enhancement, not a duplicate (with `vh` alone the last rows sit under a phone's address bar; biome's
  duplicate-property rule is suppressed with that reason).
- Scrim: `bg-ink-900/20 backdrop-blur-xs`. Enter: fade + `slide-in-from-top-2`, 200ms `ease-out`.
- Body: `<nav aria-label="Console">`, one block per section (`eyebrow` heading, `grid sm:grid-cols-2`),
  rows `min-h-12` with icon chip + label + truncated description, `aria-current="page"` and
  `data-testid="nav-<path-with-dashes>"`. Then a footer: **Open kiosk** (new tab) and `ThemeSegmented`.
- A navigation closes it by adjusting state during render (`sheetPath !== pathname`), not in an
  effect, so the closed sheet and the new page arrive in one paint. Focus is not stolen on that close.

### 7.7 Active route — longest base wins

`navItemFor(pathname)` returns the entry with the longest matching `href` (`/research` itself matches
exactly only). Every renderer compares `item.href === activeHref`; never `startsWith(href)` — two
`aria-current="page"` links tell a screen reader the reader is in two places. `shell.spec.ts` asserts
exactly one.

### 7.8 Below `lg` — the top bar and the bottom island

**CSS decides, nothing reads `window.innerWidth`** — server and first client render agree.

- **Top bar:** `fixed inset-x-0 top-0 z-40 h-14 border-b bg-card/85 backdrop-blur-xl lg:hidden` — brand
  (compact), `StudySwitcher compact` (`max-w-40`), `UserMenu testId="user-menu-mobile"`.
- **Bottom island:** `nav-island-frame fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))]
  z-40 lg:hidden` → `nav[aria-label="Quick links"]` pill with up to **`ISLAND_MAX_SLOTS` = 4**
  destinations (`islandSlots()`: the first four the principal may open, registry order), a divider, and
  **More** (opens the sheet). Slots are `min-h-12 min-w-14` icon-over-label (`text-[11px]`, label
  `max-w-16 truncate`), active = accent pill + `aria-current`.
- It never hides on scroll. It holds nothing the sheet does not.
- The account menu is mounted twice (island and top bar), so each copy takes its own `testId`;
  `getByTestId('user-menu')` is the desktop one.

---

## 8. The motion vocabulary

### 8.1 Console — CSS only

There is no framer-motion/Motion and no GSAP in `apps/web`. That is deliberate: Radix exposes
`data-state` and `tw-animate-css` animates it, and the reduced-motion rule (§5.2) then covers every
motion in the app without a JS branch. **Adding a JS animation library to the console needs a reason
this table cannot meet, and must branch on reduced motion at the source.**

| Motion | Value | Where |
|---|---|---|
| page arrival | 6px rise + fade, `0.22s var(--ease-out) backwards` | `.console-main` |
| island compact | `transition-[padding] duration-200 ease-out` | island pill |
| colour/hover | `transition-[color,background-color,border-color,box-shadow] duration-200 ease-out` | `Button`, nav items, inputs |
| dialog | fade + zoom-95, `duration-200 ease-out` | `DialogContent` |
| sheet | fade + slide-from-top-2, `duration-200 ease-out` | `NavSheet` |
| menus/selects/tooltips | fade (+ zoom where shadcn had it) | Radix `data-state` |
| progress | `width 0.22s var(--ease-out)` | `.progress-fill` |
| skeleton | `animate-pulse` | `Skeleton` (stopped by reduced motion; the box itself is the static state) |

The sibling portals' springs (island 260/30, popover 520/38/0.6, toast 420/34/0.7) are framer-motion
numbers; their CSS equivalent here is `ease-out` (expo) for arrivals and `ease-spring` for the rare
overshoot. Do not invent a third curve.

### 8.2 Kiosk — GSAP through `art/motion.ts`

`tweenTo`, `playTimeline`, `wait`, `killTweens`, `killTweensDeep`. Every tween promise **resolves (never
hangs)** when its target is destroyed or the motion is skipped, so scene scripts can `await` them.
`motionSettings.timeScale` (0 = instant; tests and reduced-motion transitions) multiplies durations and
delays; `motionSettings.reducedMotion` is set by the art kit from `ArtQuality`. Use these helpers —
a raw `gsap.to` outside them escapes both switches. Stimulus durations are milliseconds and never scale
(KSK-14: degrade mode recomputes frames, keeps milliseconds).

### 8.3 Reduced motion on the kiosk

`ArtQuality.reducedMotion` → `qualityProfile()`: particles × 0.25, idle motion amplitude 0.15, no birds,
no camera moves, crossfades instead of wipes. It is a **deployment setting** passed to `createArtKit`
(the CI timing build forces it on with the `low` tier), not read from the OS, because presentation must
be identical for every player at a site. The React fallback screens (DOM) honour the OS media query
(§20.6).

---

## 9. (kept free — the sibling portals' guided walkthrough has no counterpart here)

## 10. (kept free — the sibling portals' dot→card reveal has no counterpart here)

---

## 11. UI primitives (`components/ui/*`, `components/data/*`, `components/charts/*`)

### 11.1 Recipe classes (`@layer components` in `globals.css`)

| Class | Renders |
|---|---|
| `.panel` | `radius-lg`, `1px var(--border)`, `var(--card)`, `shadow-sm` |
| `.display-title` | `font-display`, 700, `-0.025em`, `var(--foreground)` |
| `.eyebrow` | `0.8125rem`, 600, uppercase, `0.14em`, `var(--accent-foreground)` |
| `.section-band` | `radius-lg`, `var(--surface-50)` |
| `.grad-brand` | §4 |
| `.nav-island-frame` / `.nav-sheet` | §7 |
| `.progress-track` / `.progress-fill` | §11.5 |
| `.console-main` | §6.2 |

Recipes are plain CSS in `@layer components`, so **every utility beats every recipe**
(`className="panel p-6"` works). `cn()` is `twMerge(clsx(...))` — here, unlike the sibling portals,
later utilities DO win over earlier conflicting ones.

⚠ **Tailwind 4 scans source text.** Write complete literal class strings; `bg-${tone}-100` emits no
CSS and fails silently. `ActionGroup`'s alignment maps are written out for exactly this reason.
⚠ Tailwind 4's `hover:` applies only under `@media (hover: hover)`: anything revealed only on hover
must be reachable another way on a phone.
⚠ A vendor-prefixed declaration goes BEFORE its standard form in `globals.css` (Lightning CSS keeps only
the last).

### 11.2 The shadcn primitives, as restyled

| Primitive | What changed from stock shadcn (and why) |
|---|---|
| `Button` | variants: `default` purple-700 + `hover:bg-primary-hover hover:shadow-cta`, disabled `bg-line-200 text-ink-500`; `outline` (the secondary) `bg-card hover:border-purple-300 hover:bg-accent`; **`destructive` is OUTLINED red** (`border-destructive/40 bg-card text-destructive`) and carries `data-danger`; `ghost`; `link` in `text-accent-foreground`. Sizes `default h-10` · `sm h-9` · `lg h-11` · `icon size-10` · `icon-sm size-9`. **No `outline-none`, no focus ring** (§5.3). |
| `Input` / `Textarea` / `SelectTrigger` | `h-10` (`sm` `h-9`), `px-3.5`, `rounded-md`, `border-input`, `focus-visible:border-ring ring-4 ring-ring/15`, placeholder `text-muted-foreground` (ink-500, legible — the sibling portals' ink-300 placeholder is 2.4:1). |
| `Checkbox` | checked = `bg-primary`; focus via the global outline. |
| `Tabs` | list `h-10 rounded-md bg-secondary p-1`, `overflow-x-auto justify-start` (never clips its first tab on a phone); active trigger `bg-card text-accent-foreground shadow-sm`. |
| `Card` | `rounded-lg border-border bg-card shadow-sm`; `CardTitle` in `font-display`. |
| `Dialog` | scrim `bg-ink-900/30 backdrop-blur-xs`; content `rounded-lg`, `max-h-[calc(100dvh-2rem)] overflow-y-auto`; header left-aligned with room for the X; close = round `size-9` icon button; **`DialogFooter` IS an `ActionGroup align="end"`** (Cancel first, the action last, danger last). |
| `Sheet` | same scrim and close button as `Dialog`. |
| `Table` | head `h-10 uppercase tracking-wide text-xs text-muted-foreground`; row hover `bg-surface-50`, selected `bg-accent`. |
| `Skeleton` | `bg-surface-100 animate-pulse`. |
| `Badge` | `success`/`warning`/`info` = `border-X/30 bg-X/10 text-X`. |

### 11.3 `ActionGroup` — the one layout for buttons that sit together (§19.2)

`components/ui/action-group.tsx`, pinned by `action-group.test.tsx` (vitest) and
`e2e/visual.spec.ts` "button rows" (real layout, phone and `sm`).

- **The layout is decided by CSS from the RENDERED children**, not by counting React elements:
  `max-sm:has-[>:nth-child(2):last-child]:grid-cols-2` (exactly two), `max-sm:has-[>:nth-child(3)]:flex-col`
  (three or more), `sm:has-[>:nth-child(3)]:[&>*]:rounded-full` (pills). A `<Can>` that renders nothing
  leaves no DOM child, so two permission-gated buttons where the reader holds one permission lay out
  as one centred button — never half a line. `empty:hidden` drops the gap of an all-gated row.
- Direct children are flattened through fragments and reordered so destructive ones (`variant=
  "destructive"` or `data-danger`) come last; CSS `[&>[data-danger]]:order-last` and `sm:ml-2` cover a
  destructive button nested one level down.
- Props: `align` (`start` · `center` · `end`, default `end`) places two or more from `sm`; a lone
  button stays centred. `inline` (table cells, list rows): every count follows `align`, so a column of
  row actions lines up. `fill`: a lone button spans the line (a pinned form primary).
- Two on a phone: equal halves, `h-auto min-h-10 whitespace-normal min-w-0` so a long label wraps
  inside its button, never past it.
- **Not** for toolbars, filters, selects, segmented controls or pagers — those are plain
  `flex flex-wrap gap-2` rows with a one-line comment ("a pager, not an action row").

### 11.4 Display components

- **`StatusBadge`** — icon + word, tone from `toneFor(status)` (`STATUS_WORDS`). Add a status word to
  the map or it reads neutral.
- **`EmptyState`** — dashed `bg-card` panel, `bg-accent` icon chip, a short title, at most one line, and
  the control that takes the next step (`action`). Not an `h2` — safe inside any section.
- **`ErrorState`** — `role="alert"`, the API's message (`errorMessage`), the request id in mono for
  support, "Try again" when retryable. Titles: "No access" / "Couldn’t load this".
- **`LoadingState`** — `role="status" aria-live="polite"` skeleton rows; `QueryState` switches loading →
  error → empty → content for a TanStack query.
- **`StatTile`** (admin), KPI tiles (research overview) — counts only.
- **`AuditStamp` / `TimeStamp` / `CopyId`** — every record shows who and when.
- **`DataTable`** (TanStack Table v9) — toolbar and pager are toolbars, not action rows; row actions go
  through `ActionGroup inline`.
- **`ExportMenu`** — CSV (RFC 4180, BOM, formula-injection safe) and Parquet; asks for a justification
  above `NEXT_PUBLIC_EXPORT_JUSTIFICATION_ROWS` (default 50) and reports an `ExportRecord` to the
  `ExportAuditSink`.
- **Charts** (`components/charts/*`): `ChartFrame` = title, description, provenance, synthetic badge,
  and a Chart/Table **segmented toggle** (`fieldset aria-label="View"`, `aria-pressed` pills in the
  accent style) — every chart has its table twin, which is the accessible route to the numbers.

### 11.5 `ProgressBar` — one look, from one source

`components/ui/progress-bar.tsx` → `.progress-track` / `.progress-fill`. Every bar, meter and quota
indicator draws through it.

- **Track: a tint, never the card's own white** — `--progress-track` #d9c4e9 light (1.61:1 on the
  card) / #4c3b63 dark (1.77:1).
- **Fill ≥ 3:1 against the track AND the card, both themes** — purple-700 light (4.71 / 7.59),
  **purple-400 dark** (4.05 / 7.16). `bg-primary` on the dark card is 2.32:1.
- At least 4px, round ends (`h-1.5`, `min-height: 4px`; pass `h-2`/`h-3` via `className`).
- `role="progressbar"` with `aria-valuemin/max/now` and a `label`; `decorative` when a number beside it
  already says it (`aria-hidden`).
- **Never hand-roll `rounded-full bg-muted` + `bg-primary`** — that pair is 1.1:1 on the card and the
  bar disappears. A multi-segment stacked bar (content coverage) keeps its own segments but sits on
  `bg-progress-track`.

### 11.6 Toasts

`sonner`, mounted once (`ConsoleToaster`), `position="bottom-right"`, `closeButton`, theme from
next-themes, `font-sans`. **Toasts are for transient notices nobody must act on** (saved, queued,
copied). An error a person must fix belongs next to the control or above the buttons (§12.3).
`useAdminMutation` toasts success and the API's error message.

---

## 12. Forms and record editing

### 12.1 Shape

shadcn `Label` + `Input` / `Textarea` / `Select` / `Checkbox`, `react` controlled state, grouped in a
`grid gap-4` (two columns from `md` where fields are short). The submit row is a `DialogFooter` or an
`ActionGroup` — Cancel first, the action last, `disabled` + a present-participle label while pending
("Saving…", "Recording…").

### 12.2 Dialogs

`components/ui/dialog.tsx` is the one modal primitive (`FormDialog` in research and `ApprovalDialog` in
admin are built on it).

- Title: a verb phrase ("Register kiosk", "Approve version"). Description: one line or none.
- Danger confirms: `variant="destructive"` on the confirming button, the consequence in the description
  in one sentence ("Its token stops working at once."), initial focus on Cancel where a reflex Enter
  would destroy something.
- Two-person approval (`ApprovalDialog` + `checkApprovers`): two distinct named approvers, refusal text
  from `two-person.ts` ("Each approver must be a different person.").

### 12.3 Error surfacing — four treatments, chosen by meaning

1. **Field-level** — the message under the field, `text-sm text-destructive`, `aria-invalid` on the
   control (inputs paint `aria-invalid:border-destructive`).
2. **Above the buttons** in a long form or dialog — `role="alert"`, so a refusal is next to the button
   that caused it, not scrolled off the top.
3. **Page-level** — `Alert variant="destructive"` under `PageHeader`.
4. **Toast** — only for transient notices.

`errorMessage(err)` (`lib/api/errors.ts`) turns `ApiError` details (including FastAPI's 422 list) into
one readable line; never print `String(detail)`.

---

## 13. Screen patterns

**Page frame:** `PageHeader` → banners/alerts → `Section`s of `Card`s, tables and charts → nothing
below. A list screen is a `Card` holding a `DataTable` (or `Table`) with `StatusBadge`s and inline row
actions. A detail screen is `PageHeader` (record title) + `Tabs` (`?tab=` in the URL via
`url-state.ts`).

- **Study focus** comes from `useStudyScope()` (the island's `StudySwitcher`); only studies in the
  principal's scope can be selected; "All studies in scope" is the null choice.
- **Statistics screens** (validation workbench, models, analytics, reports) read one frozen snapshot
  (`SnapshotBar`); every figure carries N, CI, exclusions and provenance; "Exploratory" vs
  confirmatory is stated in a word, not a paragraph.
- **Score-bearing pages are never shown to field administrators** — the nav and guard hide them; the
  API refuses them anyway.
- **The kiosk never shows numbers;** the console never shows a participant's identity (pseudonymous ids
  only; identity lives in a separate vault).
- **No gap admissions.** A capability the API does not offer yet is simply absent from the screen (or
  replaced by the working alternative as a short line or a button — "To save, commit the downloaded file
  and run Sync."). `features/admin/shared/missing-endpoints.ts` is the developer-facing backlog of those
  endpoints; `shared.test.ts` fails when one appears in `openapi.json`, which is the cue to build the
  screen for it. It is never rendered.

---

## 14. Data, auth and permission plumbing

- **`useApi()`** (auth context) → an `openapi-fetch` client typed from `src/generated/api-schema.ts`
  (`pnpm --filter web api:generate`; `api:check` fails on drift). Read with TanStack Query:
  `useQuery({ queryKey, queryFn: () => unwrap(api.GET('/api/v1/…', { params })) })`.
- The browser only talks to its own origin: `next.config.ts` rewrites `/api/v1/*`, `/healthz`,
  `/readyz` to `API_PROXY_TARGET` (or the in-app demo API when `NEXT_PUBLIC_DEMO_MODE`).
- **Auth modes** (`NEXT_PUBLIC_AUTH_MODE`): `dev` (signed dev JWT; the e2e mock signs in through the
  "Development sign-in" form), `local` (password; five failed attempts lock 15 minutes; 8-hour
  sessions; initial passwords force `/account/password`), `oidc` (PKCE). Demo mode signs in by role
  with no backend and refuses writes with `DEMO_READ_ONLY_MESSAGE`.
- **Permissions:** `<Can all|any={[...]} study={id} fallback?>` hides; `RequirePermission` guards a
  block; `ConsoleGuard` guards the route from `lib/nav.ts`. The forbidden panel keeps
  `data-testid="forbidden"`. The `Can` fallback says "Your role doesn’t include this." — never a
  permission key.
- **Audit:** `<AuditStamp record={row} />` understands `created_by`, `recorded_by`, `linked_by`,
  `approved_by`, `updated_*`.

---

## 15. The landing page `/` and sign-in

- `/`: brand row (`grad-brand` chip + SHRIII), an `eyebrow`, a `display-title` h1, one short line, then
  three cards (Kiosk game · Research console · Admin console) — icon chip, one line, **one** primary
  button per card (`ActionGroup fill`). No paragraph explaining the science.
- `/login`: one centred `Card` on `bg-background` — brand chip, title "Sign in", the mode's form, one
  primary button. Notes are one line each (staff lockout facts, demo "Nothing leaves your browser",
  dev "Local development only"). Caps-lock hint in `text-warning`.
- `global-error.tsx` renders its own document with literal tokens (`#f7f6fb`, `#1e1b2e`, `#615d7a`, a
  purple-700 button) because the root layout and its CSS are gone at that point.

---

## 16. Cross-portal parity (Field Repository, Design Workshop)

The three products will converge. Shared values are copied rung for rung; a change to one is a change
to all three in the same release.

| Shared exactly | Differs here, on purpose |
|---|---|
| purple ramp (hue 305, all eleven rungs), purple-700 as the only action colour | no gold, no ministry/group tones (no such surfaces) |
| bg-0 / card / surface / line / ink ladders, light and dark | hex variables + `data-theme` via next-themes (they: `R G B` triples + a boot script) |
| radius sm 8 · md 12 · lg 16 · xl 24; purple-tinted shadows incl. `island`, `cta` | status light rungs one step darker (axe, §3.5) |
| `ease-out` = expo `0.16,1,0.3,1`, `ease-spring` | CSS motion only; no framer-motion springs (§8.1) |
| Inter + Plus Jakarta Sans, local | placeholder ink-500 instead of ink-300 |
| focus = one purple outline, offset 2 | purple-400 outline in dark (purple-700 is 2.3:1 there) |
| island nav: thresholds 24 / ±2, sheet 5rem/4.25rem, vh+dvh cap, longest-base active | section dropdowns are Radix (keyboard), not hover-only; sheet is a modal Radix dialog |
| bottom island below `lg`, "More" opens the sheet | 4 destination slots + More (they: 5 slots with More as the fifth); no search header |
| `ActionGroup` rules (1 centred / 2 one line / 3+ stacked→pills, danger last) | layout from rendered children via CSS `:has()` (they count React children) |
| `ProgressBar` tokens (#d9c4e9 / #4c3b63 track, purple-700 / purple-400 fill) | — |
| concise copy, no gap admissions | — |

There is no Android client for this product; "words from Android" (the siblings' rule 3) becomes
"words from the content catalogue" on the kiosk (§20.4) and "words from the nav registry" on the
console.

---

## 17. Trap index — check before you "simplify"

**Tokens & CSS**
- `--primary` is purple-700 in BOTH themes; purple text on dark is `text-accent-foreground`.
- `class="dark"` does nothing; the theme is `data-theme` on `<html>`.
- The stock Tailwind `purple-*` is replaced by the brand ramp.
- `rounded-2xl` == `rounded-lg` (16px); `rounded` is 4px.
- `ease-out` the class is the expo curve; `ease-out` in handwritten CSS is the spec curve.
- `.nav-sheet`'s doubled `max-height` (vh then dvh) is progressive enhancement.
- `.console-main` fills `backwards`, never `both` (a filled transform captures fixed children).
- The reduced-motion rule zeroes delays on purpose; `data-motion="essential"` is for information only.
- Chart tokens must resolve to hex/rgb: ECharts does not parse `oklch()`.
- Next.js rejects non-standard exports from `layout.tsx` (`THEME_COLOR` lives in `lib/theme.ts`).
- Status light rungs are darker than the siblings' on purpose (4.5:1 on their own tint).

**Primitives**
- `Button` has no focus ring and no `outline-none` — the global outline is the mark. Do not add one back.
- `DialogFooter` is an `ActionGroup`; do not wrap it in another.
- `ActionGroup` counts RENDERED children (CSS `:has()`), so permission-gated rows lay out correctly.
- `destructive` buttons are outlined, not filled, and always end up last.
- `PageHeader` and `Section` already route `actions` through `ActionGroup`.
- `ProgressBar` exists because `bg-muted` + `bg-primary` is invisible on the card.
- The account menu is mounted twice: `user-menu` (island) and `user-menu-mobile` (top bar).

**Nav**
- Section dropdowns are keyboard-operable Radix menus; the sheet is still the flat route to everything.
- Active route is longest-base-wins (`navItemFor`), never `startsWith(href)`.
- A failing permission is not rendered — never rendered disabled.
- Below `lg` the island is not drawn (`hidden lg:flex`); the top bar and bottom island are `lg:hidden`.
  No component reads `window.innerWidth`.
- The sheet closes on navigation during render, not in an effect.

**Kiosk**
- The kiosk is light only and renders outside the console providers.
- `TOUCH_TARGET_MIN_MM` (20) and `TOUCH_SPACING_MIN_MM` (8) are physical; sizes are mm × `pxPerMm`,
  never CSS px.
- Confirm is a circle, cancel a rounded square: the shape is a cue, not decoration.
- A pulse never exceeds 1.25 Hz; the 3 Hz flash limit is a seizure rule.
- The countdown ring is `data-motion="essential"`.
- Reduced motion on the Pixi stage is a deployment setting (`ArtQuality`), not the OS preference.
- Never voice phone digits, private-report choices, dice outcomes, bribe decisions or private report
  content through the speakers (`voice_forbidden`).

---

## 18. Checklists

### New console page
- [ ] `'use client'` page under `app/(app)/(console)/…` rendering a feature component
- [ ] `PageHeader` first, nothing above it; no top padding of your own; one short description line
- [ ] **one** `RESEARCH_NAV` / `ADMIN_NAV` entry (or `EXTRA_ROUTES` / `ROUTE_OVERRIDES`) with the right
      `requires`; update `EXPECTED_NAV` in `e2e/shell.spec.ts` if a role's list changes
- [ ] content in `Section`s / `Card`s; `QueryState` or `EmptyState` / `ErrorState` / `LoadingState`
- [ ] buttons through `ActionGroup` (or `PageHeader`/`Section` `actions`, `DialogFooter`)
- [ ] tokens only; purple text via `text-accent-foreground`; status via `StatusBadge`
- [ ] z-index from the ladder only
- [ ] screenshot it at 1440 / 834 / 390 in light and dark (add it to `e2e/visual.spec.ts` if it is a
      primary screen) and keep axe green

- [ ] a download or export? Its file name comes from `lib/naming.ts` (the `naming` skill), never a
      template string

### New form or dialog
- [ ] labelled controls (`Label htmlFor`), `aria-invalid` + a message under an invalid field
- [ ] Cancel first, the action last, danger outlined and last; pending label while saving
- [ ] errors by meaning (§12.3); `errorMessage()` for API errors

### New animation
- [ ] CSS (Tailwind transition / `tw-animate-css` / a keyframe beside `console-main-in`) with
      `ease-out`; no JS animation library on the console
- [ ] a **static** counterpart for anyone with reduced motion
- [ ] kiosk: through `art/motion.ts`, ≤ 1.25 Hz for any repeating attention cue

### New kiosk screen or game element
- [ ] targets ≥ 20 mm, spacing ≥ 8 mm, in the lower two-thirds safe area (`safeAreaFor`)
- [ ] icon + shape + colour (never colour alone); icon ≥ 4.5:1 on its face
- [ ] an audio key for every interactive element; a replay control on every instructional state
- [ ] no text or numerals a participant must read; nothing private on the speakers
- [ ] an accessible name (`aria-label`) on every DOM control even though nothing is printed
- [ ] reduced motion honoured; no flashing above 3 Hz

### Checks (CI only — nothing runs on a laptop)
- `pnpm lint` (biome) · `pnpm typecheck` · `pnpm test` (vitest, incl. `action-group.test.tsx` and
  `kiosk-game`'s `fallback-screens.test.tsx`) · `pnpm build`
- CI job **Web UI - Playwright**: `pnpm --filter web exec playwright test` (shell, kiosk route,
  `visual.spec.ts` with axe at three widths × two themes), then the admin and research suites; the
  artifact `web-ui-screenshots` holds `test-results/visual/*.png` and the suites' screenshots.

---

## 19. Copy and button rows (owner ruling, 2026-10-17 — the same ruling as the sibling portals)

> "there is a lot of useless verbosity in the help text and subtext … keep it concise … The
> applications' ui and design choices should be elegant, premium, and conscious." — and "not AI slop".

### 19.1 Concise copy

Every help line, hint, subtext, empty state, banner, dialog body, toast and card description says
**only what the person needs to act**: one short sentence, often a few words, or nothing when the label
already says it. Calm and plain — a careful product designer, not a chatbot.

- **Remove:** how the software works, history and rationale, hedging, repeating the label, multi-sentence
  paragraphs, internal terms ("the API", "the server", "worker", endpoint paths, `gates.yaml`,
  `content/games`, setting keys, feature ids like `PLT-09`), and gap admissions. The reasoning belongs
  in a code comment.
- **Keep, tightened:** legally or scientifically required meaning (consent, erasure, withdrawal,
  two-person approval, token revocation, legal holds), validation messages (short and specific), the
  numbers and dates a person needs, the method names researchers use (ICC(A,1), TOST, DIF), and the
  meaning of any warning that prevents data loss.
- **Offer the next step as a control, not a paragraph.**
- Rule 10 still holds — a cap or a truncation is stated, in a few words.
- **Shorten, never drop, the fact a test pins.** Headings and strings asserted by `research.spec.ts`,
  `admin.spec.ts` and `shell.spec.ts` change together with their assertion, in one commit.

| Before | After |
|---|---|
| Kiosk fleet: registration and device tokens, heartbeat health, outbox backlog, deployments and site mode. Heartbeats carry no participant identifiers. | Registration, health and deployments. |
| Use for a stolen or decommissioned kiosk. Its token stops authenticating at once; queued events on the device are not accepted until it is reinstated. | For a lost or retired kiosk. Its token stops working at once and its queued events are refused until it is reinstated. |
| Approved versions are frozen and become loadable by kiosks (bundle check). Two different people must sign; both names are recorded in the audit log. | Freezes this version for kiosks. Needs two different people. |
| Pseudonymous records only: pids, linkage, consent and enrolment. Identity and contact details are held in a separate vault and never shown in the research console. | Pseudonymous records only. Identity and contact details are never shown here. |
| Stopping participation keeps already collected data under the consent; withdrawing with erasure removes it from every table and future snapshot, with a signed receipt. | Stopping keeps data collected so far. Erasure removes it everywhere, with a signed receipt. |
| Needs API `POST /api/v1/admin/kiosks/{id}/commands` (KSK-10) … | *(removed — the control is absent until the endpoint exists)* |
| Your account still uses its initial password. Replace it with one only you know. | You’re still on your initial password. + link **Change password** |
| This is a read-only demo with no backend connected, so changes are disabled. | Read-only demo — changes are off. |

### 19.2 Button rows — `ActionGroup`

| Buttons | Phone (< `sm`, 640px) | `sm` and up |
|---|---|---|
| 1 | centred (`fill` spans the line) | centred |
| 2 | one line, equal halves; a label wraps inside its button | one line, content width, at `align` |
| 3+ | stacked one under another, full width | one row of pills (`rounded-full`), wrapping only when it must |

- **Order:** Cancel / the safe choice first, the primary last; destructive actions last and set apart
  (`variant="destructive"` or `data-danger`).
- `PageHeader` / `Section` `actions` and `DialogFooter` already route through it — never hand-style a
  button row on a screen.
- In a row that also holds a status line, wrap only the buttons and keep the status outside.
- Not a button row, left as `flex flex-wrap gap-2` with a one-line comment: toolbars (DataTable,
  audit-log pager, result-table pager), selects, segmented controls (theme, Chart/Table), the
  administer overlay header and its item-wizard step controls.
- The card-sort tablet's twin is the `.actions` CSS class (§21).

---

## 20. Kiosk and game screens — the participant rules

The kiosk is a public touch screen at a village fair. A participant may not read any language, may be
holding a child, may be watched by neighbours, and plays once. Every rule below is enforced in code or a
test; the requirement ids are `docs/IMPLEMENTATION_PLAN.md`'s.

### 20.1 What the data-screen rules do NOT mean here

- **Purple is not the kiosk's action colour.** The kiosk speaks the "Mela at golden hour" palette
  (`art/palettes.ts` `MELA`, `TIME_PALETTES`) and the contract tokens `KIOSK_PALETTE`: **confirm
  `0x12707a`** (teal), **cancel `0xc2410c`** (burnt orange), `ink 0x2b1b17`, `paper 0xfff4de` (cream).
  Keep the game visuals; never import console tokens into a game.
- **No copy, so no concise-copy rule** — instead: no reading at all (§20.4).
- **No `ActionGroup`** — choices are arranged by `arrangeChoices()` in the safe area (§20.2).
- **Light only, no theme.** The stage's lighting is the scene's time of day.

### 20.2 Physical sizing and placement (KSK-05, KSK-06)

- `TOUCH_TARGET_MIN_MM = 20`, `TOUCH_SPACING_MIN_MM = 8` (`core/contracts.ts`), converted with
  `physicalMetrics(pxPerMm)` — `DEFAULT_PX_PER_MM = 4.0` (a 21.5″ 1920×1080 panel), configurable per SKU
  (`VITE_PX_PER_MM` in `apps/kiosk`, `NEXT_PUBLIC_PX_PER_MM` on `/kiosk`). **Size in millimetres, never CSS pixels.**
- Defaults: art-kit buttons `DEFAULT_BUTTON_MM = 30`; fallback `BigButton` 34 mm (consent archive
  24 mm, exit 22 mm).
- **Interactive safe area = the lower two-thirds** (`safeAreaFor`: top = height/3, margin =
  max(2 × spacing, 3% of the short edge)). `arrangeChoices()` lays out 2–6 equal targets: one row in
  landscape when it fits (max 6 per row), a balanced grid in portrait (max 3 per row), spacing never
  below the physical minimum.
- `rectsSeparated()` is the spacing lint; strict-target builds check every registered target.

### 20.3 Colour, shape and contrast (KSK-06)

- **Colour is never the only cue.** Every button variant is icon + shape + colour (`BUTTON_TOKENS`):
  confirm = teal **circle** + tick; cancel = orange **rounded square** + cross; replay = marigold circle
  + circular arrow; help = indigo speech bubble; exit = maroon octagon + open hand. The React fallback
  screens follow the same shapes (`BigButton shape`).
- **Confirm on the right, cancel on the left**, everywhere (consent, survey, opt-in, bands).
- Icon on its face ≥ **4.5:1** (`iconInkFor()` picks cream or ink, whichever contrasts more; pinned by
  `session/__tests__/fallback-screens.test.tsx`). Language faces use Okabe-Ito in a fixed order
  (`#0072b2 #e69f00 #009e73 #cc79a7 #56b4e9`) and Tol's wine `#882255` sixth — Okabe-Ito vermilion
  carries neither icon at 4.5:1 and reads as the cancel face.
- Colour-vision simulation keeps ΔE ≥ 20 between paired categories.

### 20.4 No reading; voice first; multilingual (KSK-05, VOX-01…04)

- **No text or numerals a participant must read**, anywhere on the stage or the fallback screens. The
  shell renders no text (`KioskGame`).
- **Every interactive element has an audio key** (`registerTarget(target, key)`), resolved through the
  per-language manifest; every instructional state has a replay control (`instruction_replay` is
  logged). **Pre-recorded clips only — no TTS in production** (the dev Web Speech placeholder is forced
  off in production builds).
- Languages: `content/i18n/lines.yaml` — reference `en-IN`, plus `hi-IN`, `mr-IN`, `ta-IN`. The
  language picker is faces in `languageFaceOrder`; a face's accessible name is the language's
  **autonym** (`Intl.DisplayNames([lang]).of(lang)`), never an English word.
- **Never voice** (`voice_forbidden`): phone digits, private-report choices, dice outcomes, bribe
  decisions, and report content under "show privately". The audio router refuses them on the speakers.
- ASR is closed-vocabulary and opt-in per prompt; it only proposes. **Consent, opt-ins and private
  reports are touch only.** The microphone is closed in attract, language select, consent and bands.

### 20.5 Accessible names for screen readers and bots

Nothing is printed, but every DOM control carries an `aria-label` ("Yes", "No", "Stop", "Stop and keep
my answers", the autonym…), toggles carry `aria-pressed`, the exit hand `aria-expanded`. Bots and e2e
scripts find targets by `data-target` ids — keep both.

### 20.6 Motion, flashing, reduced motion

- No flashing above **3 Hz**. Attention pulses ≤ **1.25 Hz** (`buttons.ts`: 0.8 s period); the fallback
  attract pulse is 2 s, the walkaway re-prompt 1 s.
- Under `prefers-reduced-motion` the fallback's `.shriii-pulse` stops and a static cream ring
  (`box-shadow: 0 0 0 10px #fff4de99`) takes its place — the static half of the signal.
- The walkaway countdown ring (`shriii-ring`, 10 s) is `data-motion="essential"`.
- The Pixi stage: §8.2–8.3.

### 20.7 Child-safe, private, recoverable (KSK-03, KSK-04, KSK-12, ONB-06)

- A session starts **only by touch** (or the non-imaging presence sensor's greeting). No wake word.
- The age band screen offers **Under 18 / 18 or older**; under 18 goes straight to the wipe
  (`UNDER_AGE` → `#session.wipe`, abandon reason `under_age`).
- Walkaway: 8 s re-prompt → 20 s "still there?" → 45 s → a 10 s countdown → abandon, wiping screen and
  memory. Within 1 s of the countdown ending no trace of the previous player is visible.
- The **exit hand** is always available (top-right, 22 mm) and offers keep or delete.
- The kiosk shows **no numbers and no scores** during play; the picture report has "show privately"
  (`report.show_privately`) and auto-clears after 60 s (`ReportScreen` `autoClearMs ?? 60_000`).
- No context menu (`contextmenu` blocked), no pinch zoom (`user-scalable=no`, `maximumScale: 1`), no
  text selection, `touch-action: none`, full screen on the first touch in a browser.

### 20.8 Fallback screens (`session/ui/FallbackScreens.tsx`)

Plain, icon-only screens for states whose real screen has not been plugged in through
`KioskRuntimeView`'s `screens` prop. They use the art kit's tokens (`COLORS` from `KIOSK_PALETTE` /
`MELA`), the same shapes, ≥ 20 mm targets, and the rules above; `FALLBACK_CSS` carries the pulse,
ring, focus-visible outline (6px cream) and the reduced-motion swap. They are not a second design.

### 20.9 Electron and the browser kiosk

- `apps/kiosk-electron` is a hardened main process (kiosk window, `app://` standard secure scheme,
  CSP, watchdog, encrypted outbox, thermal printer, signed update rings). It has **no UI of its own**:
  the renderer is `apps/kiosk`'s build. A UI change belongs in `kiosk-game` or `apps/kiosk`.
- `apps/kiosk/index.html` and `app/kiosk/layout.tsx` pin `color-scheme: light`, the terracotta
  `#b8643c` letterbox and `themeColor #f0a35e`.
- Offline is the normal case: an empty `…_API_BASE` keeps the outbox in IndexedDB (browser) or the
  encrypted SQLite outbox (Electron). Never block a screen on the network.

---

## 21. The card-sort tablet (`frontend/apps/card-sort-app`)

A Capacitor Android tablet for supervised sites: **staff screens** (PIN, settings, home, new
administration, instructions, summary, pause/abort, audit trail) and the **participant test stage**.

- **Staff screens follow the console's universal rules in plain CSS** (`src/styles.css`): tokens
  `--primary` purple-700, `--primary-hover` purple-800, `--bg #f7f6fb`, `--panel #fff`, `--ink #1e1b2e`,
  `--muted #615d7a`, `--line #e4e2ef`, `--danger #dc2626`; `.panel` 16px radius + `--shadow-sm`;
  `.btn` 12px radius, min-height 48px (`.big` 64px); `.btn.primary` hover purple-800 + `--shadow-cta`;
  `.btn.danger` **outlined**; inputs 12px radius with the purple focus ring; one purple
  `:focus-visible` outline; the reduced-motion block.
- **`.actions` is `ActionGroup` in CSS** — one centred, two in equal halves below 640px, three or more
  stacked below 640px and pills from 640px, `.danger` last (`order: 99`). Cancel first, the primary
  last. `.row` stays for toolbars and list rows.
- **The test stage keeps its neutral grey** (`.test`, `.finished` `#ececf0`) — the card faces are the
  stimulus and are never restyled. The key-card press border uses `--primary`.
- Light only: a field room, and the stage must look identical every time.
- Copy is staff copy: short, operational ("Saved and queued for sync.", "No recording for hi-IN — read
  this aloud: …").
