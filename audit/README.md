# Gráfica Pro — Production-Readiness / Acquisition Audit

**Date:** 2026-10-02 (supersedes the 2026-09-16 audit)
**Method:** 6 independent expert reviews run in parallel: architecture, security, performance, backend/DB/API, frontend/UX, product/launch. Each one built its own rubric, scored it 1–10 against the actual code and cited file/line evidence.
- **Code reviewed:** `index.html`, `netlify/functions/interpretar.js`, `firestore.rules`, `firebase.json`, `netlify.toml`, `firebase-config.js`, `styles.css`, `tests/pruebas.js`.
- **Data checked:** the backend reviewer ran read-only counts on the latest real backup (`bkup/GraficaPro_backup_2026-10-01_1344.json`). No customer data was copied into the reports.
- **Verification:** two of the most damaging findings were re-verified line by line by the consolidator (marked ✔).

**Lens:** a skeptical buyer looking for reasons *not* to buy. Deliberately harsh. **No production code was changed by this audit.**

| File | Content |
|---|---|
| [architecture.md](architecture.md) | Modularity, coupling, testability, version control |
| [security.md](security.md) | Auth, Firestore rules, XSS, AI endpoint, secrets |
| [performance.md](performance.md) | Storage limits, quotas, rendering, growth simulation |
| [backend-db-api.md](backend-db-api.md) | Persistence, concurrency, integrity, backup/restore |
| [frontend-ux.md](frontend-ux.md) | State, rendering, inputs/number formats, a11y, PDFs |
| [product-launch-readiness.md](product-launch-readiness.md) | Market fit, compliance, bus factor, Excel migration |
| [action-plan.md](action-plan.md) | Ordered fix plan |

---

## Executive summary

Gráfica Pro is a **genuinely useful, domain-rich print-shop ERP**. Its costing engine has real depth: paper catalog with cut/imposition optimisation, pinza margins, per-quantity configurations, external printers, and AI interpretation of client requests. The full quote → OT → paper → guillotine → planning → delivery flow now works end-to-end. Some concrete fixes landed since 2026-09-16:
- field-level config saves;
- atomic document numbering;
- a single OT state machine;
- complete backups;
- a guarded data wipe.

**As a tradeable asset it is not close to ready, and on the risk axes it got worse in the last 16 days.**
- **Structure.** The file grew from 8,621 to **10,572 lines (+23%)** with no version control: **one git commit, dated 2026-07-11**.
- **Coupling.** Inline handlers went from 328 to **462**.
- **Last audit's quick wins.** Of the six recommended on 2026-09-16, one was partly done.
- **Security.** The model is still "any logged-in user can do anything". Public sign-up appears to be enabled, so anyone can become a logged-in user.
- **Data loss.** It is no longer theoretical. The backend review found broken references already present in the real backup (9 of 13 fichas point to deleted OTs) and demo seed OTs from 2024 that leaked into production.
- **Storage time bomb.** One Firestore document (`gp/_config`) holds 23 unbounded datasets. It is projected to hit Firestore's hard limits in **~3–9 months** of normal use, after which planning, stock and price-table saves all fail together.

### Domain scores

| Domain | 2026-09-16 | **2026-10-02** | Trend | Risk |
|---|---|---|---|---|
| Architecture / maintainability | 3.0 | **2.5** | ↓ | High (debt: Critical) |
| Security / auth / data protection | 3.5 | **2.5** | ↓ | **Critical** |
| Performance / scalability | 4.0 | **3.0** | ↓ | **Critical** (time-bound) |
| Backend / database / API reliability | 3.0 | **3.0** | → | High |
| Frontend / UX / state management | 3.5 | **3.0** | ↓ | High |
| Product / business risk / launch readiness | 3.4 | **3.3** | → | No-Go (asset) |
| **Overall purchase-readiness** | 3.4 | **2.9 / 10** | ↓ | |

## Recommendation

| Question | Verdict |
|---|---|
| **Acquire / resell as a product** | **NO-GO** (~2.5/10). Single-tenant and hardcoded to COMA (machines, staff, vendors, prices, shifts). No invoicing/AFIP/receivables. No license. No version history. One maintainer. |
| **Keep running COMA on it** | **CONDITIONAL GO** (~5.5/10). Keep using it for quotes, OTs, fichas, paper and tracking. **Do not retire the Excel production plan yet.** The plan and stock can be silently overwritten between users and by failed logins. Fix the "Must fix before full migration" list first. |

| Risk axis | Level |
|---|---|
| Technical debt | **Critical** |
| Security risk | **Critical** (drops to High once public sign-up is verified OFF and rules use an allow-list) |
| Performance risk | **High now, Critical within ~3 months** (`gp/_config` limits) |
| Maintainability risk | **Critical** (10.5k-line global script, no VCS, bus factor 1) |

---

## Top 10 critical issues (ranked by severity)

| # | Issue | Evidence | Why it blocks |
|---|---|---|---|
| 1 | **Database effectively open to anyone who registers.** The app creates users from the browser, so client sign-up must be enabled. The rules only check `request.auth != null`, and the domain filter is commented out (and would not check email verification anyway). | `index.html:439-443` (`crearUsuario`), `firebase-config.js:2`, `firestore.rules:22-24` | Read, alter or delete all customer, price and production data. [verify sign-up setting in Firebase console] |
| 2 | **Failed or slow login load writes defaults over real data.** An 8 s race makes `ld()` return null, the app keeps empty defaults, and migrations then auto-approve OTs, reset `ids` and re-seed `cotEstructuras`. The next save overwrites `_config`. | `index.html:452-453`, `560`, `573`, `578`, `629-636` | Silent mass data loss. Probability grows with data size. Demo OTs from the seed are already in production. |
| 3 | **`gp/_config` single-document time bomb.** 23 unbounded datasets (planning, stock ledger, cost analysis, catalogs) sit in one doc. | `BLOB_KEYS` `index.html:205`; writers `autoPlanReal` 9364-9395, `stockMov` 5340, `analUpd*` 7257-7293 | Firestore's 40k index entries / 1 MiB limits are reached in ~3–9 months, after which **every** config/plan/stock save fails. |
| 4 | **Price tables corrupted by number formatting ✔.** Cells display es-AR thousands ("100.000") but save with a decimal parser. | display `index.html:1290` (`cotFmtDec`), save `1076` (`costosEdit` → `cotNumDec`) | Editing "100.000" to "110.000" stores **110**. Every later quote is silently wrong. Also affects the dollar rate and `precioM2`. |
| 5 | **Undo / Retry restore whole collections and delete other users' records.** | `doUndo` `index.html:9847`, `retrySave` 169-180, delete loop in `sv` 229-235 | User A's "Deshacer" deletes the OT user B just created. |
| 6 | **Open AI endpoint (denial of wallet + prompt injection).** CORS `*`, no auth, no rate limit, no image/body size cap, caller-controlled `contexto` injected into the system prompt, `max_tokens` 8000. | `netlify/functions/interpretar.js:5`, `16-21`, `28-37`, `85` | Anyone can run up the Anthropic bill or steer outputs. |
| 7 | **Stored XSS, including via AI output.** Unescaped sinks: client CUIT, ficha billing/collection fields, machine/vendor/freight names, AI-generated strings, quote PDF. | `index.html:7825`, `9790`, `10028`, `10465`, `6620-6621`/`6738`, `9165-9181`, `5683`, `8205`/`10107` | A pasted client email can plant script that runs for every user. |
| 8 | **Multi-user last-writer-wins on plan/stock/prices, plus lost deletes.** Same-key `_config` saves overwrite each other and there is no `_config` listener. The first delete per session is never sent because `_knownIds` is not filled at load. | `index.html:263`, `503`, `229-235`, `cargarDatos` | Two planners or stock users erase each other's work. Deleted records come back. |
| 9 | **No version control, manual deploys, two live hosts, repo root published.** Netlify `publish="."` exposes `audit/`, `tests/` and potentially backup JSONs. A clean clone cannot run (`firebase-config.js` is gitignored). | `.git` (1 commit, 2026-07-11), `netlify.toml`, `firebase.json` | No rollback, no traceability, and internal documents are public. |
| 10 | **Financial reporting errors and cosmetic roles.** The monthly balance counts quote totals **including 21% IVA** as revenue ✔. Finance access is a regex on the email prefix plus hidden CSS. | `rBalMes` `index.html:7504` (`c.total`); `puedeVerFinanzas` 688-695 | Overstated income. Any user can read finance data from the console. |

## Top 10 improvements (ranked by ROI)

| # | Improvement | Effort | Fixes |
|---|---|---|---|
| 1 | One es-AR number parser for all numeric inputs in Tablas de costos and config (or show raw numbers in inputs) | ½ day | #4 |
| 2 | Block writes for any key that failed or timed out at load; skip migrations if `ids` did not load; remove demo seed from production | ½–1 day | #2 |
| 3 | Disable Undo; make Retry per-record; fill `_knownIds`/`_docJson` in `cargarDatos` | ½ day | #5, #8 (deletes) |
| 4 | Turn off client sign-up; create users in the console; rules with an email/uid allow-list and `email_verified`; deny deletes from clients | ½ day | #1 |
| 5 | Lock `interpretar.js`: verify Firebase ID token, own-origin CORS, body/image/context caps, `max_tokens` ~3000, timeout, Anthropic spend limit | ½ day | #6 |
| 6 | Netlify: publish only app files (move to `public/`), add security headers/CSP, retire Firebase Hosting | ½ day | #9 (exposure) |
| 7 | `git commit` everything today; tag every deploy; show a version number in the app | 1 hour | #9 |
| 8 | Enable Firestore scheduled exports / PITR, and keep the weekly JSON backup as a second copy | 1 hour | DR for #1–#3 |
| 9 | Move `stockMovs`, `insumosMovs`, `planificacion`, `analCostos` out of `_config` into per-record collections, with an `onSnapshot` on what remains | 3–5 days | #3, #8 |
| 10 | Escape all listed XSS sinks, make `escHtml`/`cotEsc` encode `'`, stop interpolating strings into inline handlers | 1–2 days | #7 |

Close runners-up: compute revenue without IVA (#10, 1 hour); double-submit guards on create/approve flows; debounce per-keystroke saves; `id→OT` maps for the O(n²) screens.

## What must be fixed before launch

"Launch" here means the shop retiring Excel and running all production from the system:
1. Improvements 1–5, 7 and 8 above (≈ 3–4 days of work).
2. Double-submit guards on quote/OT/remito creation and quote approval.
3. Revenue without IVA in `rBalMes`.
4. A plan for #9 (`_config` split) scheduled **before ~3 months of full use**.

## What can wait until after launch

- Modularisation (splitting `index.html`, a build step, real tests that load app code)
- Accessibility (currently zero ARIA/landmarks/focus management)
- O(n²) screens and asset diet (logos as files, minification)
- `docChanges()` in listeners and persistent local cache
- Multi-tenancy, invoicing/AFIP and receivables (only relevant if the product will be sold)
- UX polish (replace 155 `alert/confirm/prompt` with in-app dialogs)

## Changes vs 2026-09-16 (consolidated)

| | |
|---|---|
| **Improved** | Field-level `_config` saves (fixes cross-key lost updates); atomic numbering; single OT state machine (OTs now reach "entregada"); complete backup incl. pricing; guarded wipe; client/supplier `Map` indexes; list pagination; AI does full costing. |
| **Worse** | +23% code with no VCS; inline handlers 328→462; `window.*` globals 125→251; new unbounded writers in `_config`; undo feature that deletes others' records; price calculation now writes data (`cotMaqExtra` auto-repair); XSS surface grew (AI output reaches a raw sink); two live hosts. |
| **Unchanged** | Open rules / self-sign-up, open AI endpoint, client-side roles, whole-DB load per login, no automated tests of real code, bus factor 1. |
