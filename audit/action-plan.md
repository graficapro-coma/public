# Gráfica Pro — Remediation Action Plan

Sequenced from "stop the bleeding" to "increase asset value". Effort is rough (S = <½ day, M = 1–3 days, L = 1–2 weeks, XL = weeks+). Every item cites where the fix lands.

---

## Phase 0 — Live risks, fix now (before any wider launch)

These are not improvements; they are current exposures to a data breach, data loss, or an uncapped bill.

| Item | Where | Effort | Why now |
|---|---|---|---|
| **P0.1 Deploy strict Firestore rules** — require `request.auth != null`, restrict to the company, least-privilege per collection; confirm they are actually live in the Firebase console | `firestore.rules` (currently the tenant filter at L23 is commented out); pairs with `index.html` `ld`/`sv` L205–259 | S–M | If rules are open/undeployed the whole DB (PII, prices) is world-readable/writable |
| **P0.2 Make backup complete + safe** — include every `COL_KEYS` and `BLOB_KEYS`; make `restaurarBackup` never delete collections absent from the file; gate/remove `wipeDatos()` behind a hard confirm | `index.html` `descargarBackup` L2944-2950, `restaurarBackup` ~L3020, `wipeDatos` ~L3031 | S | A restore today silently erases the entire quoting catalog |
| **P0.3 Automated daily Firestore export** | Firebase scheduled export → GCS bucket (infra, not code) | S | Manual JSON is the only backup and it's incomplete |
| **P0.4 Lock the AI function** — verify a Firebase ID token in the request; reject if absent; cap combined payload (text + images) well under Netlify's 6 MB; add basic rate limiting; drop `max_tokens` to what's needed | `netlify/functions/interpretar.js` (CORS L5, body parse L13-22, request L70-82) | M | Open `*` CORS + no auth + no cap = denial-of-wallet on the Anthropic key |

**Exit criteria for Phase 0:** rules verified strict in console; a fresh backup round-trips *all* data; the function returns 401 without a valid token and rejects oversized payloads.

---

## Phase 1 — Correctness & integrity (weeks 1–3)

| Item | Where | Effort |
|---|---|---|
| **P1.1 ID allocation without collisions** — allocate cotización/OT numbers via a Firestore transaction on a counter doc (or use push-ids and display a derived label) | `index.html` `nid` ~L718, `nidCot` ~L738 | M |
| **P1.2 Atomic multi-doc writes** — wrap OT + ficha + related writes in `writeBatch`/`runTransaction` | `index.html` `sv` L219-252, OT creation `confirmarDistribucionOTs` | M |
| **P1.3 Kill silent failures** — replace bare `catch(e){}` with surfaced errors + retry state; ensure a failed `sk()` never leaves memory and Firestore divergent silently | `index.html` L216/231/261/7910 and the `_saveEnCurso`/`_snapPend` path L472-526 | M |
| **P1.4 Attribute-safe rendering** — escape quotes (extend `sanTxt`/`escHtml`) or switch user-data attribute interpolation to safe builders; audit `href`/attribute sinks for CUIT/email/phone | `index.html` sanitizer L283, sinks ~L4879-4880, ~74 `innerHTML` sites | M |
| **P1.5 Error tracking + release tagging** — add Sentry (or similar); tag each deploy; keep rollback history | infra + `index.html` bootstrap | S |

---

## Phase 2 — Performance headroom (before record counts grow to thousands)

| Item | Where | Effort |
|---|---|---|
| **P2.1 `onSnapshot` → `docChanges()`; drop full-array `JSON.stringify` diffing** | `index.html` L492-512 | M |
| **P2.2 Build/minify pipeline** (esbuild) + hashed, long-cached asset; stop shipping ~450–500 KB unminified on every load | build config (new) | S–M |
| **P2.3 Single-pass capacity + id→order Map** — `rCapacidad` calls `capMetricas` twice per machine (L5670, L5680), each with `S.ordenes.find` per block (L5652); same per-block-find in `rPlan` (L4177) and weekly cal (L4453/4650/7320) | `index.html` | M |
| **P2.4 Server-side pagination / cursors** on `ld()` (`L209-211`) and `cargarDatos` (`L435-437`); virtualize long lists | `index.html` | L |

---

## Phase 3 — Maintainability & asset value (raises the score for a buyer)

| Item | Where | Effort |
|---|---|---|
| **P3.1 Break the monolith into modules with a bundler** — extract persistence, state, quoting engine, renderers; introduce a `package.json`/lockfile | whole `index.html` (~8,600 lines, ~555 global fns) | XL |
| **P3.2 Real test suite against the shipped code** — current `tests/pruebas.js` re-implements logic; make functions importable and test them | `tests/pruebas.js` + refactor | L |
| **P3.3 Incremental rendering** — stop full `#pg` `innerHTML` rebuilds (`render()` L2880); render per-component, preserve focus/scroll natively | `index.html` | L–XL |
| **P3.4 Accessibility pass** — semantic landmarks, real `<button>`s (328 `onclick` vs 245 `<button>`), dialog roles + focus traps on the 8+ overlays, aria | `index.html` nav L82-96, modals | L |
| **P3.5 De-hardcode COMA / multi-tenant** — parameterize company identity, fleet, roles (`findProv('COMA - IMPRESION')` ~L5945, fleet names, `projectId`, email-regex roles) | `index.html`, `firebase-config.js`, `tests/pruebas.js:65` | XL (only if reselling) |

---

## Dependency notes / sequencing
- **P0 blocks everything.** Do not widen access or onboard more users until P0.1–P0.4 are done.
- P1.1 (IDs) and P1.2 (atomicity) should ship together — both touch write paths.
- P2 items are safe to defer while data volume is small (today's ~4 users); revisit when any collection nears ~1,000+ docs or when render lag appears.
- P3 is where the acquisition score moves from ~3 toward ~6–7, but none of it is a live risk; it's investment, not firefighting.

## Effort roll-up (very rough)
- Phase 0: ~3–6 days (mostly config + small code) — **highest ROI by far**
- Phase 1: ~2–3 weeks
- Phase 2: ~2–4 weeks
- Phase 3: multiple months (the monolith refactor dominates)
