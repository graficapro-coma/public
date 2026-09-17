# Gráfica Pro — Production-Readiness / Acquisition Audit

**Date:** 2026-09-16
**Method:** 6 independent expert reviews (architecture, security, performance, backend/DB/API, frontend/UX, product/launch). Each scored a rubric 1–10 against the actual code in `index.html`, `netlify/functions/interpretar.js`, `netlify.toml`, `firebase-config.js`, `firestore.rules`, `tests/pruebas.js`.
**Lens:** A skeptical buyer/investor looking for reasons *not* to buy. Deliberately harsh.

---

## Executive summary

Gráfica Pro is a **working, genuinely useful print-shop ERP** that COMA's team is productive with. It covers quoting, work orders, production tracking, planning, paper/stock, an AI order-interpreter, and a capacity dashboard. There is real craft in places (incremental Firestore writes, a save-retry path, input sanitization, pinned dependencies, a real login).

But judged **as a tradeable asset**, it is not close to ready. The value lives in the owner's domain knowledge, not in transferable, defensible software. It is one **~8,600-line HTML file** with no modules, no build, no meaningful test coverage, **one author, and a single git commit**. Authorization is cosmetic (a regex on the user's own email + CSS hiding), the AI endpoint is an open denial-of-wallet, the "backup" silently omits the entire pricing catalog, and the whole security model depends on Firestore rules that **could not be verified as deployed** (`firestore.rules:23` has the tenant filter commented out). It is hardcoded to a single company, so it cannot be resold without a rewrite.

### Domain scores

| Domain | Score /10 | Risk |
|---|---|---|
| Architecture / maintainability | 3.0 | High |
| Security / auth / data protection | 3.5 | High (Critical if rules undeployed) |
| Performance / scalability | 4.0 | High (at scale) |
| Backend / database / API reliability | 3.0 | High |
| Frontend / UX / state management | 3.5 | High |
| Product / business risk / launch readiness | 3.4 | No-Go (as acquisition) |

### Overall purchase-readiness: **3 / 10**

### Recommendation: **NO-GO as an acquisition / product.**
As a tradeable asset it is a rewrite carrying a bus-factor of one, cosmetic access control, an open billing liability, and unverified data-confidentiality controls. **However**, the same evidence supports a clear **GO for COMA's continued internal use** — provided the six "must-fix before launch" items below are closed first, because two of them (Firestore rules, backup completeness) are live risks of data breach and data loss *today*.

### Risk levels
- **Technical debt: HIGH** (borderline Critical — single-file monolith, no build, no real tests)
- **Security: HIGH** (→ **CRITICAL** if Firestore rules are not deployed as strict)
- **Performance: HIGH at scale** (acceptable at today's ~4-user, low-record volume)
- **Maintainability: HIGH**

---

## Top 10 critical issues (ranked by severity)

1. **Firestore security rules unverifiable / possibly open — CRITICAL.** Browser writes directly to Firestore with a public project config (`index.html` `ld`/`sv` L205–259); `firestore.rules:23` has the company-email restriction **commented out**. If default-open or undeployed, all client PII, CUITs, prices and financials are world-readable/writable. This alone blocks any deal.
2. **Backup omits the pricing engine & restore wipes it — CRITICAL data loss.** `descargarBackup` (`index.html:2944-2950`) excludes `cotTrabajos`, `cotPapeles/Impresion/Chapas/Laminados/Otros/Config`, `cotEstructuras`, `insumosItems/Movs`, `vendedores`. `restaurarBackup` (`~3020`) restores the reduced set, so a "restore" **deletes the entire quoting catalog**. A live `wipeDatos()` (`~3031`) still exists.
3. **No real authorization — HIGH/Critical.** Roles are a client-side regex on the user's own email (`puedeVerFinanzas()` `index.html:670`) enforced only by CSS `display:none` (`674`) and `alert()+return` in `nav()` (`2870`). Trivially bypassed from DevTools; any logged-in user can read/write finance data.
4. **Open, unauthenticated AI endpoint (denial-of-wallet) — HIGH.** `netlify/functions/interpretar.js:5` — `Access-Control-Allow-Origin:'*'`, no auth, no rate limit, up to 4 base64 images with no size cap, `max_tokens:8000`. Anyone on the internet can burn the Anthropic key and inflate the bill.
5. **Zero atomicity / no transactions — HIGH.** No `writeBatch`/`runTransaction` anywhere; `sv()` loops individual `setDoc`/`deleteDoc` (`index.html:219-252`) and the `_config` blob does racy read-modify-write (`253-258`). Generating an OT fans out to 3+ non-atomic writes → orphaned/partial records on failure.
6. **Client-side ID generation (max+1) collides under concurrency — HIGH.** `nid` (`~718`) / `nidCot` (`~738`) compute the next number from existing max. Two users creating a cotización/OT at once produce duplicate visible numbers and cross-linked records (a class of bug already hit and patched once this project).
7. **Attribute-context XSS — HIGH.** ~74 `innerHTML` sinks; the save-time sanitizer strips only `<>` not quotes (`index.html:283`); non-whitelisted fields (CUIT, email, phone) are interpolated raw into `href`/attributes (`~4879-4880`). XSS inside a finance session = full compromise given client-only roles.
8. **Single-file monolith, no build, no modules — HIGH (maintainability / key-person).** One ~8,600-line `index.html`, ~555 global functions, no `package.json`/lockfile, state spread across ~30 loose `let`s + ~125 `window.*` refs. No safe seam to change or extend; one author.
9. **No server-side pagination + full-collection in memory + full re-render — HIGH (scaling ceiling).** `ld()` (`209-211`) `getDocs` the whole subcollection with no `limit`; `cargarDatos` (`435-437`) loads all 8 collections at login; `onSnapshot` (`492-512`) `JSON.stringify`s entire arrays then triggers a full `#pg` `innerHTML` rebuild on every write for every client.
10. **No safety net — HIGH (ops/business).** Silent `catch(e){}` on a system of record; no monitoring/error tracking; no automated Firestore backup (manual JSON only); deploy-straight-to-prod; a single git commit makes "rollback" hollow; tests (`tests/pruebas.js`) re-implement `uid/sanTxt/_pagina/save` inline and never exercise the shipped code.

*Not in the top 10 but material:* single-tenant hardcoding (COMA identity, fleet names `['Coma','Edu','Walter','Torreflet']`, `projectId:"graficapro-coma"`) — the #1 blocker specifically for *resale*; zero accessibility (WCAG AA fail — `aria/role/tabindex` = 0 matches); `rCapacidad` calls `capMetricas` twice per machine with per-block `S.ordenes.find` (quadratic).

---

## Top 10 improvements (ranked by ROI)

| # | Improvement | Effort | Payoff |
|---|---|---|---|
| 1 | **Deploy & verify strict Firestore rules** (require auth; restrict to company; least-privilege per collection) | Low | Closes the single biggest data-breach risk |
| 2 | **Fix backup/restore to include ALL `COL_KEYS`+`BLOB_KEYS`** and block `restaurarBackup` from deleting unlisted collections | Low | Prevents catastrophic, silent loss of the pricing catalog |
| 3 | **Lock down the AI function**: verify a Firebase ID token, cap total payload size, add rate limiting, lower `max_tokens` | Low–Med | Ends denial-of-wallet + latency |
| 4 | **Automated scheduled Firestore export** (daily) to a bucket | Low | Real disaster recovery, PITR-ish |
| 5 | **`onSnapshot` → `docChanges()`** and drop the full-array `JSON.stringify` diff | Low | Removes per-write CPU spikes; fewer full re-renders |
| 6 | **Escape quotes / attribute contexts** (or use `textContent`) in render sinks | Med | Removes the practical XSS path |
| 7 | **Move ID allocation to a Firestore transaction / counter doc** (or push-ids) | Med | Eliminates concurrency collisions |
| 8 | **Add a build/minify step** (esbuild) + long-cache hashed asset | Low | Cuts ~450–500 KB initial payload materially |
| 9 | **Wrap OT/ficha creation in `writeBatch`** | Med | Atomic multi-doc writes; no orphans |
| 10 | **Add error tracking (e.g. Sentry) and stop silent `catch{}`** | Low | Visibility into the state-divergence failures |

---

## What must be fixed **before launch** (non-negotiable)

1. **Firestore rules deployed and verified strict** (issue #1). Until proven, assume the database is open.
2. **Backup/restore completeness + automated backups; remove/guard `wipeDatos()`** (issue #2).
3. **AI endpoint auth + rate limit + payload cap** (issue #4).
4. **ID-collision fix** for cotización/OT numbers under concurrency (issue #6).
5. **XSS attribute escaping** on any user-entered field rendered into HTML (issue #7).
6. **Basic monitoring + a real rollback path** (tag releases; keep >1 deploy of history) so failures are visible and reversible (issue #10).

## What can wait **until after launch**

- Refactor the single file into modules with a build step (issue #8) — high value, but not a live risk.
- Full accessibility remediation (WCAG) — important for a product, low urgency for 4 internal users.
- Server-side pagination, list virtualization, incremental rendering (issue #9) — needed only as records grow into the thousands.
- Replacing the test suite with tests that exercise the shipped code.
- Multi-tenancy / de-hardcoding COMA — only relevant if the app is ever resold.

---

## Reports in this folder
- `architecture.md` — structure, maintainability, build/deploy
- `security.md` — auth, authorization, data protection, XSS, secrets
- `performance.md` — load, render model, scaling, hot loops
- `backend-db-api.md` — Firestore usage, atomicity, backups, the Netlify function
- `frontend-ux.md` — state management, rendering, accessibility, UX
- `product-launch-readiness.md` — business risk, resale value, bus factor, launch ops
- `action-plan.md` — sequenced remediation plan with owners/effort
