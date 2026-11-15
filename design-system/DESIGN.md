# Pause design system

Pause is a booking tool for employee wellness campaigns. The interface should feel calm, considered and quick: an editorial look with as few steps as possible between opening the page and holding a place.

## Foundations

| Token | Value | Use |
|---|---|---|
| Linen | `#EDECE3` | Page background |
| Sheet | `#FAF9F4` | Cards and dialogs |
| Ink | `#1C2A24` | Text |
| Vetiver | `#2C5545` | Primary actions, selection, brand |
| Stone | `#5C6A62` | Secondary text |
| Rule | `#D5D3C5` | Hairlines and borders |
| Sun | `#D9A441` | The one warm accent: live, new, nearly full |
| Brick | `#A13D2B` | Destructive actions and errors |

- **Type:** Young Serif for headings, times and numbers that matter; DM Sans for everything else. Both are bundled locally.
- **Shape:** pills for buttons and chips, 12px fields, 18 to 24px cards.
- **Depth:** two surfaces. A deep green panel (gradient, grain, slow ripples) carries identity; bright sheets carry the work and float on layered shadows.
- **Light only.** There is no dark theme.

## Principles

1. **Show, don’t make people open.** Availability, fill and attendees are visible without a click: fill bars on days, initials on times, “36 of 93” on campaigns.
2. **One obvious action.** Rows are clickable; repeated per-row buttons are replaced by the row itself, a switch, or a small menu.
3. **Free things lead.** Bookable times are full tiles; taken times shrink to struck-through chips.
4. **Never a dead end.** When a time fills, the dialog offers the closest free times and keeps the person’s details.
5. **Changes are visible before saving.** New and removed items are marked, with Undo, and the save bar says whether anything is unsaved.
6. **Motion answers an action or marks one moment.** One entrance on load, the confirmation pass, and live updates. Everything respects reduced-motion settings.
7. **Plain words.** Sentence case, no jargon, and nothing that assumes what is being booked.

## Where things live

- `src/theme.css`: tokens, the booking page (`pz-` classes, in the `components` layer) and the admin skin (`body.pa` and `pa-` classes, unlayered so they restyle Spartan components, including those rendered in overlays).
- Spartan (Helm) components in `src/ui` supply behaviour, focus management and accessibility.

## Verification

`tests/pause-ui.spec.ts` covers both sides with mocked backend responses. It does not verify live email delivery, hosted realtime or database policies.
