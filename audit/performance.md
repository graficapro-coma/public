# Gráfica Pro: Performance & Scalability Audit

**Date:** 2026-10-02 (supersedes the 2026-09-16 audit)
**Scope:** Performance and scalability only, written as acquisition due diligence. Every finding cites a file, line and function.
**Files reviewed:** `index.html` (1,019,072 bytes, 10,572 LF lines, 663 named functions) and `netlify/functions/interpretar.js` (105 lines). I also checked `netlify.toml`, `firebase.json` and `styles.css`.
**Method:** static analysis, ripgrep occurrence counts and measured payload compression. Growth and CPU figures come from a throwaway Node 24 simulator kept outside the project. It generates records shaped like the app's real objects (`mkOT`, `mkCot`, planning blocks as written by `crearBloqueDrop`/`autoPlanReal`, `analCostos` as written by `analUpdFijo`, `stockMovs` as written by `stockMov`). Load is 280 OTs and 420 quotes per month. **No project file was modified apart from this report.** CPU timings are desktop Node numbers. Expect a mid-range phone to be 3–6× slower.

---

## Executive summary

**Overall performance score: 3 / 10.**
**Performance risk level: CRITICAL.**

The system works at today's volume (~1 month of real data: 291 OTs, 81 clients, 324 planning blocks). It has a **storage-model time bomb with a horizon of months, not years.**

1. **23 independent, unbounded datasets all live as fields of one Firestore document, `gp/_config`.** These include `planificacion`, `analCostos`, `stockMovs`, `insumosMovs` and `cotPapelCat` (`BLOB_KEYS`, `index.html:205`). Firestore caps one document at **1 MiB** and at **40,000 index entries**. Simulated growth puts the index-entry cap at **~2.5–3.5 months** of full use (cost analysis filled in for every OT) and the 1 MiB cap at **~3–9 months**. After that, every write to planning, stock, cost analysis, IDs and config tables is rejected by the server.
2. **Login downloads the whole database**, twice for the six synced collections. On the free Spark plan, which the code comments suggest is in use (`index.html:4184`), the 50k reads/day quota is exhausted at **~2–3 months of history** with 4 users reloading twice a day.
3. **A slow `_config` load silently falls back to defaults.** The next save then overwrites real data. The risk grows with payload size (8 s race, `index.html:452`).
4. Several screens and the quote search are **O(n²)**: 0.4–4 s per keystroke or click at 1–3 years of data.

Since 2026-09-16 there are real but peripheral improvements: Map index for clients and suppliers, pagination of the quote/OT/ficha lists, OT archiving, CSS extraction with a responsive layout, and the AI paste-listener leak fixed. The core architecture is unchanged, the payload has grown, and new unbounded-growth paths have been added.

---

## 1. Rubric

| # | Criterion | Score | Weight | Weighted |
|---|-----------|:-----:|:------:|:--------:|
| 1 | Initial load / payload / mobile | 4 | 10% | 0.40 |
| 2 | Storage model and Firestore hard limits (`_config`) | **2** | 20% | 0.40 |
| 3 | Firestore read/write cost and quota | 3 | 15% | 0.45 |
| 4 | Rendering architecture | 4 | 15% | 0.60 |
| 5 | Algorithmic hot paths (big-O) | 5 | 10% | 0.50 |
| 6 | Realtime sync and multi-user concurrency | 3 | 15% | 0.45 |
| 7 | Resilience under load (timeouts, partial loads) | **2** | 10% | 0.20 |
| 8 | Ancillary: PDF/print, images, backup/restore, AI function | 6 | 5% | 0.30 |
| | **Weighted overall** | **3.3 → 3/10** | | |

### 1.1 Initial load / payload / mobile: 4/10

Measured on the current file:

| Metric | Value |
|---|---|
| `index.html` raw | **1,019,072 B** (prior audit estimated 450–500 KB) |
| gzip -9 / brotli | **316,903 B / 258,799 B** on the wire |
| Lines (LF) / named functions | 10,572 / 663 |
| Comment-only lines | 706 lines, ~55 KB shipped and parsed |
| Base64 images inline | **3**: line 81 (7.2 KB, sidebar `<img>`), line 147 (7.2 KB, `window._appLogo`, same logo again), **line 10457 (124 KB, quote-PDF logo inside `generarPDFCotizacion`'s template string)** |
| Longest lines | 10457 (124,152 chars), 906 (`COT_SEED`, 19,459 chars) |
| Render-blocking external CSS | `tabler-icons.min.css` from jsDelivr (line 20), which pulls the full Tabler webfont |
| Runtime ESM imports | `firebase-app`, `firebase-firestore`, `firebase-auth` 10.12.0 from gstatic (`initFirebase`, lines 183–185), behind a 10 s race (line 340) |
| Build / minification | **None** (`netlify.toml` `[build] publish="."`) |

- About 0.9 MB of JavaScript in one inline `<script>` (lines 122–10569) is parsed and compiled on every cold load. On a mid-range Android this costs an estimated 1–2 s of main-thread time before Firebase even starts.
- **Improvement:** layout CSS now lives in `styles.css` (14.9 KB, cacheable), and responsive breakpoints exist at lines 32, 38 and 71. Phones get a usable layout.
- **Mobile is still limited by data, not layout.** See 1.3 (megabytes of data per login) and 1.6 (full-collection `JSON.stringify` per realtime event). At 12 months, every remote edit costs a phone ~0.5 s of jank (108 ms desktop × 3–5).

### 1.2 Storage model and Firestore hard limits: 2/10

`index.html:205`:
```js
const BLOB_KEYS=['procesos','maquinas','externos','fletes','planificacion','ids','analCostos','recursosAnal','tiposTrabajo','stockPapel','stockMovs','vendedores','cotPapeles','cotImpresion','cotChapas','cotLaminados','cotOtros','cotConfig','insumosItems','insumosMovs','cotEstructuras','externosInfo','cotPapelCat'];
```
The comment on line 204 says "configuración liviana" (lightweight configuration). `sv()` writes each of these keys as **a field of the single document `gp/_config`**: `_fsUpdate(ref,{[k]:cleanV})`, line 263. At least five of these keys grow without bound:

| Key | Writer (file:line) | Growth driver |
|---|---|---|
| `planificacion` | `crearBloqueDrop` 9444–9458, `savBloque` 9314, **`autoPlanReal` 9364–9395** | One map entry **per 30-min slot**: a head block plus one `{cont:true}` per extra slot. `autoPlanReal` fills **every free slot of every day** between a step's `fechaInicio` and `fechaFin` (lines 9372–9392). A step left "active" over a weekend writes 20+ slots per day. Nothing is ever pruned. |
| `analCostos` | `analUpdFijo` 7257, `analUpdMontoFijo` 7265, `analUpdMontoProc` 7287, paper-cost auto-fill 5389/5400 | One `{fijos:{6 keys},procesos:[]}` per OT, forever |
| `stockMovs` | `stockMov` 5333–5343 | Append-only log, never pruned |
| `insumosMovs` | 1714, 1719, 1746, 1771 | Append-only log, never pruned |
| `cotPapelCat`, `cotPapeles`, `cotEstructuras`, … | config editors | Bounded but large: the `COT_SEED` literal alone is 19 KB (line 906) |

**Simulated `_config` growth** (280 OTs/month; "lo" = manual planning only, "hi" = plus ~2 `autoPlanReal` runs per OT):

| Months of use | OTs | `planificacion` (lo/hi) | `analCostos` | `stockMovs` | **`_config` size (lo/hi, +80 KB static)** | **Index entries (lo/hi)** |
|---|---|---|---|---|---|---|
| 1 | 280 | 28 / 65 KB | 102 KB | 102 KB | 329 / 366 KB | 11.7k / 17.3k |
| 3 | 840 | 84 / 193 KB | 305 KB | 306 KB | **825 / 934 KB** | **35.2k / 52.2k** |
| 6 | 1,680 | 168 / 380 KB | 610 KB | 612 KB | **1.53 / 1.74 MiB** | 70k / 103k |
| 12 | 3,360 | 336 / 761 KB | 1.19 MiB | 1.19 MiB | 3.0 / 3.4 MiB | 140k / 207k |

Notes:
- Firestore indexes each map leaf automatically, with two entries per leaf (ascending and descending). One `analCostos` record is ~26 entries. One planning head block is ~10 entries plus 2 per continuation slot. The hard limits are **40,000 index entries per document** and **1 MiB per document**. Breaching either makes `updateDoc` fail ("too many index entries" / "exceeds the maximum allowed size").
- **Crossover points:**
  - Index entries: **~2.3 months** ("hi") to **~3.4 months** ("lo") if cost analysis is filled for every OT.
  - Index entries, `planificacion` alone: **~10–11 months** (lo).
  - 1 MiB: **~3–4 months** at the simulated rate.
  - 1 MiB if only half of the OTs get `analCostos` and stock movements: **~6–9 months**.
  - The 291-OT test dataset is ~1 month, so it sits safely under both limits. That explains why it "worked".
- **Caveat:** the assumed field counts come from the code's own object literals. Single-field index exemptions could be configured in the Firebase console. None exist in the repository (`firebase.json` has no `firestore.indexes`). **Verify by counting the leaves of the real `_config` document.**
- **Failure mode:** once the limit is hit, every `sk()` on any of the 23 keys fails, because they share one document. That includes `ids` (`_lastBackup`, migration flags), `stockPapel`, `planificacion` and `cotConfig`. The red "Error al guardar" chip (`showSaveError`, line 169) appears on every save, and `retrySave` can never succeed.
- **Write amplification even before the limit:** every `sk(blobKey)` uploads the **whole field**. One drag-and-drop in the planner uploads all of `planificacion` (~0.3–0.8 MB at 12 months). One keystroke in an Análisis OT cost field uploads all of `analCostos` (see 1.3).

### 1.3 Firestore read/write cost and quota: 3/10

**Reads per login.**
- `cargarDatos` (449–482) runs `Promise.all` over all 31 keys (line 452).
- `ld()` (207–219):
  - For the 8 `COL_KEYS` it calls `getDocs` on the **entire** subcollection (line 211). There is no `limit`, `where` or cursor.
  - For each of the 23 `BLOB_KEYS` it calls `getDoc(gp/_config)` **separately** (line 215). That is 23 calls for the same document. Whether the v10 SDK coalesces them depends on its in-flight listener sharing. Verify in DevTools; the cost is between 1× and 23× the `_config` size.
- `activarSincronizacion` (498–556) then opens `onSnapshot` on 6 of those collections (line 503). Offline persistence is off: `getFirestore(app)` at line 187 has no `persistentLocalCache`. So each listener **re-reads every document** that `getDocs` just read.

| History | Docs read per login (getDocs + listeners) | Logins/day before the **Spark 50k reads/day** quota is gone |
|---|---|---|
| 1 month (today) | ~3,000 | ~16 |
| 3 months | ~8,500 | ~5 |
| 12 months | ~33,000 | **1.5** |
| 36 months | ~99,000 | **0** (one login exceeds the daily quota) |

- On Blaze the money is trivial (~$5/month at 12 months). On **Spark the app stops working for the day**.
- Evidence that Spark is in use: the backup is described as "sin costo, funciona en plan gratuito" (line 4184), and a comment says per-keystroke writes once "agotaba la cuota de Firestore" (line 238).
- **Download volume per login** at 12 months is ~45 MB of JSON-equivalent data: OTs 9.7 MB, quotes 14.9 MB, fichas 8.7 MB, cotTrabajos 7.0 MB, plus remitos. About 33 MB of that is downloaded again by the listeners. Spark's 10 GiB/month egress becomes a second ceiling.
- **Root cause of the data volume:** each quote embeds a full deep copy of its costing in `itemsVariantes[].costeo` (line 3058: `costeo:JSON.parse(JSON.stringify(t))`). Fichas embed it again (line 9813). The same costing also lives in `cotTrabajos`. That is **three stored copies of each costing**. Simulated average sizes: OT 3.0 KB, quote 3.1 KB, ficha 2.7 KB, cotTrabajo 1.5 KB.

**Per-keystroke writes (no debounce):**
- `fichaSetImporte` (6742–6748) runs `sk('fichas')` on every `oninput` (lines 6608–6610).
- `analUpdMontoFijo` (7265–7272) and `analUpdMontoProc` (7287–7293) run `sk('analCostos')` on every `oninput` (lines 7192, 7210). That is a **full-field upload of `analCostos` per keystroke**, aimed at a document with a ~1 write/s sustained per-document soft limit.
- Every `sk()` on a `COL_KEY` first runs `_sanitizeColeccion` over the **whole** collection (294–304). It then `JSON.stringify`s **every item** to diff against `_docJson` (lines 242–251). The O(n) client cost is paid on every save, even when one field changed.
- Changed documents are written **sequentially** (`await` inside a `for`, line 249). A migration that touches all OTs (`migrarPasos9` 608, `migrarAprobarExistentes` 629) issues thousands of serial round-trips.

### 1.4 Rendering architecture: 4/10

- `render()` (4123–4140) still rebuilds the whole page: `pg.innerHTML=fns[curPg]()` (line 4129).
- Occurrence counts compared with the prior audit:

  | Pattern | 2026-09-16 | Now |
  |---|---|---|
  | `render()` references | 199 | **235** |
  | `render();` calls | 135 | **163** |
  | `.innerHTML=` | 68 | **73** |

- **Every realtime event** from another user calls `render()` (line 528). This destroys focus and any uncommitted text in page-level inputs, such as the Pedidos de papel grid (inputs at lines 5554–5560, saved only `onchange`).
- **Improved:** list screens now use targeted updaters plus pagination: `updateCotResults` (4443), `updateOTResults` (4512), `_pagina` (129), `PER=25`. OTs can be archived (`archivarOT` 4502, filter at 4515).
- **Still unbounded:**
  - `updateSegResults` (4663–4718), "todas" tab: `S.ordenes.slice()` (line 4671), one `<tr>` per OT, 9 `SEG_COLS` cells each, no pagination or windowing. At 10k OTs that is ~100k cells in one string, assigned with a single `innerHTML` (4717). Its sort comparator creates `Date` objects (`dR`, lines 4666/4681), so the sort does O(n log n) allocations.
  - `rPapel` (5488+) renders every active OT.
  - `rTiempos` (7308+) iterates every step of every OT on each render.
  - `rAnalOT` annual view renders every OT of the year (see 1.5).
- **No input debounce.** `searchDash` (4308), `searchCot` (4442), `searchOT` (4500) and the Seguimiento search (4650, `oninput="bSeg=this.value;updateSegResults()"`) recompute on every keystroke.

### 1.5 Algorithmic hot paths: 5/10

**The costing engine is acceptable, not a blocker:**
- `cotPapelOpciones` (989–1026) brute-forces formats × 16 cuts (`_catCortes` 953–966: `i,j∈1..4`) × at most 2 machines. That is ≤ ~320 candidates, each O(1) via `_posesGrid` (2417–2425), plus one sort.
- `cotCalc` (2047+) runs one resolver per piece: `cotPapelDePieza` → `cotPapelSelResolver` → `cotPapelOpciones`.
- Estimated <1 ms per `cotCalc`, and <20–30 ms per full cotizador render:
  - `rCotizador` at 3777: base plus quantity view.
  - Variants loop at 4080.
  - `_fitCat` per machine per piece at 3919.
  - `cotSync` (2309–2313) on each field change.
- `aiCostearOptimo` (8108–8152) deep-clones `cotW` per machine. Fine at about 6 machines.
- **Missed easy win:** `cotPapelOpciones` is not memoized, so the same options are recomputed many times per render.

**Quadratic patterns that break with history.** Simulated with the real lookup shapes:

| Function (file:line) | Pattern | 12 months | 36 months |
|---|---|---|---|
| `updateCotResults` search (4443–4468) | for **every quote**: `S.ordenes.find(o=>o.cotId==c.id)` (**4466**), plus nested `S.cotPapeles/cotLaminados/cotImpresion.find` per piece (4460–4462); runs **per keystroke** | **~360 ms/keystroke** | **~4.1 s/keystroke** |
| `rAnalOT` annual view (6995+) | per OT row: `S.cotizaciones.find` (7054, 7105), `S.ordenes.filter` (7109), `fichaDeOT` → `S.fichas.find` (7037) ×2 | **~540 ms/render** | **~3.7 s/render** |
| `rCapacidad` (7407) → `capMetricas` (7385) | iterates **all of history** in `planificacion[maq]` (`for(const f in dias)`, 7388) and filters by date; `S.ordenes.find` per block (**7393**); called **twice per machine** (7411 and 7421) | ~190 ms × 2 | **~2.1 s × 2** |
| `updateCotResults` rows (4479) | `S.ordenes.find` per visible row | 25 rows, OK | OK |
| `rPlan` (5669–5682) | per machine: `S.ordenes.filter(...Object.values(o.asignaciones).some...)` (5670); Pre-prensa/Guillotina extra full scans (5674, 5679); `_bloquesSemana` scans all dates (4209) | O(M·N), tolerable | tolerable |
| `rCalSemanal` (6162–6211) | `S.ordenes.filter` (6172) and `S.ordenes.find` per slot (6194), 132 slots/week | ~5–15 ms | ~20–40 ms |
| `rPapel` (5488–5560) | `papelInit` → `_papelPrefillDesdeCosteo` (5040–5074): `S.cotizaciones.find` + `cotCalc` per active OT whose material is incomplete; `papelCalc` called 3× per row (5513, 5534, inside `corteInfo` 5106) | bounded by active OTs | bounded |
| `updateDashResults` (4321–4328) | 7 filter passes over `S.ordenes`, per keystroke | linear, OK | OK |

- **Improved:** `cNom/cNomCorto/pNom` now use cached `Map` indexes (`_cliIndex`/`_provIndex`, 697–708), which removes the O(rows×clients) pattern.
- **Still missing:** an equivalent index for `S.ordenes` by `id`/`cotId` and for `S.cotizaciones` by `id`. There are 73 `S.ordenes.find(` and 18 `S.cotizaciones.find(` call sites.

### 1.6 Realtime sync and multi-user concurrency: 3/10

On **every** snapshot event, for each of 6 collections, `activarSincronizacion` (498–556):
- materializes every document: `snap.docs.map(d=>d.data().v)` (510)
- `JSON.stringify(S[k])` **and** `JSON.stringify(docs)` over the **entire** collection (512–513)
- on a difference, re-stringifies every doc into the `_docJson` cache (526) and runs a full `render()` (528)
- may repeat the stringify inside the 2.2 s deferral timer (543)

`snap.docChanges()` is still unused. Firestore fires the listener for the user's **own** writes too (latency compensation), so each local save also pays this cost.

| Collection size | double-stringify + compare | cache rebuild |
|---|---|---|
| OTs, 12 months (3,360) | 108 ms | 40 ms |
| Quotes, 12 months (5,040) | 122 ms | 75 ms |
| OTs, 36 months (10,080) | **349 ms** | 120 ms |
| Quotes, 36 months (15,120) | **456 ms** | 152 ms |

These are desktop figures. On a phone, multiply by 3–5 and add a full page re-render, **per edit by any of the 4 users**.

**BLOB_KEYS are not synced at all** (`COLS_SYNC` line 503 has no `_config` listener), and each write replaces the whole field. Two users planning at the same time is last-writer-wins on **all** of `planificacion`. User B's drag-and-drop, written from a stale copy loaded at login, erases user A's blocks. The same applies to `stockPapel`/`stockMovs` (`stockMov` 5341), `analCostos` and `cotPapelCat`. This gets worse with more users and with longer sessions. `remitos` and `cotTrabajos` are not synced either.

### 1.7 Resilience under load: 2/10

`cargarDatos` gives each key an **8 s race** that resolves to `null` (line 452). A `null` result is skipped (line 453), so `S[k]` keeps its **hard-coded default** (`let S={...}`, 317–333). `ld()` also returns `null` on any error (line 218). Then:
- `iniciarSinMigrar` (558–584) sees the defaults and **writes them back**:
  - `S.ids` default lacks `_migTipos` → `sk('tiposTrabajo');sk('ids')` (line 573). This overwrites `ids._lastBackup` and every migration flag.
  - `!S.ids._migEstructuras && !S.cotEstructuras.length` → re-seeds and **overwrites user-edited `cotEstructuras`** (line 578).
- `migrarAprobarExistentes` (629–636): with a defaulted `S.ids`, it stamps **every OT that lacks `aprobadaOT` as approved** ("por: migración", line 632) and writes them all.
- `S.planificacion={}` (line 560). The next block the user drags calls `sk('planificacion')` and **replaces the entire stored plan** with that one block.

The likelihood of this grows directly with data volume. All 31 loads share one connection. At 12 months they are ~45 MB of collections plus a `_config` of up to 1 MiB (×23 if not coalesced). On a 10 Mbit/s office link or 4G, the `_config` read can easily miss the 8 s window. **This is a performance problem that turns directly into data loss.**

### 1.8 Ancillary: 6/10

- **PDF/print.**
  - `generarPDFCotizacion` (10375) → `_descargarComoPDF` (10480–10517) writes HTML into a hidden iframe and calls the native print dialog. That is cheap.
  - The template embeds the 124 KB base64 logo (line 10457), which is parsed with the app on every load and rebuilt in every quote document.
  - Pallet labels and paper orders use `window.print()` (5610, 5640, 5926).
  - No heavy PDF libraries are used (`jspdf`/`html2canvas`: 0 matches).
- **Images.** No images are stored in Firestore.
  - AI images are downscaled to ≤1600 px JPEG q0.85 (`aiDownscale` 7927–7941) and capped at 4 per request (7921, `interpretar.js:21`).
  - There is **no total-payload guard**: 4 × ~0.5 MB base64 ≈ 2–3 MB, which is under Netlify's 6 MB limit.
- **Backup.** `descargarBackup` (4186–4206) runs `JSON.stringify(backup,null,2)` over everything, all in memory.
  - Size: ~60 MB at 12 months and ~200 MB at 36 months (pretty-printing adds ~30%). That is a large transient string on low-RAM machines.
- **Restore.** `restaurarBackup` (4252–4272) calls `await sk(k)` per key. Each call writes **every document sequentially** (the `_docJson` cache is empty for new items).
  - At 12 months that is ~20k serial writes: tens of minutes, and **over the Spark 20k writes/day quota**.
  - Restore is therefore not a usable disaster-recovery path on the current plan.
- **AI function (`interpretar.js`).**
  - `max_tokens: 8000` (line 85), no streaming, and **no timeout/`AbortController`**, either around the Anthropic `fetch` (81–93) or in the client (`aiInterpretar` fetch, 7965).
  - Netlify synchronous functions time out at 10 s by default, and nothing in `netlify.toml` raises that. A multi-row image table at 8k tokens will regularly exceed it.
  - The client then calls `resp.json()` on a non-JSON timeout page and shows the generic "No se pudo conectar" message (7969).
  - **Improved:** the context sent to the model is now capped (`.slice(0,60/30/50/20)`, 7956–7963).

---

## 2. Overall score

| | |
|---|---|
| **Overall** | **3 / 10** (2026-09-16: 4 / 10) |
| **Performance risk** | **CRITICAL** (2026-09-16: High) |

The rating moved from High to Critical because of the single-document `_config` limits, which the prior audit did not cover. This is not a slow-down. It is a **hard functional stop**, reached within months at the client's stated volume.

---

## 3. Top risks that would block approval (ranked, with breaking volume)

| # | Risk | Evidence | Breaks at |
|---|---|---|---|
| 1 | **`gp/_config` exceeds Firestore's 40,000 index entries / 1 MiB.** All planning, stock, cost-analysis, IDs and config saves fail together. | `BLOB_KEYS` 205; `sv` 255–267; growth writers `autoPlanReal` 9364–9395, `crearBloqueDrop` 9456, `stockMov` 5340, `analUpd*` 7257–7293 | Index cap ≈ **850–950 OTs (~3 months)** with full cost analysis; 1 MiB ≈ **3–9 months**; `planificacion` alone ≈ 10–11 months |
| 2 | **Timeout or partial load at login writes defaults over real data.** Wipes the plan, resets `ids` flags, re-seeds `cotEstructuras`, mass-approves OTs. | 8 s race 452–453; defaults 317–333; write-backs 573, 578, 632–635; `S.planificacion={}` 560 | Probability rises with payload: `_config` ≥ ~0.5 MB plus tens of MB of collections on a slow link (**~3–6 months**) |
| 3 | **Whole database read at every login, twice for synced collections.** The Spark daily read quota is exhausted. | `ld` 207–219 (no `limit`); `cargarDatos` 452; listeners 503–507; no `persistentLocalCache` (187) | ~6k reads/login (**~2–3 months**) at 8 page loads/day; at **36 months one login exceeds 50k** |
| 4 | **Full-collection double `JSON.stringify` and full `render()` on every realtime event, ×6 collections, ×every client, including own writes.** | 510–528, 543 | ~100–120 ms/event desktop at **12 months**; ~350–460 ms at **36 months** (×3–5 on phones) |
| 5 | **O(n²) screens and search:** quote search per keystroke, Análisis OT annual view, Capacidad (twice per machine over all history). | 4466; 7037/7054/7105/7109; 7388/7393/7411/7421 | 0.2–0.5 s at **12 months**; **2–4 s at 36 months** |
| 6 | **BLOB_KEYS last-writer-wins.** Concurrent planners or stock users overwrite each other's whole field (no listener, no merge). | 503 (no `_config` sync), 263 | Already at 2 concurrent planners; worse with each added user |
| 7 | **Disaster recovery does not scale:** serial per-document restore over the daily write quota. | `restaurarBackup` 4266, `sv` 242–251 | ~**12 months** (~20k docs) |

---

## 4. Quick wins (≤1 day each, low risk)

1. **Load `_config` once.** In `cargarDatos`, `getDoc(gp/_config)` once and pick out all 23 fields. Removes up to 22 duplicate reads/downloads (207–216, 452).
2. **Never write a key that failed to load.** Record failed keys in `cargarDatos` (452–453) and block `sk()` for them, with a reload prompt. Make `iniciarSinMigrar`/`migrarAprobarExistentes` skip all writes if `ids` did not load (573, 578, 632–635). This closes the data-loss path in risk #2.
3. **Debounce the per-keystroke saves** (≥600 ms, as `_costosSaveT` already does): `fichaSetImporte` 6742, `analUpdMontoFijo` 7265, `analUpdMontoProc` 7287. Also debounce the search inputs (4302, 4435, 4491, 4650) by ~200 ms.
4. **Add an `id→OT` / `cotId→OTs` / `id→quote` / `cotId→ficha` Map**, cached like `_cliIndex` (697–702). Use it at 4466, 4479, 7037, 7054, 7105, 7109, 7393 and 6194. The quadratic screens become linear: 4 s → <50 ms at 36 months.
5. **Compute `capMetricas` once per machine** (merge 7411 and 7421). Iterate only the dates in range rather than `for(const f in dias)` over all history (7388).
6. **Use `snap.docChanges()`** in the listener (508–549). Patch `S[k]` in place and drop the two whole-array `JSON.stringify` calls.
7. **Drop the `getDocs` for the 6 synced collections** and take the listener's first snapshot as the initial load. This halves login reads. Also enable `persistentLocalCache` (IndexedDB) in `initFirebase` (187) so reloads resume from cache.
8. **AI function:** set `max_tokens` to ~3000 (`interpretar.js:85`), add an `AbortController` of ~9 s around the upstream fetch (81), add a total body-size guard (19–21), and add a client timeout plus non-JSON handling (7965–7966).
9. **Asset diet:** move the three base64 logos (lines 81, 147, 10457: 138 KB) into one cached `logo.jpg`, and minify (esbuild/terser) to strip the 55 KB of comments.
10. **Paginate `updateSegResults` "todas"** (4671) with the existing `_pagina`/`PER` helpers (129).

## 5. Deeper issues requiring refactoring

1. **Move every growing `BLOB_KEY` out of `_config` into its own collection**, one document per record:
   - `planificacion/{maq_fecha}` or `planBlocks/{id}`
   - `analCostos/{otId}`
   - `stockMovs/{id}`
   - `insumosMovs/{id}`

   Keep `_config` for truly small settings, and add a listener on it. This is **mandatory before approval** because it removes risks #1 and #6. Also store planning blocks as `{start,dur}` instead of one `{cont:true}` entry per 30-min slot (9391, 9456), and prune or archive past weeks.
2. **Server-side querying and lazy loading.** Use `where/orderBy/limit` with cursors for OTs, quotes, fichas, remitos and cotTrabajos. Load the active window (non-archived, last N months) at login, and fetch history on demand for reports. Rework `ld`/`cargarDatos`/`activarSincronizacion` (207–219, 449–556).
3. **Stop storing three copies of each costing** (3058, 9813, plus `cotTrabajos`). Reference the costing by id, or store a frozen snapshot only on approval.
4. **Server-side aggregates** for Análisis OT, Balances and Capacidad: per-month or per-machine rollup documents maintained on write, or a Cloud Function. Today these screens scan all history in the browser.
5. **Incremental rendering.** Replace `pg.innerHTML=fns[curPg]()` (4129) with keyed row updates or a small view library. Re-render only affected rows on remote changes, and stop re-rendering the page under a user who is typing.
6. **Batched writes.** Use `writeBatch` (≤500 operations) in `sv` (242–251), migrations and `restaurarBackup` instead of serial `await setDoc`. Move restore to an admin script (Blaze plan or Admin SDK).
7. **Build pipeline and code splitting.** Split the 10.5k-line file into modules and lazy-load the cotizador, planning and reports.

## 6. Finding → location index

| Finding | File:lines | Function |
|---|---|---|
| Blob-in-one-doc model | index.html:205, 255–273 | `BLOB_KEYS`, `sv` |
| 23 separate `_config` reads | index.html:214–216, 451–453 | `ld`, `cargarDatos` |
| Full-collection reads, no limit | index.html:209–213 | `ld` |
| 8 s timeout → defaults | index.html:452–453, 317–333 | `cargarDatos`, `S` |
| Default write-back / mass approval | index.html:560, 573, 578, 629–636 | `iniciarSinMigrar`, `migrarAprobarExistentes` |
| Listener double-stringify + full render | index.html:508–549 | `activarSincronizacion` |
| No `_config` listener; whole-field overwrite | index.html:503, 263 | `activarSincronizacion`, `sv` |
| O(n) sanitize + stringify on each save; serial writes | index.html:294–304, 242–251 | `_sanitizeColeccion`, `sv` |
| Per-keystroke saves | index.html:6742–6748, 7265–7272, 7287–7293 | `fichaSetImporte`, `analUpdMontoFijo`, `analUpdMontoProc` |
| Slot-per-entry planning, auto-fill | index.html:9364–9395, 9444–9458 | `autoPlanReal`, `crearBloqueDrop` |
| Append-only logs in `_config` | index.html:5333–5343; 1714–1771 | `stockMov`; insumos movements |
| Full page re-render | index.html:4123–4140 | `render` |
| Unpaginated "todas" board | index.html:4663–4718 | `updateSegResults` |
| Quote search O(C×N) per keystroke | index.html:4443–4468 | `updateCotResults` |
| Análisis OT O(N×(C+N+F)) | index.html:7035–7038, 7050–7060, 7104–7114 | `rAnalOT`, `fichaDeOT` |
| Capacity: full history scan + find, ×2 | index.html:7385–7403, 7411, 7421 | `capMetricas`, `rCapacidad` |
| Per-machine OT scans | index.html:5669–5682 | `rPlan` |
| Per-slot find | index.html:6172, 6194 | `rCalSemanal` |
| Paper module per-row recompute | index.html:5488–5560, 5040–5074, 5076–5117 | `rPapel`, `_papelPrefillDesdeCosteo`, `papelCalc`, `corteInfo` |
| Costing engine (acceptable) | index.html:953–1026, 2047+, 2309–2313, 8108–8152 | `_catCortes`, `cotPapelOpciones`, `cotCalc`, `cotSync`, `aiCostearOptimo` |
| Triple-stored costing | index.html:3058, 9813 | quote/ficha creation |
| Inline base64 logos (138 KB) | index.html:81, 147, 10457 | sidebar, `_appLogo`, `generarPDFCotizacion` |
| Backup / restore | index.html:4186–4206, 4252–4272 | `descargarBackup`, `restaurarBackup` |
| PDF via hidden iframe | index.html:10375, 10480–10517 | `generarPDFCotizacion`, `_descargarComoPDF` |
| AI: no timeout, 8k tokens, no size guard | interpretar.js:19–21, 81–93 (85); index.html:7948–7971 | `handler`, `aiInterpretar` |
| Client/prov Map index (good) | index.html:697–708 | `_cliIndex`, `_provIndex` |
| Pagination / archive (good) | index.html:129–135, 4502–4520 | `_pagina`, `archivarOT`, `updateOTResults` |

---

## 7. Changes vs 2026-09-16 audit

| Area | 2026-09-16 finding | Now | Verdict |
|---|---|---|---|
| Payload | "8,619 lines, ~450–500 KB est." | **10,572 lines, 1,019,072 B measured** (br 259 KB); a new 124 KB base64 logo inside the PDF template (10457); still no build step | **Worse** |
| CSS / mobile | everything inline | `styles.css` extracted; responsive breakpoints (32/38/71); mobile menu | **Improved** |
| `render()` full rebuild | 199 refs / 135 calls / 68 `innerHTML=` | **235 / 163 / 73** | **Worse** (more call sites, same model) |
| List pagination | partial (cli/prov) | quotes, OTs and fichas paginated via `_pagina`; OT archiving | **Improved** |
| `updateSegResults` "todas" unbounded | line 3424 | still unbounded (4671) | Unchanged |
| Dashboard multi-filter | 6+ passes (3077–3085) | 7 passes (4321–4328) | Unchanged |
| Name lookups `cNom` | O(n) find | cached `Map` (`_cliIndex`/`_provIndex`, 697–708) | **Improved** |
| Whole-collection load, no pagination | lines 209–211, 433–437 | identical (209–213, 449–453) | Unchanged |
| onSnapshot double stringify + full render | 492–512 | identical (508–528); `docChanges()` still unused | Unchanged |
| `capMetricas` ×2 + `S.ordenes.find` | 5652/5670/5680 | identical (7393/7411/7421) | Unchanged |
| `rPlan` per-machine scans | 4177–4186 | identical (5670–5679) | Unchanged |
| Per-save O(n) stringify diff | 240–249 | identical (242–251), plus `_sanitizeColeccion` O(n) per save (294–304) | Slightly worse |
| AI paste listener stacking | possible (6160) | removed on close (7903/7905) | **Fixed** |
| AI `max_tokens 8000`, no size guard | line 82 | still 8000 (85); still no total-size guard; context now capped (7956–7963) | Partly improved |
| **`_config` single-doc 1 MiB / 40k index-entry limits** | not assessed | **Critical, ~3–9 months to failure** | **New finding** |
| **23 separate reads of `_config`** | not assessed | lines 214–216, 452 | **New finding** |
| **Timeout → defaults → overwrite** | not assessed | 452–453, 560, 573, 578, 632 | **New finding** |
| **Per-keystroke full-field `analCostos` / `fichas` saves** | prior audit said saves were debounced | 6742, 7265, 7287 (not debounced) | **New finding** |
| **O(n²) quote search & Análisis OT** | not assessed | 4466; 7054/7105/7109 | **New finding** |
| **`autoPlanReal` slot-filling growth** | not assessed | 9364–9395 | **New** (feature added since) |
| **BLOB last-writer-wins across users** | not assessed | 503, 263 | **New finding** |
| **Restore over Spark write quota** | not assessed | 4252–4272 | **New finding** |

**Net:** of the three top risks named on 2026-09-16 (whole-collection load, snapshot amplification, capacity screen), **none has been addressed**. The improvements since then (pagination, `Map` index, CSS, paste fix) are real but peripheral. In the same period the payload doubled, `render()` call sites grew ~20%, and new unbounded writers were added into the single `_config` document. That document is now the dominant risk.

---

*Recommended before close:*
1. Export the real `gp/_config` and measure its byte size and leaf-field count. The script used here is ~30 lines.
2. Profile login on a throttled "Fast 4G" connection with a 12-month synthetic dataset. Check whether the `_config` load beats the 8 s window.
3. Confirm the Firebase billing plan (Spark vs Blaze) and any index exemptions configured in the console.
