# Gráfica Pro — Action Plan

**Date:** 2026-10-02. Derived from the six domain reports in this folder. Ordered by **risk removed per hour of work**.
**Rule for every step:** commit to git before and after, and deploy from that commit only.

### Status (updated 2026-10-02, same day)
| Item | Status | Notes |
|---|---|---|
| 1.1 Number parser | **Done** | `cotNumDec` now es-AR aware ("110.000" → 110000); confirm on price/dollar changes > 50% (`costosEdit`, `costosCfgEdit`). Tested. |
| 1.2 Failed-load write guard | **Done** | `ld` returns `LD_FALLA` on error; 20 s timeout = failure; failed keys blocked in `sk`/`sv`; migrations/seed skipped; red banner with reload. `_knownIds`/`_docJson` filled at load. Tested with simulated `_config` read failure: config untouched. |
| 1.3 Undo / Retry | **Done** | Undo now reverts only the records changed in that step; Retry saves current data (not the stale copy). Tested with a concurrent record: survives. |
| 1.4 Double-submit | **Done** | One-at-a-time lock on `savCot`, `savCotYpdf`, `cotAFormal`, `genOT`, `confirmarDistribucionOTs`, `chCot`, `savRem`, `aprobarCotConItemsSeleccionados`, `oeGuardar`. Tested: double click → one remito. Cross-user race on the same quote still open. |
| 1.5 Revenue without IVA | **Done** | `rBalMes` (totals and per-quote list) and `rBalAño` use `subtotal` (net). Tested. |
| 1.6 Negative stock | **Partial** | `corteRegistrar` warns and lets the user cancel when the cut exceeds stock. Balance + ledger still saved as two fields. |
| 2.2 AI endpoint | **Done in code (deploy pending)** | Firebase ID-token verification (Identity Toolkit lookup), optional `ALLOWED_EMAILS`, origin allow-list (`ALLOWED_ORIGINS`), 6 MB body / 1.5 MB image caps, context lists truncated, 25 s timeout, generic errors, `max_tokens` stop detection. Client sends `Authorization: Bearer <idToken>`. Tested locally with mocked upstreams. |
| 0.x, 2.1, 2.3–2.5, 3.x | Pending | Console actions (sign-up, spend limit, PITR) must be done by the owner. |

---

## Phase 0 — Today (≈ 2 hours, no code risk)

| # | Action | Where | Removes |
|---|---|---|---|
| 0.1 | Install git, commit the current `index.html` and the rest of the folder, tag `v2026.10.02` | project root | No history / no rollback |
| 0.2 | Firebase console: check whether email/password **sign-up is open**; list existing users | Firebase Auth | Confirms critical issue #1 |
| 0.3 | Anthropic console: set a **monthly spend limit** | Anthropic | Caps denial-of-wallet |
| 0.4 | Firestore: enable **scheduled exports / PITR** | Google Cloud console | Disaster recovery |
| 0.5 | Check the Netlify deploy file list; if `audit/`, `tests/` or `*backup*.json` are reachable, remove them from the published folder | Netlify | Public exposure of internal docs/data |

## Phase 1 — This week: stop silent data loss (≈ 3–4 days)

| # | Action | Code location | Acceptance test |
|---|---|---|---|
| 1.1 | Single es-AR number parser for all numeric inputs (Tablas de costos, config, catalog); confirm when a price changes > 50% | `costosEdit` `index.html:1076`, `inp` 1290, `costosCfgEdit` 1194, catalog editors | Edit "100.000" → "110.000" saves 110000 |
| 1.2 | Track keys that failed to load in `cargarDatos`; block `sk/sv` for them with a "recargá" banner; skip `migrarAprobarExistentes`/`iniciarSinMigrar` writes if `ids` failed; remove `seed()` demo data path in production; delete the 2 demo OTs (ids 1, 2) | `index.html:452-453`, 560, 573, 578, 629-636 | Simulated `_config` timeout → no writes happen |
| 1.3 | Disable Undo (`doUndo`); change `retrySave` to retry only the failed record; fill `_knownIds`/`_docJson` from loaded data | `index.html:9847`, 169-180, `cargarDatos` | A deletes record → stays deleted after reload; B's new OT survives A's retry |
| 1.4 | Double-submit guards (disable button while saving) on `savCot`, `cotAFormal`, `confirmarDistribucionOTs`, `genOT`, `savRem`, `chCot`; re-check "OT exists" inside the counter transaction | those functions | Double click creates one record |
| 1.5 | `rBalMes`: revenue from `subtotal` (without IVA) | `index.html:7504` | Balance equals sum of net prices |
| 1.6 | Stock: refuse cuts that would leave negative stock (or warn); save balance + ledger together | `corteRegistrar`, `stockMov` | No negative/phantom stock rows |

## Phase 2 — Next 2 weeks: close the doors (≈ 2–3 days)

| # | Action | Where |
|---|---|---|
| 2.1 | Disable client sign-up; create users from console or an Admin-SDK function; rules: allow-list of uids/emails + `email_verified`; deny client deletes on core collections | `firestore.rules`, `crearUsuario` `index.html:439-443` |
| 2.2 | `interpretar.js`: verify Firebase ID token, own-origin CORS, body ≤ ~5 MB, ≤ 4 images ≤ 1.5 MB each, cap `contexto`, `max_tokens` ~3000, `AbortController` timeout, no raw upstream error text | `netlify/functions/interpretar.js` |
| 2.3 | Escape every listed sink (CUIT, ficha fields, machine/vendor names, AI output, PDF); `escHtml`/`cotEsc` encode `'` | see security.md §6 |
| 2.4 | `netlify.toml`: publish `public/` only; headers (HSTS, CSP with explicit hosts, `frame-ancestors`, `nosniff`); retire Firebase Hosting (single host) | `netlify.toml`, `firebase.json` |
| 2.5 | Show app version (git tag) in the sidebar | `index.html` |

## Phase 3 — Before ~3 months of full use: storage model (≈ 1 week)

| # | Action |
|---|---|
| 3.1 | Move `stockMovs`, `insumosMovs`, `analCostos`, `planificacion` (per machine/day) out of `gp/_config` into per-record collections |
| 3.2 | Add `onSnapshot` for the remaining `_config` and for stock/plan collections, so users see each other's changes |
| 3.3 | Load `_config` once (one read instead of 23); use the listener's first snapshot instead of `getDocs` for synced collections; `persistentLocalCache` |
| 3.4 | `docChanges()` in listeners (patch in place, no full `JSON.stringify` diff) |
| 3.5 | Make `cotMaqExtra` read-only (auto-repair once at load), so costing never writes data |

**Gate to retire the Excel production plan:** Phases 1, 2.1, 2.2 and 3.1–3.2 done, plus two weeks of parallel run (Excel + system) with no lost blocks.

## Phase 4 — After launch (continuous)

- Extract calculation helpers (`cotCalc`, paper catalog, paginado, `recomputeEstadoOT`, stock) into `lib.js` that both the app and `tests/` load; add tests that run real code; CI gate before deploy.
- Split `index.html` into modules with a minimal build (esbuild); remove inline handlers progressively.
- `id→OT`/`cotId→OT` maps for the O(n²) screens (Análisis OT, Capacidad, quote search); debounce per-keystroke saves and searches.
- Accessibility basics: labels, focus styles, keyboard flow in the costing editor (re-renders on change break Tab).
- Replace `alert/confirm/prompt` (155) with in-app dialogs; password entry never via `prompt()`.
- Only if the product will be sold: multi-tenancy, configurable company data, invoicing/AFIP, receivables, license and documentation.
