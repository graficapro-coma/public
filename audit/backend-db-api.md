# Backend / Database / API Reliability Audit — Gráfica Pro

**Auditor role:** Acquisition due-diligence, backend/DB/API reliability. Evidence-based.
**Date:** 2026-09-16
**Scope:** Firestore persistence layer in `index.html`, `netlify/functions/interpretar.js`, `netlify.toml`, `firebase-config.js`, `firestore.rules`.
**Verdict up front:** There is essentially no backend. The browser is the database client, the business logic, and the transaction manager. Data integrity depends entirely on client-side code running correctly in every open tab. **Data/backend risk: HIGH.**

---

## 0. Architecture in one paragraph

The SPA (`index.html`) imports the Firebase Web SDK (v10.12.0) directly (line 183-185) and reads/writes Firestore from the browser. All app data lives under `/gp/**`: 8 collections are stored as per-document subcollections (`COL_KEYS`, line 201) and 22 keys as a single config blob `/gp/_config` (`BLOB_KEYS`, line 203). The only server-side code is one Netlify function (`interpretar.js`) that proxies a request to the Anthropic API to pre-fill a quote. There is no application server, no API gateway, no server-side validation of any write, no queue, no job runner, and no automated backup.

---

## 1. Data integrity & concurrency — client-side ID generation

**Two-tier ID scheme (index.html:696-742).**
- **Document ID** (Firestore key) = `uid()` (line 698-700): `Math.floor(Date.now()/1000)*1e6 + _uidSalt*1e3 + counter`, where `_uidSalt=Math.floor(Math.random()*1000)` (line 697). This is collision-*resistant* across users and is genuinely an improvement — two users creating records in the same second almost never collide.
- **Visible number** (`OT-0031`, `C1-0003`) = `nid()` / `nidCot()` (line 701-742) = **max-existing-number + 1**.

**The real defect: visible numbers race.** `nid()` computes `mx` = max visible number over the *locally loaded* array, then `i = Math.max(counter, mx+1)` (line 718). `nidCot()` does the same (line 738). Two users who both create an OT before each other's write has synced via `onSnapshot` will **both compute the same `mx` and both mint `OT-0032`**. The documents do not overwrite each other (distinct `uid()` doc IDs), so no data is lost — but the ERP now has **two different orders sharing one order number**, which for a print shop means duplicate work tickets, ambiguous client references, and broken lookups keyed on `num`. This is acknowledged obliquely in the code comment at line 694-695 ("El número VISIBLE ... sigue siendo secuencial"), i.e. the authors knew the doc ID was fixed but left the human-facing number racy.

**The persisted counter does not save you.** `S.ids[t]` is incremented and written via `sk('ids')` (line 719), but `ids` is a **BLOB_KEY** stored in `/gp/_config` with **last-write-wins** semantics (see §2). Concurrent increments are lost, so the counter cannot be trusted as a monotonic sequence; the code deliberately falls back to `mx+1`, which reintroduces the race. There is no Firestore-side counter, no `FieldValue.increment`, no transaction around number allocation.

**Fichas / clientes provisional.** `cotAFormal` (line 2319-2321) mints a provisional client with `uid()` then `sk('clientes')`; immediately after, `nidCot()` + `sk('cotizaciones')` — two independent writes (see §2). `genOT` (line 8267-8308) allocates `nid('ot')`, pushes the order, `sk('ordenes')`, then `crearFichaAuto` does a *separate* `sk('fichas')` (line 8085) and `nid` internally does `sk('ids')`. A single "generate OT" user action fans out to **3+ independent, non-atomic Firestore writes**.

**Score: 4/10.** Doc-level collision is handled; human-facing numbering is not, and the persisted sequence is corruptible.

---

## 2. Transactions / atomicity — none exist

**Evidence:** `grep writeBatch|runTransaction|transaction|.batch(` over `index.html` → **0 matches**. The Firebase SDK import (line 184) never pulls in `writeBatch` or `runTransaction`.

**`sv()` for collections (line 219-252)** is a sequential loop of individual `await setDoc(...)` (line 247) and `await deleteDoc(...)` (line 231) calls. There is no batch and no transaction. If the network drops, the tab is closed, or `setDoc` throws mid-loop, the write is **partially applied**: some documents saved, some deletes done, some not. The local `_docJson` write-cache (line 237-249) is only updated *after* a successful `setDoc`, so a mid-loop failure also leaves the cache inconsistent with Firestore for the un-written items.

**`sv()` for blobs (line 253-258)** does read-modify-write on `/gp/_config`: `getDoc` → mutate `data[k]` → `setDoc(whole doc)`. This is a **classic lost-update race**: two tabs read `_config`, each mutates a different key, each writes the whole document back — the second write clobbers the first tab's key. All 22 BLOB_KEYS (prices `cotPapeles/cotImpresion/cotChapas`, `ids`, `planificacion`, `stockPapel`, `insumosItems`, ...) share this single hot document, maximizing contention.

**Failure surfacing (line 169-180, 291-300).** On any `sv` throw, `sk()` calls `showSaveError(k, S[k])` which shows a "Reintentar" link and stashes `window._pendingSave`. Retry re-runs the *whole* `sv` for that key. There is no automatic retry, no exponential backoff, no offline queue (Firestore offline persistence is **not** enabled), and only **one** pending save is remembered — a second failure on a different key overwrites `_pendingSave` and the first is silently forgotten. Many call sites swallow the error into `showSaveError` and return, so the user may not notice a lost write beyond a transient red chip.

**Score: 2/10.** No atomicity anywhere; multi-doc user actions are non-transactional; blob read-modify-write is inherently racy.

---

## 3. Schema / migrations — ad-hoc, unversioned, run in the client on every load

**Evidence:** `migrarPreprensa2Etapas()` (569), `migrarPasos9()` (590), `migrarAprobarExistentes()` (611), `migrarDatos()` (630), plus inline "migrations" in `iniciarSinMigrar()` (line 557, 560). Guarded by ad-hoc flags stored in the blob: `S.ids._migTipos`, `_migEstructuras`, `_migAprobOT` (line 557, 560, 612), `_migTipos`.

- There is **no schema version number** on documents. `descargarBackup` writes `_version:1` (line 2945) but nothing reads it; `restaurarBackup` ignores it (line 3017 only checks `_app`).
- Migrations run **in the browser at login** (`iniciarSinMigrar` → `migrarPreprensa2Etapas/Pasos9/AprobarExistentes`, line 562-564). `migrarPasos9` mutates every order's `pasos` and calls `sk('ordenes')` (line 608). If two users with **different app versions** (one tab cached an older `index.html`) open concurrently, they run different migration logic against the same live data → **divergent data shapes** written back. There is no gate preventing an old client from writing.
- Migration idempotency relies on regex/flag heuristics, not on a recorded applied-migrations ledger. `migrarAprobarExistentes` uses `S.ids._migAprobOT` (line 612) — but because `ids` is a lost-update blob (§2), the flag can be dropped and the migration can re-run.
- `migrarDatos()` (630) copies from the legacy `graficapro` collection with per-key `sv()` (line 648) — non-atomic; a failure mid-migration (line 653 just logs `⚠ error`) leaves a half-migrated database and still proceeds to `iniciarSinMigrar()` after 2s (line 656).

**Score: 3/10.** Functional for a single controlled user, but no versioning, no applied-migrations ledger, and old clients can corrupt shape.

---

## 4. Backups / Disaster Recovery — manual, browser-only, and INCOMPLETE

**Evidence:** `descargarBackup()` (2942), `restaurarBackup()` (3010). No Firestore scheduled export, no `gcloud firestore export`, no PITR configuration anywhere in the repo (`firebase.json`, `netlify.toml` contain none).

- The **only** backup is a human clicking "Copia de seguridad", which builds an in-memory JSON `Blob` and triggers a browser download (line 2952-2957). Recovery = a human running `restaurarBackup()` from the dev console (line 3009 comment) and picking a file. There is no offsite automation, no retention policy, no integrity check, no encryption of the file.
- **The backup is incomplete — this is a data-loss trap.** `descargarBackup` (line 2944-2950) serializes only: `clientes, proveedores, cotizaciones, ordenes, remitos, fichas, gastos, planificacion, analCostos, recursosAnal, maquinas, externos, fletes, procesos, stockPapel, stockMovs, ids, tiposTrabajo`. Compared to `COL_KEYS` + `BLOB_KEYS` (line 201-203), the backup **OMITS**: `cotTrabajos` (the costeos / cost-estimation records — a COL_KEY), `cotPapeles, cotImpresion, cotChapas, cotLaminados, cotOtros, cotConfig` (the entire pricing catalog that drives every quote), `cotEstructuras`, `insumosItems, insumosMovs` (inventory), and `vendedores`. A restore from this "backup" would **silently wipe the pricing engine and inventory** because `restaurarBackup` (line 3020-3022) also only iterates that reduced `cols` list — the omitted keys are neither saved nor restored, and after `location.reload()` (line 3023) the app re-seeds defaults over whatever survived.
- The `_lastBackup` reminder (line 2960, 2967-3007) nudges weekly, but "weekly manual JSON, minus the pricing tables" is not a DR strategy. RPO = up to 1 week of *partial* data; RTO = manual and lossy. There is no tested restore path.

**Score: 2/10.** A partial, manual, un-tested export is being treated as backup/DR. Firestore's own managed durability exists, but nothing is exported out of the single project, so a fat-finger `wipeDatos` (line 3031) or a bad rules deploy is unrecoverable beyond the last incomplete JSON.

---

## 5. Realtime sync conflicts — last-write-wins with a timing hack

**Evidence:** `activarSincronizacion()` (482-540) attaches `onSnapshot` listeners on 6 collections (`clientes, proveedores, cotizaciones, ordenes, fichas, gastos`, line 487).

- On a remote change the handler **replaces the entire local array**: `S[k]=dcs` (line 506). There is no field-level merge and no per-record conflict detection. If User A edits order X's `notas` and User B toggles a `paso` on the *same* order X, both hold the full item object; whichever `setDoc` lands last writes its whole object and **silently discards the other user's field edit** (lost update at document granularity). No `updatedAt`/version field exists to detect this.
- The "anti-pisada" logic (line 469-533) is a **heuristic timing patch, not correctness**: it suppresses snapshots while `_saveEnCurso[k]>0` or within 2000ms of the last local save (line 516-517), deferring by 2200ms (line 522-529). This narrows — but does not close — the window where a stale snapshot reverts a just-made local change (the code comment at line 514-515 admits the "paso ... se desmarca" symptom it was patched to fix). Under sustained concurrent editing or clock skew, edits can still flip-flop.
- Only 6 of 8 collections sync in realtime; `remitos` and `cotTrabajos` are in `COL_KEYS` but **not** in `COLS_SYNC` (line 487 vs 201) — a second user won't see new remitos/costeos until reload, and a save there overwrites without ever having seen the other user's concurrent record.
- `_config` blob has **no** onSnapshot; blob changes (prices, counters, stock) never propagate live and are subject to §2's lost-update on the next save.

**Score: 3/10.** Best-effort LWW with a fragile debounce; guaranteed lost updates on co-edited documents; two collections and all config not synced.

---

## 6. API reliability — the single Netlify function (`interpretar.js`)

**Model config.** `const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'` (line 11). **`claude-sonnet-5` is not a valid Anthropic model ID.** If `ANTHROPIC_MODEL` is unset in Netlify, every request 4xx/404s at the API and returns a 502 "Error de la IA" (line 92). The whole feature is one missing env var away from being dark, with no health check to detect it.

**No auth / open to abuse.** CORS is wide open (`Access-Control-Allow-Origin: '*'`, line 5) and the handler performs **no** verification of a Firebase ID token or any shared secret. Anyone who discovers the endpoint URL can POST to it and **spend the company's Anthropic credits** (each call is up to `max_tokens: 8000` plus up to 4 images, line 82/21). There is **no rate limiting, no quota, no per-IP throttle, no abuse detection** — a trivial cost-DoS.

**No timeout / cold-start exposure.** The `fetch` to Anthropic (line 78) has **no timeout / AbortController**. `netlify.toml` sets no function timeout, so the synchronous default (~10s) applies. A multi-image request with 8000 output tokens routinely exceeds 10s → Netlify kills the invocation and the client gets a 502/504 with no partial result. Cold starts add seconds on top. No streaming.

**No retries / no idempotency.** Single `fetch`, no retry on 429/500/network blip (line 78-91). No idempotency key — a client retry re-runs a full (billable) inference.

**Payload limits.** `pedido` is capped at 8000 chars (line 15) and images at 4 (line 21) with a media-type allowlist (line 18-20) — good. But there is **no cap on total base64 size**; 4 large images can exceed Netlify's ~6MB request body limit → the function 413s/502s before any validation runs. No `Content-Length` check.

**Error handling / status codes.** Reasonable surface: 204 OPTIONS (6), 405 (7), 500 missing key (10), 400 bad JSON/empty (14/22), 502 upstream (92/94), 500 catch-all (97). Uses tool-use for structured output (line 42-95) — a genuine strength. But error bodies leak raw upstream messages (line 92) and `String(e.message)` (line 97) to the client.

**Observability.** **None.** No structured logging, no request IDs, no metrics, no alerting. The only "logs" are the default Netlify console. There is no way to know the function is failing except users complaining.

**Score: 4/10.** Clean request shaping and structured output, but wrong default model, zero auth, zero rate limiting, no timeout/retry/observability, and single-vendor with no fallback.

---

## 7. Security-adjacent data-integrity note (in scope for DR)

`firestore.rules` (line 22-24) requires only `request.auth != null`; the company-email restriction is **commented out** (line 23). The header comment (line 12-13) admits that **without these rules published, anyone with the apiKey — which is shipped in `firebase-config.js` (line 2) — can read and delete the entire database.** Whether the rules are actually deployed cannot be verified from the repo. If not deployed, DR risk escalates from HIGH to CRITICAL, because any anonymous client can `deleteDoc` every record and the only recovery is the incomplete weekly JSON.

---

## Rubric

| # | Criterion | Score /10 | Basis |
|---|-----------|-----------|-------|
| 1 | Data integrity & concurrency (ID generation) | **4** | Doc IDs safe via `uid()` (698); visible `OT`/`C` numbers race via max+1 (718/738); persisted counter is a lost-update blob |
| 2 | Transactions / atomicity | **2** | Zero batches/transactions; `sv` loops individual setDoc/deleteDoc (219-252); blob read-modify-write race (253-258); 1-slot retry |
| 3 | Schema / migrations | **3** | Client-run, unversioned migrations (569-657); flags in a lossy blob; old clients can write divergent shapes |
| 4 | Backups / DR | **2** | Manual browser JSON only; **omits pricing catalog, costeos, inventory** (2944-2950); no automated export, no PITR, untested restore |
| 5 | Realtime sync / conflicts | **3** | Whole-array LWW (506); guaranteed lost updates on co-edited docs; timing-hack debounce (516-529); 2 collections + all config unsynced |
| 6 | API reliability (Netlify fn) | **4** | Wrong default model (11); no auth/rate-limit/CORS lockdown (5); no timeout/retry/observability; single vendor |
| 7 | Access control affecting durability | **3** | Rules require only auth, email filter commented out (rules:23); apiKey public; deploy status unverifiable |

**Overall: 3/10** (weighted toward atomicity, backups, and concurrency, which are the load-bearing failures for an acquisition).

---

## Top risks blocking approval

1. **No backup of the pricing engine, costeos, or inventory (CRITICAL data loss).** `descargarBackup` (index.html:2944-2950) omits `cotTrabajos`, `cotPapeles/cotImpresion/cotChapas/cotLaminados/cotOtros/cotConfig`, `cotEstructuras`, `insumosItems/insumosMovs`, `vendedores`. `restaurarBackup` (3020) restores the same reduced set, so a "restore" **wipes** the entire quoting catalog and inventory. Combined with no automated Firestore export and a live `wipeDatos()` (3031), there is no reliable recovery path.
2. **No atomicity anywhere (index.html:219-258, grep: 0 batches/transactions).** Multi-document user actions (generate OT → orders + fichas + ids = 3+ separate writes) can partially fail, leaving orphaned/inconsistent records. The `_config` blob's read-modify-write silently loses concurrent edits to prices, counters, and stock.
3. **Serverless function is unauthenticated, uneven-configured, and unmonitored (interpretar.js:5,11,78).** Open CORS + no auth + no rate limit = anyone can drain Anthropic credits; the default model `claude-sonnet-5` is invalid; no timeout/retry/observability means silent, unrecoverable outages. Duplicate visible `OT`/`C` numbers under concurrency (nid 718 / nidCot 738) is a secondary but real integrity bug.

---

## Quick wins (days)

- **Fix the backup completeness bug** first: add the missing keys to both `descargarBackup` (2944) and `restaurarBackup` (3020), or drive both off `COL_KEYS`+`BLOB_KEYS`. Untested restores are worse than none.
- **Enable a scheduled Firestore export** (Cloud Scheduler → `gcloud firestore export` to a GCS bucket) for real, offsite, automated backups with retention. This alone moves DR from HIGH toward MEDIUM.
- **Lock down `interpretar.js`:** require a Firebase ID token (verify server-side), restrict CORS to the app origin, add a per-IP/day rate limit, add an `AbortController` timeout (~9s) and a single retry on 429/5xx. Set `ANTHROPIC_MODEL` to a valid ID and remove the `claude-sonnet-5` fallback (fail loudly instead).
- **Allocate visible numbers with a Firestore transaction** on a dedicated counter doc (`runTransaction` + `FieldValue.increment`) to eliminate duplicate `OT`/`C` numbers.
- **Publish and verify `firestore.rules`** and uncomment the company-email restriction (rules:23); confirm deploy in CI.
- **Enable Firestore offline persistence** and a durable retry queue so `showSaveError` (169) is not the last line of defense against a lost write.

## Deeper refactors (weeks–months)

- **Introduce a thin backend / callable Cloud Functions** for all writes that mutate shared invariants (number allocation, OT/ficha creation, stock movements). Move these into `runTransaction` so a "generate OT" is one atomic unit, and enforce server-side validation instead of trusting the browser.
- **Add document versioning + optimistic concurrency** (`schemaVersion`, `updatedAt`, `rev`): reject stale writes, do field-level merges on `onSnapshot`, and stop replacing whole arrays (index.html:506). Sync all 8 collections, not 6.
- **Version and gate migrations** with an applied-migrations ledger stored server-side, and block out-of-date clients from writing (min-supported-version check at login).
- **Decompose the `_config` mega-blob (203)** into per-key documents to remove the single hot-doc lost-update contention, or move counters/prices behind transactional functions.
- **Add observability**: structured logs + request IDs in the function, error tracking (Sentry), and Firestore usage/quota alerts. Introduce a graceful-degradation path if Anthropic is down (the quote pre-fill should be optional, never blocking).

---

*Constraint honored: no production code was modified; this report is the only artifact written.*
