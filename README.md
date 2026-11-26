# Crane Drawing Generator

A small full-stack web app that turns four inputs into a dimensioned 2D drawing
of a **single-girder overhead (EOT) crane**, and saves designs so they can be
listed, reopened and edited.

The drawing is a sketch for early discussion. It is **not** a structural design:
values marked `*` are estimates scaled from one reference drawing (see
[Where the numbers come from](#where-the-numbers-come-from)).

## Run it

Requires **Node.js 24** or newer (the server uses Node's built-in `node:sqlite`
and runs TypeScript files directly). Tested on Node 24.21, Windows 11.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The API runs on <http://127.0.0.1:8787>, and the
web dev server proxies `/api` to it.

| Command | What it does |
|---|---|
| `npm run dev` | API + web UI together; Ctrl+C stops both |
| `npm test` | Server tests (validation, geometry, drawing, API, database) |
| `npm run typecheck` | TypeScript check for server and web |
| `npm run build` | Production build of the web UI |

Optional environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `API_PORT` | `8787` | API port. The Vite proxy reads the same variable |
| `DB_PATH` | `server/data/designs.db` | SQLite file. `:memory:` gives a throwaway database |

## Inputs

| Input | Unit | Allowed values |
|---|---|---|
| Rated load | kg | 1000, 2000, 3200, 5000, 6300, 8000, 10000, 12500, 16000, 20000 |
| Span (rail centre to rail centre) | mm | 5000–30000 |
| Rail height (floor to top of runway rail) | mm | 3000–20000 |
| Lifting height (vertical hook travel) | mm | 1000 up to rail height − 421 |

All lengths are whole millimetres, as on the reference drawing. The server is
the only place these rules live (`server/src/domain/crane.ts`); the UI reads them
from `GET /api/crane-options`.

## What the drawing shows

- **Front elevation:** span, rail height, lifting height, crane height above
  rail, minimum clearance to wall and roof, and minimum hook approach on each
  side.
- **Plan view:** span, bridge overall length, end carriage wheelbase and length.
- **Technical data table:** all inputs and derived values, with estimates
  marked `*`.

Main members are drawn to scale within each view. The hoist, hook, wheels and
walls are symbols.

## Where the numbers come from

Every constant comes from the reference drawing attached to the brief (10 t,
25 m span, 7.9 m lifting height). The dimensions were read off that drawing by
hand during development, so a wrong reading is possible, and **one drawing is
one data point**.

| Value | Rule used | Source | Confidence |
|---|---|---|---|
| Bridge overall length | span + 2 × 135 | 25270 − 25000 on the plan view | Medium: direct reading, but the 135 overhang may differ per end carriage |
| Wheelbase `*` | span × 3800 / 25000, rounded up to 100, minimum 2000 | 3800 on the plan view; linear scaling is **my assumption**; 2000 minimum is **a guess** | Low |
| End carriage length `*` | wheelbase + 510 | 4310 − 3800 on the plan view | Medium for 25 m; unknown elsewhere |
| Crane height above rail `*` | span × 1369 / 25000, rounded up, minimum 500 | 1369 on the front view; linear scaling with span is **my assumption** (a real girder depends on load, deflection limit and section) | Low |
| Highest hook position `*` | rail height − 421 | Rail top 8321 and lifting height 7900 on the front view | Medium for the reference hoist only |
| Hook approach `*` | 920 left, 1150 right (fixed) | "Min.920" / "Min.1150" on the front view | Medium for the reference hoist only |
| End clearance to wall | 235 (fixed minimum) | "Min.235" on the front view | Medium |
| Clearance above crane | 200 (fixed minimum) | "200" above the girder on the front view | Medium |
| Capacity list | 1–20 t steps | **Assumption**: common hoist catalogue steps, not checked against a catalogue | Low |
| Input ranges | see table above | **Estimates** to cover typical single-girder cranes around the reference; not from a standard | Low |

A check in the tests (`server/test/crane.test.ts`) proves that the reference
inputs reproduce the reference dimensions exactly.

## API

All bodies are JSON. Every error has the same shape:
`{ "error": { "code": "...", "message": "...", "details": [{ "path", "message" }] } }`.

| Method and path | Purpose | Success |
|---|---|---|
| `GET /api/health` | Liveness | 200 |
| `GET /api/crane-options` | Allowed capacities and limits | 200 |
| `POST /api/preview` | Validate params, return geometry + SVG (not saved) | 200 |
| `GET /api/designs?limit=&cursor=` | List, newest change first (limit 1–100, default 50); returns `nextCursor` (or `null` on the last page) | 200 |
| `POST /api/designs` | Create `{ name, params }` | 201 + `Location` |
| `GET /api/designs/:id` | Reopen one design | 200 |
| `PUT /api/designs/:id` | Edit `{ name, params, version }` | 200, version + 1 |
| `GET /api/designs/:id/drawing.svg` | Download the drawing | 200 |

Error codes: `VALIDATION_FAILED` (400), `MALFORMED_REQUEST` (400),
`HOST_NOT_ALLOWED` (403), `DESIGN_NOT_FOUND` (404), `ROUTE_NOT_FOUND` (404),
`VERSION_CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415),
`INTERNAL_ERROR` (500).

**Local-only safety.** The API listens on `127.0.0.1` and answers only requests
whose `Host` is `127.0.0.1:<port>` or `localhost:<port>` (403 otherwise), which
blocks DNS-rebinding pages. It accepts UTF-8 JSON bodies only (415 for other
types or charsets, 400 for invalid UTF-8 bytes), so a cross-site form cannot
create data and no text is silently changed on the way in. Design names must
be plain visible text: control, invisible and direction-changing characters
are refused, and a name that only looks blank counts as missing.

**Edits use optimistic concurrency.** A `PUT` must send the version it loaded.
If someone saved in between, the server answers 409 instead of overwriting
their work. The version check and the write are one SQL statement.

## Stack and why

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript (server and web) | One language, and types catch mistakes early |
| API | Fastify 5 | Small; built-in request injection for tests, central error handler and logging |
| Validation | Zod 4 | One schema per input, with clear field-level errors |
| Database | SQLite via `node:sqlite` | Allowed by the brief, a single file, no extra package |
| Drawing | SVG built as a string on the server | A pure function that is easy to test; the browser only displays it |
| UI | React 19 + Vite 8 | Quick to build a form, list and preview |
| Tests | `node:test` | Built into Node; no extra test framework |

Runtime dependencies: `fastify`, `zod`, `react`, `react-dom`.

## Known limitations

- **Load does not change the geometry.** 1 t and 20 t cranes with the same span
  get the same drawing. There is no source in this project for how capacity
  changes girder depth, end carriage or hoist size, so none was invented.
- All scaling comes from **one** reference drawing; see the table above.
- No structural, deflection, wheel load or cost calculation.
- Single user, no login. It is meant for a local machine, not a server.
- Emoji built with a zero-width joiner (for example family emoji) are refused in
  design names, because the joiner is an invisible character. Single emoji work.
- No delete endpoint, and create is not idempotent: a retry after a lost
  response can create a duplicate.
- The list has no total count. Paging uses a cursor on (updated_at, id), so
  each page is one index read and costs the same at any depth (measured about
  0.4 ms per page of 100 at 100,000 designs). If a design is edited while
  someone is paging, it moves to the top: the UI skips ids it already shows,
  and a design that was not loaded yet appears only after the list reloads
  (for example after the next save).
- The web UI has no automated tests. It was checked in headless Edge driven
  through the DevTools protocol: no horizontal overflow from 320 to 1920 px,
  Tab order equal to the visual order (skip links first), touch targets at
  least 44 px on touch screens, and the open design still marked in Windows
  forced-colours mode. It was not checked on a real phone or with a screen
  reader. Server tests cover validation, geometry, drawing, API and the database.
- The drawing in the page is a preview: its labels are small, especially on
  phones. "Open full size" shows it at its real 1600 px width (scroll to pan,
  with a "Fit to window" option), and "Download SVG" gives the file.
- At extreme inputs (for example span 5000 with rail height 20000) some
  drawing labels can touch the walls.
- Only Node 24 on Windows 11 was tested. Node 22 will not work (`node:sqlite`
  and running `.ts` files directly).

## How this was built

The code was written with an AI coding assistant (see [AI_LOG.md](AI_LOG.md)),
directed and reviewed by me. The work was committed in small steps during a
short session, so commit times are close together; they do not show the time
spent reading the brief, studying the drawing, reviewing and testing.
[DECISIONS.md](DECISIONS.md) is written by me without AI.

**Hours spent:** about 4 to 5 hours in total (my own estimate, rounded):

| Part | Time |
|---|---|
| Understanding the brief and the crane domain, writing DECISIONS.md | about 2 h |
| First working version with Claude Code | under 1 h |
| Review passes and fixing what they found | about 1.5 h |
| README, AI log and the video | about 0.5 to 1 h |

The Claude Code session timestamps show about 3 hours of active work; the
rest is time outside that session (the review passes in Claude.ai, reading,
and recording the video).
