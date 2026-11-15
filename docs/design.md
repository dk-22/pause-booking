# Pause interface design

The interface applies the Apple Design skill installed from `emilkowalski/skills/skills/apple-design`. Spartan provides the accessible component behavior; the local Helm components and `src/theme.css` define Pause’s appearance.

## Visual hierarchy

- Use the platform system font. Large headings have tighter tracking; body copy retains normal tracking and comfortable leading.
- Blue identifies primary actions, current selections, navigation icons, and links. Green means success, orange means unpublished or unsaved, and red means cancellation, closure, or an error.
- Cool gray separates the workspace from solid white content. Tables, labels, and editable content stay legible on opaque surfaces.
- Rounded grouped surfaces contain related tasks. Use subtle borders and shadows rather than decorative gradients or moving backgrounds.
- Keep static headings visible during loading. Skeletons represent only values fetched from the database.

## Screen structure

Employee booking has one session surface. Campaign identity and the date selector share a toolbar on desktop and stack on phones. The availability table retains the full content width. Change campaign opens a focused picker. Selecting a time opens the reservation sheet, followed by confirmation and the calendar download.

Administration uses a collapsible sidebar, a contextual toolbar, and a content surface. Campaigns, reservations, administrators, and business units share controls and spacing. The campaign editor groups schedule and visibility settings. Important changes continue to require the existing explicit confirmations.

## Interaction and accessibility

- Give immediate pressed feedback on pointer-down; perform actions on click/release.
- Use short, non-bouncing, symmetric sheet entrance and dismissal. Do not delay interaction or fetching to showcase animations.
- Use translucency for structural chrome and modal surfaces, not layers of translucent content cards.
- Respect reduced motion, reduced transparency, and increased contrast preferences. Provide solid materials when requested.
- Preserve keyboard navigation, focus restoration, field labels, visible focus, and mobile attendee popovers.
- Keep form controls and dialog actions at least 44 px high on phones. The circular close control has an expanded hit area.
- Preserve employee details when a selected time fills up. Replace confirmation with Choose another time.

## Validation

`npm run test:ui` covers booking, contention feedback, campaign management, administration, keyboard interaction, loading, responsive layouts, and deployed asset paths using isolated fixture data. `npm run build:pages` verifies the production build and GitHub Pages route entries. Review screenshots at desktop and phone widths after visual changes.
