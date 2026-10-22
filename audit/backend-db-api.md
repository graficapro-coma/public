# Backend / Database / API Reliability Audit: Gráfica Pro

**Auditor role:** Acquisition due diligence covering backend, database and API reliability. Every finding is backed by evidence.
**Date:** 2026-10-02 (supersedes the 2026-09-16 audit)
**Scope:** The Firestore persistence layer in `index.html` (10,381 lines, about 1 MB), `netlify/functions/interpretar.js`, `firestore.rules`, `firebase.json`, `netlify.toml` and `tests/pruebas.js`. I also checked referential integrity against the most recent real backup the app produced (`..\bkup\GraficaPro_backup_2026-10-01_1344.json`). I only computed counts and sizes from it and copied no customer data.
**Method:** Static reading of the code with line references, plus integrity queries on the backup. I did not modify any code.

**Verdict:** Risk is still **HIGH**. Since 2026-09-16 three things have improved: visible numbers come from a transactional counter, the backup now covers every key, and `_config` is written per field. The core design has not changed. The browser is still the only transaction manager, and records are still replaced whole with last-writer-wins. This pass also found a new class of bugs. Some client-side features (Undo, Reintentar, restore, the first save of a session) write a stale local array back to Firestore. Because deletions are computed from a local "known ids" set, those writes can **delete or revert other users' records**. The real backup shows the integrity problems are already happening: 9 of 13 fichas point at OTs that no longer exist, and the two seed demo OTs ("Estuches ejemplo 3000u", "Cajas packaging 500u", dated 2024) are stored in production, linked to client ids that do not exist and auto-approved "por: migración".

---

## 0. Architecture recap (what changed)

- The SPA talks to Firestore directly (SDK 10.12.0, `index.html:184`). The import now includes `updateDoc` and `runTransaction` (`:184`, `:193`, `:197`).
- `COL_KEYS` (`:203`) holds 8 collections with one document per record under `gp/{k}/docs/{id}`, in the form `{v: record}`.
- `BLOB_KEYS` (`:205`) holds 23 keys, all stored as fields of a single document, `gp/_config`.
- A new document, `gp/_counters`, holds the visible-number counters and is updated in a transaction (`:736-757`).
- The only server code is still `netlify/functions/interpretar.js`. There is no Cloud Function, no server-side validation, no scheduled export and no write queue.

---

## 1. Rubric

| # | Criterion | Score (2026-09-16 → now) | Evidence summary |
|---|---|---|---|
| 1 | Multi-user concurrency and realtime sync | **3 → 3** | Records are replaced whole with last-writer-wins (`sv` `:242-251`). `_config` has **no listener**, so stock, plan and prices go stale for the whole session. Undo, Retry and the first save can resurrect or delete other users' data (§3.1-3.4). |
| 2 | Atomicity and transactions | **2 → 3** | Number allocation is now in `runTransaction` (`:740-747`). Everything else is still non-atomic. Stock balance and stock ledger are written as two separate writes (`:5341`). Failed deletes are swallowed and never retried (`:233`). |
| 3 | Data integrity (referential, denormalization, idempotency) | **n/a → 2** | The real data has orphans and seed rows. There are no guards against double submits. Stock can go negative or create phantom rows. OT↔costeo links are joined on description text (§3.5-3.10). |
| 4 | Schema, validation and migrations | **3 → 3** | No schema version on records. Migrations run on login, and their flags live in `ids`. If the read of `_config` fails, a destructive cascade follows (§3.3). The rules validate nothing. |
| 5 | Backup, restore and disaster recovery | **2 → 4** | The backup now covers every key and is built dynamically (`:4190-4191`). It is still manual and taken from in-memory state that can be stale or partial. Restore does no shape validation, reports success even when writes fail, and has undefined replace-vs-merge semantics (§3.11). There is still no automated export. |
| 6 | Error handling and observability | **n/a → 3** | `sk()` never rethrows (`:312-314`). Retry is a single slot. Many `catch(e){}` blocks are silent (`:233`, `:3069`, `:5073`). The transactional counter falls back silently to the racy counter (`:749-756`). There is no telemetry. |
| 7 | API contract (`interpretar.js`) | **4 → 4** | Uses structured tool output (good). Still has no auth, open CORS, no timeout, no retry, does not check `stop_reason`, accepts an unbounded `contexto`, and returns raw upstream error text (§3.12). |
| 8 | Verification and tests | **n/a → 2** | `tests/pruebas.js` tests *copies* of functions rather than the code in `index.html` (for example `uid` is redefined at `pruebas.js:14`). There are no tests for `sv`, sync, stock or counters. The file was last modified on 2026-07-12. |

**Overall score: 3 / 10. Risk level: HIGH.** This is not approvable as a multi-user system of record. It is acceptable only as a single-operator tool backed by disciplined manual backups.

---

## 2. Verification of the recent fixes

| Fix claimed | Verdict | Evidence and remaining gap |
|---|---|---|
| Lost-update race in `sv()` for `_config` fields | **Partially fixed** | `sv` now calls `updateDoc(ref,{[k]:cleanV})` (`:259-267`), falling back to `setDoc(...,{merge:true})` on `not-found` (`:265`). That is correct, and it removes the **cross-field** race (for example stockPapel and stockMovs no longer overwrite each other). It does **not** fix the **same-field** race. Each field is a whole array or object (`stockPapel`, `stockMovs`, `planificacion`, `analCostos`, `cotPapeles`…) written from a client copy that is never refreshed, because `_config` has no `onSnapshot` (grep: `'_config'` only at `:215` and `:258`). The legacy read-modify-write branch (`:268-273`) is dead code because `_fsUpdate` is always set. |
| OTs never reached 'entregada' | **Fixed** | `recomputeEstadoOT` (`:4913-4922`) now returns `'entregada'` when the `ent` step is `done`, before evaluating "lista". |
| `corteRegistrar` undefined variable | **Fixed** (the crash) | `:5374-5415` is coherent, and `delta = cut - prev` makes repeating the same value idempotent. New issues remain in the same function (§3.8): no guard against negative stock, phantom rows when keys differ, a negative delta posted to the wrong item, and `autoPlanReal` filling several days. |
| Remito button | **Fixed** (prefill) | `mNREM` (`:9225`) prefills the client, OT, address and detail. `savRem` (`:10370`) still allows double submits (it awaits `nid` before pushing), stores only the `otNum` string (no `otId` link), and does not touch the OT's Entrega step. |
| Multi-piece OT generation losing a machine | **Fixed for the default path, still open for grouped pieces** | `chCot` now sends multi-piece quotes to the distribution modal (`:10188-10190`). But `confirmarDistribucionOTs` keeps **only the first machine per OT group** (`if(!grupos[nroOT].maq&&maq)grupos[nroOT].maq=maq;`, `:8618`) and assigns only `'Impresión ('+g.maq+')'` (`:8638`). If a user puts the tapa (SM52) and interior (SM74) into the same OT, the second machine is dropped again. These OTs also lack `vendedor` (`:8644-8653`, while `genOT` sets it at `:10252`). |

---

## 3. Findings (ranked within section by severity)

### 3.1 CRITICAL: "Deshacer" (Undo) deletes and reverts other users' records
- **Where:** `index.html:9847` (undo wrapper around `sk`: `window.doUndo`, `__undoShadow`, `__undoSnapshotBaseline`) together with `sv` deletion logic `:229-235` and snapshot `aplicar` `:521-528`.
- **Mechanism:** Undo restores `S[k]=e.prev`, which is a whole-collection clone taken at the user's previous save, and calls `sk(k)`. When the snapshot listener applies remote changes, it sets `_knownIds[k]` to the full remote id set (`:524`), but it does not refresh `__undoShadow` (that only happens when the shadow is empty, `:9847`). `sv` then deletes every id in `_knownIds` that is missing from the array being written (`:231-234`).
- **Scenario:** User A ticks a step on OT-0031 (the shadow now lacks OT-0040). User B creates OT-0040, and A's listener applies it. A clicks "Deshacer". The array written is `prev` (without OT-0040), so `deleteDoc(gp/ordenes/docs/<OT-0040>)` runs. **B's order is deleted from the database.** Every other record that changed since A's snapshot is also rewritten with A's old copy, because the cache JSON differs, which reverts B's edits. Undo also never reverses side effects (fichas, stock, planificacion), which leaves orphans.

### 3.2 CRITICAL: "Reintentar" after a save error can delete other users' records
- **Where:** `showSaveError` `:169-175` stores `window._pendingSave={k,v}` where `v` is the **array reference at failure time**. `retrySave` `:176-180` calls `sv(k,_pendingSave.v)`.
- **Scenario:** A save of `ordenes` fails on a network blip. While the red chip is visible, a snapshot replaces `S.ordenes` and `_knownIds.ordenes` with newer data. The user clicks Reintentar, which writes the **old** array, and `sv` deletes every record created since. The single slot also means a second failure on another key silently drops the first one.

### 3.3 CRITICAL: A failed or slow initial load triggers destructive writes (seed, auto-approval, overwritten config)
- **Where:** `cargarDatos` `:452-453` runs each `ld()` against an 8 s `Promise.race` timeout, and on timeout or error the result is `null`, so the in-memory default is kept. `ld` swallows errors (`:218`). `iniciarSinMigrar` `:558-584` then runs.
- **Cascade if `_config` cannot be read** (23 parallel `getDoc` calls of the *same* document, `:215`):
  1. `S.ids` stays at its default, so `_migTipos`, `_migEstructuras` and `_migAprobOT` are absent.
  2. `:573` writes `tiposTrabajo` (defaults) and `ids` (defaults), which **overwrites `_lastBackup` and the migration flags**.
  3. `:578` overwrites `cotEstructuras` with the factory seed if it is also empty, **destroying user-edited families**.
  4. `migrarAprobarExistentes` `:629-636` **auto-approves every unapproved OT** with `por:'migración'`. That bypasses the approval lock that gates paper purchasing, and the result is persisted with `sk('ordenes')`.
  5. Any later edit of a price table writes the default empty array for that key (`updateDoc` replaces the field), **wiping the paper or printing price catalog**.
- **If `clientes` times out:** `seed()` (`:579`, `:787-843`) loads demo clients, OTs (ids 1 and 2), gastos and a demo ficha (id 1) into memory. `migrarPreprensa2Etapas` matches the seed's `'Preprensa'` step (`:590`) and calls `sk('ordenes')`, which writes the demo OTs to `gp/ordenes/docs/1` and `/2`.
- **Evidence this already happened:** The 2026-10-01 backup contains `OT-0001` "Estuches ejemplo 3000u" (id 1, 2024-06-01) and `OT-0002` "Cajas packaging 500u" (id 2). Both have `clienteId` 2 and 3, and **no client with id ≤ 3 exists**. Both have `aprobadaOT.por='migración'`. They were already present in the 2026-09-17 backup. The real ficha "OT-0002" (cotNum C-0002) now shares its visible number with the demo OT.

### 3.4 HIGH: Saved arrays are never refreshed, so the first save of a session rewrites every document, and the first delete in each collection is lost
- **Where:** `_docJson` and `_knownIds` are only filled inside `sv` (`:239-254`) or in snapshot `aplicar` (`:523-527`). `cargarDatos` never seeds them. The initial snapshot usually equals local state, so the listener returns early at `:514-519` **without seeding them**.
- **Consequence A (lost delete):** In a fresh session, `delCli`/`delProv`/`delCot`/`delOT`/`delRem` (`:10518-10564`) filter `S[k]` and call `sk`. In `sv`, `prevIds` is an empty Set, so **no `deleteDoc` is issued**. The record disappears from the screen and comes back on the next reload. Afterwards `_knownIds` is set, so a second delete works. The behaviour is intermittent, which makes it hard to diagnose.
- **Consequence B (revert):** For `remitos` and `cotTrabajos`, which are **not** in `COLS_SYNC` (`:503`), the first save of the session rewrites **every** document from the copy loaded at login. Example: A logs in at 09:00, B edits costeo Z at 10:00, and A saves any costeo at 11:00 (`cotGuardar` `:2989`). Z is reverted to its 09:00 version. The same rewrite costs N sequential `setDoc` calls, which is a quota risk.
- **Consequence C:** Failed deletes are swallowed (`try{await deleteDoc}catch(e){}`, `:233`), yet `_knownIds[k]=newIds` (`:254`) is still set, so the delete is never retried.

### 3.5 HIGH: `_config` arrays are shared state with no sync, so stock, ledger and production plan suffer last-writer-wins
- **Where:** `stockMov` `:5333-5343`, manual adjustment `:5480-5481`, `autoPlanReal` `:9364-9395`, the 15 `sk('planificacion')` call sites (`:9339-9680`), and `analCostos` writes (`:5389`, `:5406`, `:7263-7298`).
- **Scenario (stock):** The guillotine operator logged in at 07:00, so their `S.stockPapel` and `S.stockMovs` are frozen at 07:00. At 10:00 the buyer receives 5,000 sheets: `stockEntrada` runs and the ledger gets a row. At 11:00 the operator registers a cut, and `stockMov` writes the operator's **07:00 arrays plus one change**. **The 10:00 receipt disappears from both the balance and the ledger.** Nothing detects or logs this.
- **Scenario (plan):** The planner reschedules SM74 for the week. An operator who logged in earlier marks a block "hecho" (`:9486`), which writes their entire stale `planificacion` object and reverts the reschedule for **all machines**.
- **Growth time bomb:** All 23 keys share one document with Firestore's 1 MiB limit. Today it is about 40 KB (measured from the backup; `stockMovs` is empty and `planificacion` is 1 KB). `stockMovs`, `insumosMovs`, `planificacion` (including multi-day auto blocks, §3.8) and `analCostos` grow without bound, and nothing prunes them. A stock row is about 250 B, so roughly 3,500-4,000 movements fill the document. **After that, every config save fails**, including prices, plan and stock, because they share the document.

### 3.6 HIGH: Whole-record last-writer-wins on every collection document, and the "anti-pisada" can discard remote updates
- **Where:** `sv` writes `{v:clean}` for the whole record (`:249`). The snapshot handler replaces the whole array (`:522`). The deferral logic is at `:532-546`.
- **Scenario:** B marks Impresión as done on OT-0031 while A edits OT-0031's delivery date. Whichever `setDoc` lands last wins the *entire* object, and the other change silently disappears. There is no `updatedAt` or `rev` field to detect it.
- The deferral **drops** a remote snapshot if *any* local save of that key happened after it arrived (`:542`). While A keeps clicking on the board, B's changes are not reflected in A's memory. Any A edit to the same record during that window reverts B. It converges eventually, but the window grows with user activity.

### 3.7 HIGH: Business actions are not idempotent (double submit creates duplicate quotes, OTs, remitos and fichas)
- `savCot` (`:10088-10111`), `cotAFormal` (`:3035`), `savRem` (`:10370`), `savOT` (`:10263`), `genOT` (`:10215`) and `confirmarDistribucionOTs` (`:8620`) all `await` the counter transaction *before* pushing the record and closing the modal. A double click during that 100-500 ms network round trip creates **two records with consecutive numbers**. The codebase has no in-flight guard (grep for in-progress flags returns 0 hits).
- `chCot` (`:10183`) checks `S.ordenes.find(o=>o.cotId==id)` on local state only. Two users approving the same quote, or one double click, produce two OTs, and `crearFichaAuto` dedupes fichas on local state only (`:10010`). `confirmarDistribucionOTs` does not re-check for existing OTs at all.
- `savOT` accepts a manually typed number (`numManual`, `:10262-10263`) with no uniqueness check, and it still consumes a counter value.

### 3.8 HIGH: The paper stock ledger allows negative or phantom stock and posts reversals to the wrong item
- **No floor:** `stockMov` applies `s.cantidad=(s.cantidad||0)+cant` (`:5337`) with no check that stock is sufficient. A cut larger than the stock produces a negative balance.
- **Phantom rows:** `stockFind` matches on the exact key `material|marca|grs|fx x fy|papelera` (`:5330-5331`), and orientation matters. `papelStockCandidatos`, however, matches either orientation and ignores papelera (`:5200-5202`). If the OT's papelera or orientation differs from the stock row (for example stock was entered as 70×100 and the OT says 100×70, or the user changes the papelera on the OT), `corteRegistrar` (`:5393-5396`) finds nothing and `stockMov` **creates a new row with a negative quantity** (`:5336`). The real row is never decremented.
- **Wrong item on correction:** If a cut is re-registered with a *lower* number (delta < 0) on an OT that has `stockParcial`, the whole return goes to the OT-key item (`:5392-5396`), and `spc.usado` is never decremented.
- **Non-atomic pair:** `sk('stockPapel');sk('stockMovs')` (`:5341`, `:5481`) are two writes. If one fails, the balance and the ledger diverge. They could be a single `updateDoc` with both fields.
- **Reservations are a comma-separated string of OT numbers** (`_resLista` `:5173`, writes at `:5219`, `:5226`, `:5278`, `:5388`, `:5409`). They are keyed by visible number rather than id. `delOT` (`:10563`) never releases them. `sigueVigente` (`:5189`) hides the stale entries but never cleans them. If the OT number is duplicated (§3.7), the reservation becomes ambiguous.
- **`autoPlanReal` (`:9364-9395`)**, called from `corteRegistrar` (`:5413`), fills **every free slot of every day** between `fechaInicio` and `fechaFin`. A cut taken on Monday and registered on Friday marks the guillotine as busy all week and inflates `planificacion` in `_config`.

### 3.9 HIGH: Denormalized copies with string joins and live recomputation of historical costs
- `cotizaciones[].itemsVariantes[].costeo` is a deep copy of the costeo worksheet (`cotEmbedAplicar` `:3278`, `cotAFormal` `:3058`). In the backup, 177 of 192 quotes embed one. `cotTrabajos` holds separate copies, so the two drift apart with no propagation.
- **OT → costeo is joined on description text**: `_rvDeItemDesc` (`:9850-9853`) compares `_composeItemDesc(rv)===desc`. OTs store `itemsOT[].desc` (`:8652`) or rely on `descripcion`. After `updateCot` (`:9825-9846`) rewrites `items` and `itemsVariantes`, or when two items share a description, the join silently fails. Paper prefill (`:5049-5051`), finishing steps (`:8708`, `:9869`) and ficha cost estimates (`:9958`) then quietly degrade to empty values.
- **Historical figures are recomputed with today's prices:** `_fichaCosteoView` calls `cotCalc(co,qty)` against the *current* `cotPapeles`/`cotImpresion` (`:9908`) instead of using the stored `co.calc` (`:3260`). `_ceDesdeCosteo` (`:9949+`) does the same when creating a ficha. A quote from three months ago shows a different cost and margin once the price tables change.
- **Render-time mutation:** `papelInit` calls `_papelPrefillDesdeCosteo`, which fills `o.material` from the *current* price tables. It runs from print and view paths (`printPapelPedido` `:5572`, board `:4795`). The record in memory then differs from Firestore until some unrelated `sk('ordenes')` persists it. Which tab's price snapshot wins is nondeterministic.
- **Renaming a machine** (`:9205-9208`) migrates the `planificacion` keys but **not** `ordenes[].asignaciones[*].nombre` or `cotImpresion[].maquina`. OTs vanish from the renamed machine's plan.

### 3.10 MEDIUM: There is no referential integrity, and orphans already exist
Evidence from the 2026-10-01 backup:
- **9 of 13 fichas** have `otIds` pointing to OTs that do not exist (`delOT` `:10563` does not cascade or check fichas, remitos, `analCostos[otId]`, planificacion blocks or stock reservations).
- One ficha has the visible number `OT-1783888241761002`, which is a `uid()` leaked into a human-facing number by an earlier numbering bug and never repaired.
- **7 of 12 approved quotes** have no OT.
- 2 OTs (the seed rows) reference client ids that do not exist (§3.3).
- `delCot` (`:10525`) checks OTs but not fichas or `cotTrabajos[].cotNum` (`:3067`).
- `cotGuardar` assigns `cotW.id=Date.now()` (`:2983`) rather than `uid()`, so the codebase uses three id schemes (sequential legacy, `uid()` and ms timestamps).

### 3.11 MEDIUM: Backup and restore are complete but unsafe
- **Improved:** `descargarBackup` serializes `[...COL_KEYS,...BLOB_KEYS]` dynamically (`:4190-4191`) with `_version:2`. Both real backups contain every key.
- **The backup comes from memory, not Firestore.** If a key timed out at load (§3.3), it is backed up as the default or empty value. `remitos`, `cotTrabajos` and all of `_config` are stale for the session. `_lastBackup` is stamped anyway (`:4200`), which suppresses the reminder. `gp/_counters` is not included.
- **Restore** (`:4252-4272`):
  - It does not validate the shape of the data. A non-array value for a collection becomes `[]` in `sv` (`:224`), which **deletes every known record**.
  - It calls `sk` in a loop, and `sk` never throws, so the `try/catch` at `:4266` is dead code. It then shows "Backup restaurado" and reloads **even if half the writes failed**.
  - Whether records absent from the file are deleted depends on whether `_knownIds` was populated earlier in the session (§3.4). The result is a merge or a replace unpredictably, while the dialog promises "REEMPLAZA".
  - It does not stop the snapshot listeners and does not batch. Thousands of sequential writes run with no progress indicator.
- There is still no scheduled `gcloud firestore export`, no point-in-time recovery and no tested restore. `wipeDatos` (`:4275-4299`) is still shipped, reachable only from the console. It resets `S.ids` but not `_counters`, so its message "numeración arranca de nuevo en 1" is false.

### 3.12 MEDIUM: `interpretar.js` API contract
- **No auth and open CORS:** `'Access-Control-Allow-Origin': '*'` (`:5`). There is no Firebase ID-token check, rate limit or size cap on the body. `contexto` arrays are interpolated into the system prompt without limits (`:28-37`), so callers control prompt size and therefore cost.
- **No timeout or retry:** the bare `fetch` (`:81-93`) has no `AbortController`, and `netlify.toml` sets no function timeout. With `max_tokens: 8000` (`:85`) and up to 4 images (`:21`), Netlify's default synchronous limit can be exceeded. The client (`index.html:7965-7966`) has no timeout either and calls `resp.json()` on what may be an HTML 502 page, so the user sees a generic "No se pudo conectar".
- **Truncation goes undetected:** `stop_reason` is never checked (`:94-101`). On a long table image that hits `max_tokens`, the function returns 200 with a partial `items` list, and rows are silently missing from the quote.
- **Schema is not enforced server-side:** only `items` is coerced to an array (`:100`). Types, ranges (negative or zero `cantidades`) and enum values are not validated, and there is no `additionalProperties:false`.
- **Model ID:** `process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'` (`:11`). The previous audit called this ID invalid. I cannot verify that from the repository. In any case, a hard-coded fallback with no health check means a deprecation turns into a silent 502.
- **Error text leaks:** raw upstream and exception messages are returned to the client (`:95`, `:103`).

### 3.13 LOW: Rules, hosting and tests
- `firestore.rules` `:19-25` allows any authenticated user, the email-domain clause is still commented out (`:23`), and there is no `request.resource.data` validation. That leaves no server-side backstop against a buggy or outdated client writing any shape, decrementing `_counters`, or deleting everything. A `.firebase/hosting..cache` dated 2026-10-01 shows a hosting deploy happened. Whether the rules were deployed cannot be verified from the repository.
- `netlify.toml` publishes `"."` with no ignore list, so `audit/*.md`, `tests/` and `PENDIENTES.md` are publicly downloadable. `firebase.json` does exclude them.
- `cotGuardar` and `cotAFormal` call `sv('cotTrabajos')` directly (`:2989`, `:3069`), which bypasses `_sanitizeColeccion` even though `cotTrabajos` has sanitize fields (`:285`). `:3069` swallows errors silently.
- **Counter fallback:** if `runTransaction` fails (for example offline), `_reservarNumero` falls back to the racy `S.ids` counter with only a `console.warn` (`:749-756`), so duplicate numbers come back silently.

---

## 4. Top risks blocking approval (ranked)

1. **Client features delete or revert other users' data** (§3.1 Undo, §3.2 Retry, §3.4 first-save rewrite). *Input:* A clicks Deshacer after B created an OT. *Result:* B's OT is deleted from Firestore.
2. **A transient read failure at login causes destructive writes** (§3.3). *Input:* `_config` read fails or times out (more than 8 s). *Result:* every pending OT is auto-approved, the migration flags and `_lastBackup` are overwritten, `cotEstructuras` is reset, and the next price edit wipes a catalog. The production backup already contains demo OTs.
3. **Stock, ledger and production plan are last-writer-wins with no live sync** (§3.5, §3.8). *Input:* a stale operator session registers a cut. *Result:* receipts and movements recorded by others since that operator logged in are erased, balances can go negative, and phantom negative rows appear. The 1 MiB `_config` ceiling will eventually block every config save.
4. **Non-idempotent creation flows** (§3.7). *Input:* a double click on Guardar or Emitir, or two users approving the same quote. *Result:* duplicate quotes, OTs, remitos and fichas with distinct numbers. There is no server-side uniqueness.
5. **Whole-record last-writer-wins plus fragile joins** (§3.6, §3.9, §3.10). Concurrent edits to one OT lose fields, OT↔costeo links break when descriptions change, and historical costs are recomputed with current prices. The real data already shows orphaned fichas (9 of 13) and approved quotes with no OT (7 of 12).
6. **Disaster recovery is still manual, and restore can silently half-apply** (§3.11), with no automated export or point-in-time recovery.

---

## 5. Quick wins (days)

1. **Seed the caches at load.** After `cargarDatos`, set `_knownIds[k]` and `_docJson[k]` from the loaded arrays for every collection (`:453`). This fixes the lost first delete and the first-save rewrite (§3.4).
2. **Turn Undo, Retry and restore into per-record operations.** Undo and Retry should re-apply only the records the user touched (store `{k,id,prevRecord}`). Never pass a whole stale array to `sv`. Until then, disable `doUndo` (`:9847`) and make `retrySave` use the current `S[k]` (`:178`).
3. **Abort on load failure instead of seeding or migrating.** If any `ld()` returns null because of an error or timeout, show "no se pudo cargar" and **block all writes**. Remove `seed()` from production (`:579`). Delete the two demo OTs (ids 1 and 2) from Firestore.
4. **Guard double submits.** Add an in-flight flag and disable the button in `savCot`, `cotAFormal`, `savRem`, `savOT`, `genOT`, `chCot` and `confirmarDistribucionOTs`. In `chCot` and `confirmarDistribucionOTs`, re-check for existing OTs inside the counter transaction, or create the OT inside it.
5. **Make stock writes safer.** Write `stockPapel` and `stockMovs` in **one** `updateDoc` call, refuse cuts that would go negative, and have `corteRegistrar` use `stockItemId` / `stockParcial.itemId` when present instead of key matching.
6. **Add a listener on `gp/_config`** (at least for `stockPapel`, `stockMovs`, `planificacion` and `analCostos`) so sessions never write a stale blob.
7. **Harden restore.** Validate that each collection key is an array of objects with an `id`. Call `sv` directly and collect failures. Report a partial restore honestly. Detach listeners first. Make replace semantics explicit by deleting ids not in the file only after confirmation.
8. **Harden `interpretar.js`.**
   - Verify the Firebase ID token and restrict CORS to the app origin.
   - Cap the body size and `contexto` lengths.
   - Add a `AbortController` timeout and one retry on 429/5xx.
   - Return 422 when `stop_reason==='max_tokens'`.
   - Validate item fields.
   - Add a client-side fetch timeout.
9. **Fix the machine-merge bug** in `confirmarDistribucionOTs` (`:8618`): split the OT or keep a per-entry machine, and set `vendedor`.
10. **Exclude `audit/`, `tests/` and `*.md`** from the Netlify publish.

## 6. Deeper issues requiring refactoring (weeks)

- **Move invariants to the server.** Use callable Cloud Functions, or at minimum `runTransaction`/`writeBatch`, for creating an OT together with its ficha and counter, for stock movements (ledger as a subcollection of immutable docs, balance via `increment()`), for approval and reservation, and for quote approval. Make each one idempotent with a client request id.
- **Replace whole-record writes with field-level updates** (`updateDoc` with field paths), and add `rev`/`updatedAt` with optimistic concurrency so stale writes are rejected. Add `remitos` and `cotTrabajos` to live sync.
- **Break up `_config`.** Store `stockPapel` items, `stockMovs`, `insumosMovs`, `planificacion` (one doc per machine-day) and `analCostos` (one doc per OT) as their own documents or subcollections. This removes both the hot-document contention and the 1 MiB ceiling.
- **Use stable ids instead of text joins.** Give quote items an `itemId` and have `itemsOT[]` reference it. Store reservations as `{otId, cant}` objects. Freeze cost snapshots (`co.calc`) as the historical truth and stop recomputing past documents with current prices.
- **Enforce referential integrity.** Cascade or block deletes for OT → fichas, remitos, analCostos, planificacion and reservations. Run a one-off repair of the existing orphans (9 fichas, 2 seed OTs, the uid-numbered ficha).
- **Version and validate the schema.** Add `schemaVersion` per document, keep a migration ledger on the server, enforce a minimum client version, and add rules-level `request.resource.data` shape checks.
- **Provide real disaster recovery and observability.** Schedule Firestore exports to GCS with retention, test a restore quarterly, add error tracking (Sentry) and structured function logs, and alert on save failures and on the counter fallback.
- **Make the tests real.** Load the actual functions from `index.html` (or extract modules), and add tests against the Firestore emulator for `sv`, sync, undo, stock and counters.

---

## 7. Changes vs the 2026-09-16 audit

| Area | 2026-09-16 finding | Status now | Evidence |
|---|---|---|---|
| Visible number races (`nid`/`nidCot` max+1) | Duplicate OT and quote numbers | **Improved** | `_reservarNumero` uses `runTransaction` on `gp/_counters` (`:736-757`). Residual: silent fallback to the racy counter (`:749-756`), and duplicates still possible through double submits or manual `numManual` (§3.7). |
| Zero transactions or batches | 0 matches | **Improved (narrowly)** | One transaction exists (counters). Everything else is unchanged. |
| `_config` read-modify-write lost update | Cross-key clobbering | **Improved** | `updateDoc` per field (`:259-267`). The same-key race and the missing listener remain (§3.5). |
| Backup omits pricing, costeos and inventory | Critical | **Fixed** | Dynamic `COL_KEYS+BLOB_KEYS` (`:4190-4191`) and restore over the same set (`:4264`). New gaps: in-memory source, unsafe restore, `_counters` omitted (§3.11). |
| No automated export or point-in-time recovery | | **Unchanged** | No scheduler config in `firebase.json` or `netlify.toml`. |
| Migrations client-side and unversioned | | **Unchanged / worse understood** | Same functions (`:580-636`). Newly shown to run destructively after a failed load (§3.3), with evidence in production data. |
| Realtime whole-array last-writer-wins and timing hack | | **Unchanged** | `:498-556`. The deferral now also cancels pending timers when a snapshot matches (`:514-518`, a small fix). `remitos` and `cotTrabajos` are still unsynced and `_config` still has no listener. |
| `sv` partial failure and one-slot retry | | **Unchanged, now shown to be dangerous** | Retry can delete records (§3.2). Swallowed deletes (`:233`). |
| `interpretar.js` without auth, rate limit, timeout or retry | | **Unchanged** | Same handler. The richer schema (laminado, revista, familia) is an improvement. A missing `stop_reason` check is newly found. |
| Firestore rules (auth only) | | **Unchanged** | `firestore.rules:22-24`. |
| `wipeDatos` live | | **Partially mitigated** | No UI button and requires a passphrase (`:4276`). Still shipped, and still resets `ids` without touching `_counters`. |
| **New findings in this pass** | | | Undo and Retry deleting others' data (§3.1-3.2). Load-failure cascade and seed rows in production (§3.3). First delete lost per session (§3.4). Non-idempotent creation (§3.7). Negative or phantom stock and multi-day auto-plan (§3.8). Text-joined denormalized costeos with live recomputation (§3.9). Measured orphans in real data (§3.10). Machine rename not propagated (§3.9). Grouped multi-piece OT dropping a machine (§2). |

**Net change:** The numbers improved (backup completeness 2→4, atomicity 2→3), but the overall score stays at **3/10**. The newly found deletion and revert paths and the integrity evidence in production data offset those gains.

---

*Constraint honored: no production code was modified; this report is the only file written. Backup data was read only to compute counts, sizes and referential checks; no customer data is reproduced here.*
