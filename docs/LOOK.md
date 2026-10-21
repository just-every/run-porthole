# Porthole's look

The app wears the owner-approved app look (pick A, 20 Oct 2026): the **trace waterfall with the slow span opened in
place**. One white bar; a thin p95 strip on its own clock axis, with the deploy that changed things pinned into it;
the trace card; then the trace's spans as indented rows on a 0–2,400 ms hairline grid, each led by its team's tag. The
one slow span is the only scarlet on the screen, and it opens in place, pushing the rows under it down, into four
evidence cards (Query, Log, Profile, Deploy) and the agent's note: a small sea-glass tag with the mark, what it found
and readied, and the person who approves it. People approve; Porthole never changes production by itself.

It deliberately breaks from the rail + table + side panel skeleton: never add a left rail, count tiles, a central
table, a right exception panel, an activity log, an agent strip or a dashboard grid to it.

Porthole has no product code yet (CONTRACT.md: every clause missing), so `/app` draws this composition in its **empty
state**: the bar, the strip with "No requests yet", the trace card "No traces yet", and the waterfall's staircase as
dashed ghosts (a ghost tag and a ghost bar where each span will hang, the selected one on its pale heliotrope band and
opened into four ghost evidence cards and the agent's note). Nothing is drawn as if it existed: no service, duration,
query, person or time. The note says what is true for the person reading it and links to the run site's contract
page and docs. Build every new screen from the tokens and parts below; do not write a second copy of any of them.

## Where it lives

| File | What |
| --- | --- |
| `public/rer-theme.css` | The four faces (`@font-face`) and Base's `--rer-*` tokens, within Base's theme grammar (literal `:root --rer-*` and `@font-face` only; rer's installer reads it). |
| `public/look/tokens.css` | Every other token. A name equal to a `--rer-*` value aliases it, so each value is written once. The homepage and the docs read it too. |
| `public/look/parts.css` | Parts the homepage, the docs, the app and Base's documents share: `.card`, `.tag` (the team tag), `.pill` (the ink primary), `.ok` (the one done check), `.num`, `.slow`, `.nowrap`, `.sr`. |
| `public/look/controls.css` | `.pill-sm`, `.pill-quiet`, `.field`, `.check-box`, `.avatar`. Each rule names the app's class and Base's element together. |
| `public/look/shell.css` | The app document (`body.app`) and its one bar: `.topbar`, `.brandmark`, `.views`, `.query`, `.range`, `.alert-chip`, `.who`. |
| `public/look/trace.css` | The trace view: `.p95`, `.trace-card`, `.fall` (rows, bars, ticks, ghosts, the open band and guide), `.evidence`, `.code-box`, `.meter`, `.agent-note`, `.agent-tag`, and the not-found card `.lost`. |
| `public/look/frames.css` | Base's documents (sign-in and its notices, the link confirmation, first-run `/setup`, sign-in settings, the local hand-off, the hosted demo's owner-claim confirmation) under the app's bar as one white card, and the Lobby. |
| `public/look/porthole.css` | The entry every app document and Base frame links (`src/base/font-head.ts`). |
| `public/look/lobby.css` | The entry the edition identity's stylesheet reaches: the Lobby, and the run site's `/run`, `/contract` and not-found pages, which take only the theme. |
| `public/brand/` | The approved mark: `mark.svg` (40 px and up: the bar's lockup at 50 px, 38 px below 1024 px), `mark-32.svg` (16–32 px, the agent's tag at 22 px), `mark-16.svg`, dark variants and the favicons; `band.svg`, the Lobby's waterfall floor (the staircase in heliotrope for the path and brass for the spans that resolved, cropped from its right so phones keep its start). |
| `src/ui/` | The React parts (below). `/app` renders them once on the server (`document.server.tsx`), which also puts the app's bar on Base's documents; the root route renders `NotFound`. |

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `--rer-text` #16151b | Type, the primary pill, the avatar, the team tag's plate. |
| `--ink-2`, `--muted` | #3a3843, `--rer-muted` #5f5d66 | Secondary type; quiet lines (4.5:1 or better on white). |
| `--line`, `--line-2`, `--hair` | ink at 11 % and 18 %, #eceef3 | Card hairlines; the bar's rule and the pills' edge; row rules and the ms grid. |
| `--edge` | `--rer-border` #8f8e99 | 1 px field and quiet-button edges at 3:1. Never a thick black frame. |
| `--helio`, `--helio-ink`, `--helio-pale` | `--rer-focus` #c86be6, `--rer-link` #9333c8, #f6ebfb | The selected path's bars and the focus ring; links, the strip's line, path durations; the opened span's band. |
| `--scarlet`, `--scarlet-ink` | #e3302b, #d02a24 | **Only** the slow span's bar and its duration (and a trace's total when it is the slow one). |
| `--brass`, `--brass-ink` | `--rer-partial` #c2963a, `--rer-partial-ink` #8a6418 | Spans that resolved without harm. |
| `--sea`, `--sea-ink`, `--sea-check`, `--sea-field` | `--rer-done` #a3dacb, `--rer-done-ink` #1f7a62, #2e9c7e, #eef8f4 | Done states (one thin ✓), the agent's tag and its note's field. |
| `--span-path`, `--span-ok`, `--span-done`, `--span-slow` | heliotrope, brass, sea glass, scarlet | Bar colours by meaning, never by service. |
| `--select-band`, `--guide` | `--helio-pale`, #c993ec | The selected row's band; the dashed guide down the indent to the agent's note. |
| `--ghost-edge`, `--ghost-fill`, `--ghost-path` | #c9cbd3, #f7f7f9, #dcb6ef | Dashed ghosts where records will hang (empty states). |
| `--code`, `--note-edge`, `--note-field` | #f5f6f9, #b9e2d6, `--sea-field` | Query and log boxes; the agent's note. |
| `--field` | #f6f6f8 | The query pill's ground, hover fills. |
| `--card-radius`, `--card-shadow`, `--radius`, `--shadow` | 10 px and a soft shadow; 14 px and the homepage's soft shadow | Evidence cards; Base's cards and the not-found card. |
| `--bar-h`, `--gutter-app`, `--surface` | 72 px, 24 px (16 px below 1024 px), `--rer-surface` | The bar's height; the page's side gutter; the white of the bar, cards and notes. |
| `--sans`, `--mono`, `--pixel` | Porthole Inter, Porthole Mono (JetBrains Mono), Porthole Pixel (Departure Mono) | Inter heavy (860–880, `opsz` 32, tight tracking) for the wordmark, titles and card heads; Inter 400–700 with tabular figures for data; mono only for queries, logs, config and paths; pixel only inside team tags. |

## Parts (`src/ui`)

| Part | Props | Notes |
| --- | --- | --- |
| `AppBar` | `viewer?`, `views?`, `query?`, `range?`, `alert?`, `home?` | The one bar on every screen: the mark at 50 px and the wordmark (`data-rer-name`, so Base's Dev and Demo labels show), the views (the code's real places, the current one underlined in heliotrope), the query pill and its window, the monitor chip (`alert.fired`: a heliotrope dot; idle: a hollow one; never scarlet), and the person. Signed out it carries the lockup alone; Base's documents get it from `withBar`. |
| `Person` | `viewer` | Round initials avatar in ink, the name, the role (left out when it repeats the name). Never a portrait. |
| `P95Strip` | `ticks`, `scale?`, `points?`, `max?`, `pin?`, `empty?` | p95 on its **own clock axis** (`ticks` spread from the window's start to its end), points by `at` (0–1 along the window) and `ms` against `max`, each labelled point's value in heliotrope ink (never scarlet; a label near the window's end reads leftward), the deploy `pin` as a dashed heliotrope line with its label. With no points it says `empty` on a dashed baseline. |
| `TraceCard` | `title`, `when?`, `total?`, `facts?` | "Trace 7f3a…c21 · POST /checkout", "Wed Oct 21 2026 · 2:14 pm ET" (the trace's own time, not the screen's clock), "2,310 ms" (scarlet only when it is the slow trace). No "View trace" button on the trace itself. |
| `Waterfall` | `spans: Span[]`, `label` | Ticks every 300 ms on a 0–2,400 ms hairline grid (labelled every 600 ms below 1024 px); a 390 px name column (330 px below 1280 px, 230 px below 1024 px) where a service name never breaks and a long one moves its duration under it; rows in call order; the open span's `details` unfold right under its row and push the rest down. At 760 px and narrower each row is a card, every card the same width, and every track spans one shared x range directly under the "0 … 2,400 ms" scale, so a moment lands at the same x on every row; depth indents the tag and name inside the card, never the card or its track; the open span's cards and the agent's note hang from its row on its pale band, one card with it. |
| `Span` | `id`, `depth`, `start`, `end`, `team?`, `service?`, `tone?`, `segments?`, `expandable?`, `expanded?`, `guided?`, `open?`, `details?`, `ghost?` | `tone`: `path` (the selected path), `ok` (resolved without harm), `done`, `slow` (only the slow span). `segments` draws a self-time row ("own", "edge") in its parent's gaps. `guided` runs the parent's dashed guide down the indent. `ghost` draws a dashed tag and bar and names nothing. |
| `EvidenceCard` | `kind: query \| log \| profile \| deploy`, `children` | One of the opened span's four cards, with its line icon and heavy title; put SQL and log lines in `.code-box` (mono), a profile's share in a `.meter-row` with its `.meter` (heliotrope, never scarlet). Under the four cards the populated view adds the span's flame slice drawn to scale (the homepage's 03 slice). |
| `AgentNote` | `say`, `approver?`, `actions?`, `aside?` | The agent's note on the sea-glass field: the tag, what it says, the approver (initials avatar, name, role), the actions (one `.pill.pill-sm` primary, then `.pill-quiet`), one aside. |
| `AgentTag` | | The agent, inline only: the mark at 22 px (`mark-32.svg`) in a small sea-glass speech tag. Never a person, never a portrait. |
| `AppHome` | `viewer`, `site` | `/app` today: the composition empty, as above. Search and monitors say they aren't built: the disabled query pill reads "Search isn’t built yet", the chip "Monitors aren’t built yet". |
| `NotFound` | | Any unknown address, under the bar. |
| `appDocument`, `homeDocument`, `withBar`, `asFrame` | | A server-rendered app document (theme, look, Base's select rule, no script; its style attributes allowed one by one by hash in the CSP); `/app`; Base's documents under the bar; a Base document that links neither the theme nor the look (the hand-off page, the demo's claim page) made a frame. |

Controls: `.pill` (the ink primary, also Base's buttons), `.pill.pill-sm` (40 px, 44 px under 760 px), `.pill-quiet`
(outlined), `.field` (1 px `--edge`, 10 px radius, heliotrope focus edge and ring), `.check-box` (24 × 24 px, ink
accent, heliotrope focus ring), `.avatar`. No control is under 24 × 24 px. Focus is a 3 px heliotrope ring that follows
the control's own radius (a pill stays a pill); on the agent's sea-glass note it is `--helio-ink`, 3:1 or better. Every
single-line `<select>` keeps Base's chevron (`src/base/select-style.ts`: two gradient strokes at right 20 px and 14 px,
6 × 6 px, 40 px end padding, in `--rer-muted`): app documents carry that rule, so give a select `class="field"` and
never a `data:` SVG chevron.

## The pick's screen, for the product

- **Trace view** (the home; the demo opens on the current monitor's trace): the bar's query ("service:checkout-svc
  duration>2s"), the window ("Wed Oct 21 · 1:50–2:21 pm ET") and the chip ("Monitor fired 2:16 · Oncall paged Keisha
  Grant", heliotrope dot); the strip from the monitor's real series with the deploy pin ("v412 deployed 1:58 pm"); the
  trace card; the waterfall from the trace's real spans in call order: api-gateway 0–2,310 (Edge) > auth 12–52
  (Identity) · checkout-svc 52–2,302 (Checkout) > inventory-svc 60–180 (Inventory) · orders-db 180–2,020 (Data, the
  slow span) · payments-svc 2,040–2,250 (Payments) · own 80 (in the gaps) · edge 20 (in the gaps).
- **The opened span**: Query `SELECT id, status, total FROM orders WHERE customer_id = $1 AND created_at > $2`,
  "Seq Scan · 9,412,077 rows removed by filter · 3 returned"; Log "2:14:07 pm orders-db "duration: 1840.2 ms"", its
  `traceparent` linked to the trace, the card number masked `****4421`; Profile "checkout-svc 97% off-CPU · 82% in pgx
  Query (1,840 of 2,250 ms)"; Deploy "checkout-svc v412 · 1:58 pm · PR #3391 · migration 0412 drops
  orders_customer_id_idx". Then the agent's note: "5 causes tested, 1 held · 6 queries cited · posted 2:19 pm.
  Readied: roll checkout-svc back to v411, rebuild the index without locking writes, about 7 min, no data changed.",
  Dana Brooks · Checkout lead, Approve rollback · Ask Porthole · Open in Slack, "48 slow traces share v412".
- **Team tags** are one component (`.tag`: black plate, thin grey rim, mint pixel type): Identity, Checkout,
  Inventory, Payments, Data, Edge. No line icons beside them.
- **Below 1024 px** the bar wraps (lockup, chip and person, then the views and the query); **at 760 px and narrower**
  (390 px phones) everything is one column: the strip full width, the trace card, span rows as same-width cards whose
  tracks all sit on the one 0–2,400 ms range under the "0 … 2,400 ms" scale (depth indents the tag and name inside
  each card), the opened span's four cards and the note stacked on its band, the note full width with its buttons
  stacked at 44 px. Never a sideways page scroll; no text under 13 px.
- Data is US: US dates with weekdays that match the calendar, Eastern time ("ET" once where a time matters), no price
  or currency anywhere; volumes in ms, GB, series and spans.

## Base's documents

Sign-in and its notices, the link confirmation, `/setup`, sign-in settings and the local hand-off keep Base's markup
and hashed styles; `withBar` puts the app's bar at the top of their body and `frames.css` makes their content one white
card under it. Sign-in settings (the owner's alone, so only the owner is offered them) carry the app's whole bar with
Settings current and the person; `/setup` carries the lockup and the person; the signed-out frames carry the lockup at
the same inset. The Lobby keeps Base's door: the lockup, one line, the ink pill and the waterfall floor. The run site's
`/run`, `/contract` and not-found pages take only the theme.
