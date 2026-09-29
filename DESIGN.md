---
name: MediMate Design System
colors:
  surface: '#f9f9ff'
  surface-dim: '#cfdaf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee8ff'
  surface-container-highest: '#d8e3fb'
  on-surface: '#111c2d'
  on-surface-variant: '#434655'
  inverse-surface: '#263143'
  inverse-on-surface: '#ecf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#46566c'
  on-tertiary: '#ffffff'
  tertiary-container: '#5e6e85'
  on-tertiary-container: '#e9f0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f9f9ff'
  on-background: '#111c2d'
  surface-variant: '#d8e3fb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system is built for a student-engineered clinical medication tracker, prioritizing functional utility, cognitive clarity, and calm accessibility over decorative trends. Designed within an academic Design Thinking framework, it targets university students, busy caregivers, and patients managing complex daily dosing regimens who need immediate, error-free comprehension.

The aesthetic follows an authentic, utilitarian **Modern Functionalist** ethos:
- **No artificial embellishments:** Avoids glowing neon gradients, blurred glass backdrops, neomorphic soft bevels, or hyper-stylized illustrative blobs.
- **Human-centered pragmatism:** Emphasizes high-contrast legibility, unambiguous data states, and dependable physical metaphors derived from pharmaceutical charts and index cards.
- **Quiet confidence:** Uses a balanced medical blue anchor supported by neutral slate foundations to reduce anxiety and visual fatigue during daily routine logging.

## Colors

The palette is engineered strictly for light-mode readability, adhering to WCAG 2.1 AA standards across all text and state combinations.

### Core Roles
- **Primary (`#2563EB` | Active `#1D4ED8`):** Medical Royal Blue. Applied to primary CTAs, active navigation items, progress rings, and focal interactive elements.
- **Secondary Accent (`#0D9488` | Active `#0F766E`):** Clinical Teal. Used for secondary confirmation metrics, preventive care tags, and adherence trend indicators.
- **Canvas & Surfaces:**
  - Base App Canvas: `#F8FAFC` (Slate 50)
  - Card & Modal Surfaces: `#FFFFFF` (Pure White)
  - Interactive Hover Surface: `#F1F5F9` (Slate 100)
  - Structural Divider / Border: `#E2E8F0` (Slate 200)
- **Typography:**
  - Primary Text: `#1E293B` (Slate 800) — high-contrast body and headers.
  - Secondary Text: `#64748B` (Slate 500) — timestamps, metadata, and supporting notes.
  - Disabled / Placeholder: `#94A3B8` (Slate 400).

### Status Tints (Two-Tone System)
Status badges and alerts use high-legibility pairs consisting of a solid dark text token against a muted, high-value background fill:
- **Success / Taken:** Text `#16A34A` over fill `#DCFCE7` (Border `#BBF7D0`).
- **Warning / Due Soon / Pending:** Text `#D97706` over fill `#FEF3C7` (Border `#FDE68A`).
- **Critical / Skipped / Missed:** Text `#DC2626` over fill `#FEE2E2` (Border `#FECACA`).
- **Neutral / As-Needed:** Text `#475569` over fill `#F1F5F9` (Border `#E2E8F0`).

## Typography

The type hierarchy uses **Inter** across all roles to ensure geometric clarity, distinct numeral forms (critical for dosages like `10mg` vs `70mg`), and uniform rhythm.

- **Dose & Metric Numbers:** Tabular figures (`font-variant-numeric: tabular-nums`) must be applied in medication tables, dose timings, and countdown labels to ensure vertical alignment.
- **Headlines:** Scaled conservatively to maintain an analytical dashboard density. Page titles sit at `28px` bold, while panel headers occupy `18px`–`20px` semibold.
- **Labels:** Small labels (`12px`) leverage a slightly wider letter spacing (`0.02em`) with medium or semibold weights to preserve legibility when rendered inside badges or table headers.

## Layout & Spacing

The dashboard relies on an asymmetric fixed-navigation and fluid-content architecture:

- **Sidebar Anchor:** A fixed-width left rail (`230px`) pinned vertically on desktop screens (>=1024px). Houses logo, user navigation items, and quick-add actions.
- **Header:** A fixed-height (`64px`) horizontal top strip spanning from sidebar edge to right margin. Contains patient context (e.g., "Alex M."), today's date, and notification status.
- **Main Canvas:**
  - Desktop: Multi-column fluid grid using `1.5rem` gutters and `2rem` outer padding. Arranged as a 12-column responsive layout (e.g., 8 cols for timeline/table, 4 cols for daily summary and adherence metrics).
  - Tablet (768px - 1023px): Collapses sidebar into a slim icon bar (`64px`), content rebalances into single or 2-column stacked blocks with `1.25rem` margins.
  - Mobile (<768px): Top bar transitions to header with hamburger trigger; columns collapse into a single vertical stack with `1rem` margin and `1rem` gap between medication cards.

## Elevation & Depth

This system avoids heavy drop shadows and floating multi-layer blur techniques. Depth is created through crisp boundary lines and subtle, natural ambient lighting:

- **Flat Foundation:** The canvas rests on `#F8FAFC`. All primary modules sit on `#FFFFFF` surfaces bounded by a continuous `1px solid #E2E8F0` border.
- **Resting Cards:** `box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.03)`. This soft grounding keeps the visual plane stable.
- **Interactive Hover (Cards & Clickables):** `box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)`. Accompanied by a border color transition to `#CBD5E1`.
- **Dropdowns & Popovers:** `box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)`.
- **Modals & Overlays:** Background overlay is a flat tint `rgba(15, 23, 42, 0.4)`. The dialog panel uses an elevated shadow: `0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`.

## Shapes

The design uses balanced, modern geometric radii (`0.5rem` / `8px` baseline) to maintain approachable software ergonomics without sliding into child-like or overly pill-shaped forms.

- **Base Radius (`0.5rem` / `8px`):** Applied to form inputs, utility buttons, table containers, search fields, and notification cards.
- **Large Radius (`rounded-lg` - `0.75rem` / `12px`):** Main dashboard panels, timeline grouping cards, and pop-up modal containers.
- **Badge Radius (`0.375rem` / `6px`):** Status indicators, pill tags, and dosage unit chips.
- **Avatars & Indicator Dots:** Fully circular (`rounded-full` / `9999px`) for user profile thumbnails, daily completion status rings, and step indicators.

## Components

### Buttons
- **Primary:** Background `#2563EB`, text `#FFFFFF`, font-weight 500. Hover: `#1D4ED8`. Focus: 2px ring offset `#FFFFFF`, ring color `#2563EB`. Padding: `8px 16px`. Radius: `8px`.
- **Secondary / Outline:** Background `#FFFFFF`, text `#1E293B`, border `1px solid #E2E8F0`. Hover: background `#F8FAFC`, border `#CBD5E1`.
- **Destructive / Skip:** Background `#FFFFFF`, text `#DC2626`, border `1px solid #FECACA`. Hover: background `#FEF2F2`.

### Status Badges & Chips
- Compact pills (`px-2.5 py-0.5`, `label-sm`), constructed using the defined status pairs:
  - *Taken:* Text `#16A34A`, background `#DCFCE7`, border `1px solid #BBF7D0`.
  - *Scheduled / Pending:* Text `#D97706`, background `#FEF3C7`, border `1px solid #FDE68A`.
  - *Missed:* Text `#DC2626`, background `#FEE2E2`, border `1px solid #FECACA`.
  - *PRN (As Needed):* Text `#475569`, background `#F1F5F9`, border `1px solid #E2E8F0`.

### Form Inputs
- Standard inputs, selects, and textareas feature a uniform `1px solid #CBD5E1` border on `#FFFFFF` backgrounds with `px-3 py-2` spacing and `0.5rem` radius.
- Text uses `14px` (`#1E293B`).
- Focus state drops standard browser outlines in favor of `border-color: #2563EB` and a crisp `box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15)`.
- Helper and error labels sit directly below at `12px` with regular margins.

### Medication Cards & Schedule Lists
- Rendered on white panels with `1px solid #E2E8F0`.
- List entries use a horizontal row layout with:
  1. Time column (bold `14px` tabular text).
  2. Medicine details (Medication name in `15px` semibold, dosage `13px` muted secondary text).
  3. Instructions chip (e.g., "Take with food").
  4. Status badge.
  5. Action button group ("Take", "Skip").

### Data Tables
- Crisp, unadorned borders (`border-collapse: separate`, `border-spacing: 0`).
- Header row: `#F8FAFC` background, `12px` uppercase semibold text (`#64748B`), bottom border `1px solid #E2E8F0`.
- Data rows: `#FFFFFF` background, padding `12px 16px`, alternating subtle hover state `#F8FAFC`.

### Navigation Sidebar & Header
- Left sidebar (`230px`): White surface, right border `1px solid #E2E8F0`. Navigation items display a `20px` outline SVG icon followed by `14px` label. Active state highlights with `#EFF6FF` background and `#2563EB` text and icon.
- Header bar: `#FFFFFF` surface with bottom border `1px solid #E2E8F0`. Displays current date and user identity chip ("Alex M.") paired with a clean status dot.