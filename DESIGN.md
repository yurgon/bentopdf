# Design

Chosen by Yuri on 16 November 2026: **variant A, "Calm"**. Prototypes live in `design/` (sources in `design/src`, build with `node design/build.mjs`, output in `design/site`). The tokens and components in `design/assets/plyleaf.css` are the source of truth for the site template.

## Visual theme

A white page with warm-grey neutrals, one work surface per screen, long text set like a good article. Calm, precise, product-grade (references: Stripe, Linear). Light and dark themes. Variant B's dark "stage" band is not used.

## Color

OKLCH tokens, neutrals tinted 0.004–0.012 chroma toward the accent hue (75–80).

| Role                                | Light                                  | Dark                          |
| ----------------------------------- | -------------------------------------- | ----------------------------- |
| Page `--bg`                         | oklch(1 0 0)                           | oklch(0.165 0.006 75)         |
| Surface `--surface` / `--surface-2` | 0.977 / 0.955                          | 0.198 / 0.232                 |
| Lines `--line` / `--line-strong`    | 0.915 / 0.85                           | 0.285 / 0.36                  |
| Text `--ink`                        | oklch(0.215 0.012 75), 17.5:1          | oklch(0.955 0.005 80), 16.9:1 |
| Secondary `--ink-2`                 | 8.1:1                                  | 9.6:1                         |
| Captions `--ink-3`                  | 5.3:1                                  | 6.7:1                         |
| Accent `--accent` (honey amber)     | oklch(0.81 0.148 80), text on it 9.3:1 | oklch(0.82 0.145 80)          |
| Accent text `--accent-ink`          | oklch(0.5 0.115 66), 6.2:1             | oklch(0.84 0.12 82), 11.7:1   |

Amber appears only on the main action, the current selection and progress. Success/privacy is `--ok`, errors `--danger`.

## Typography

One family: Hanken Grotesk (OFL), weights 400, 500, 600. Self-host it in production (no Google Fonts request). Fixed scale: 13, 14, 16 (UI), 17 (prose, line-height 1.7, max 68ch), 20, 24, 30, 38; hero clamp 38–56. Headings letter-spacing −0.015 to −0.03em, `text-wrap: balance`.

## Layout

4px spacing grid; 24px gutter on wide screens, 16px on phones; content width 1120px. Tool page (variant A): centered breadcrumbs, H1 and promise line; the work surface (max 880px) is the only object on the first screen of desktop and phone; below it a two-column layout with a sticky "On this page" outline (200px) on the left and the text column (max 760px) on the right; the outline is hidden under 900px. Home: centered promise with a tool search, then every tool as grouped quiet lists.

Corner radii: 6 chips, 8 buttons and inputs, 12 panels, 16 the work surface.

## Components

Header with brand, nav and theme toggle; breadcrumbs; buttons (primary amber, neutral, ghost; sizes sm/md/lg; hover, pressed, focus, disabled, busy); badges; inputs, select, segmented control, option cards, switch; work surface with drop zone (idle, drag-over, error), file row, progress, result; steps with own schematic diagrams; before/after figures; tables; FAQ with `details`; related tools as a list with a reason line; update date; footer.

Every page has the nine blocks: title and promise, work area, instructions, what you get, how it works, description and limits, questions, related tools, update date.

## Motion

150–250 ms ease-out-quint for state changes only: hover, selection, progress, the result appearing. Everything respects `prefers-reduced-motion`.

## Icons

Own set in `design/src/sprite.html`: 20px grid, 1.6 stroke, round caps. Labels for tools and states only, never decoration.
