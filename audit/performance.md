# Gráfica Pro — Performance & Scalability Audit

**Scope:** Performance/scalability only. Acquisition due-diligence. Evidence-based, exact file/function/line.
**Artifacts reviewed:** `index.html` (8,619 lines, single-file SPA), `netlify/functions/interpretar.js` (99 lines).
**Method:** static analysis + occurrence counts via ripgrep. No production code modified. No runtime profiling (no deployed instance profiled), so wall-clock numbers below are complexity-derived estimates, not measurements.

---

## Executive summary

**Overall performance score: 4 / 10.**
**Risk rating: HIGH.**

The app is a functional single-file SPA that works fine at *current* data volume (hundreds of records) but has three structural properties that degrade **super-linearly** as `cotizaciones`/`ordenes` grow into the thousands and as concurrent users increase:

1. **Full-`innerHTML` re-render on nearly every state change** — no diffing, no virtualization; entire page template strings rebuilt and reparsed.
2. **Every collection held fully in memory** (`S`) with **no server-side pagination**; `onSnapshot` streams whole collections and, on each event, does a full `JSON.stringify` of both local and remote arrays before a full re-render — across 6 collections, on every write, for every connected client.
3. **Hot render paths perform nested O(records) scans** (`S.ordenes.find` inside per-block/per-machine loops).

None are fatal today; all are the kind of debt that turns a snappy tool into a 3–5 second-per-click tool at 10× data, and the fix touches the core architecture, not the edges.

---

## Rubric

| # | Criterion | Score | Weight |
|---|-----------|:-----:|:------:|
| 1 | Initial load / payload | 5 | 15% |
| 2 | Rendering architecture | 4 | 20% |
| 3 | Data loading & scaling model | 3 | 20% |
| 4 | Hot compute loops (big-O) | 4 | 15% |
| 5 | Persistence write model | 5 | 10% |
| 6 | Realtime sync overhead | 3 | 15% |
| 7 | Memory / listener hygiene | 7 | 5% |
| 8 | AI serverless function | 6 | — |
| | **Weighted overall** | **~4.0** | |

---

### 1. Initial load / payload — 5/10

- **Single monolithic `index.html`, 8,619 lines.** All application JS is inline in one `<script>` block spanning **lines 122–8619** (~8,500 lines of code in one tag). At the stated ~120k tokens this is roughly **450–500 KB of uncompressed source** shipped as one document. Netlify serves it gzip/brotli-compressed (≈90–120 KB over the wire) with ETag/304 on repeat visits, which softens this — but:
  - **No minification / no build step.** All comments, whitespace, and Spanish explanatory prose ship to the client and are parsed on every cold load. Grep shows dozens of full-sentence comments in the hot code.
  - **No code splitting.** The cotizador math (`cotCalc`, line 1661), planning grid, balances, AI modal, etc. all parse up-front even though a given session may touch one screen.
  - **Embedded base64 logo** inline at **line 147** (`window._appLogo`, a full JPEG data URI) is parsed as part of the main script and re-injected as favicon 3× (line 150).
  - **3 Firebase ESM modules** dynamically imported from `gstatic.com` at runtime (`initFirebase`, lines 183–185: firebase-app, firebase-firestore, firebase-auth) — extra round-trips on the critical path, gated behind a 10 s race timeout (line 324).
- Net: acceptable for an internal tool over broadband; the score is capped because there is **no build pipeline at all**, so nothing prevents the payload from growing unbounded as features are added to the one file.

### 2. Rendering architecture — 4/10

- **`render()` (line 2880) rebuilds `Q('pg').innerHTML` wholesale** from a template-string function per page (`fns` map, line 2881): `pg.innerHTML=fns[curPg]()` (line 2886).
- Occurrence counts (whole file): **`render()` referenced 199×**, **`render();` called 135×**, **`.innerHTML=` 68×**. Combined with **35** inline `onclick="render()" / onchange="render()" / oninput=` handlers, this means most user interactions trigger a **full teardown + rebuild + reparse** of the active page's DOM subtree.
- **Consequences:**
  - Full reflow/repaint of the page container on every change.
  - **Loss of transient DOM state** — focus, scroll, uncommitted input, `<details>` open state. The code visibly fights this: `render()` manually saves/restores `scrollTop` (lines 2884–2893) and several flows re-`focus()` inputs via `setTimeout` (e.g. lines 1319, 5853, 6160). These are symptoms of the anti-pattern, not fixes.
  - Some lists were partially rescued — `updateCliTable`/`updateProvTable`/`updateCotResults`/`updateSegResults`/`updateDashResults` write only into a `tbody`/results `div` and support client pagination (`PER=25`, line 142). Good. But the *surrounding* page is still fully rebuilt whenever `render()` is called from a tab/filter click (e.g. `fSeg='atr';render()` line 3441).
- **Worst offenders (no virtualization):**
  - `updateSegResults` (line 3416): the `'todas'` tab does `S.ordenes.slice()` (line 3424) and builds one `<tr>` per order with `SEG_COLS` cells each — a single giant HTML string, no windowing. At 3,000 orders this is ~3,000 rows × ~10 columns injected at once.
  - `updateDashResults` (line 3065) runs **6+ separate `.filter` passes** over `S.ordenes` (lines 3077–3085) every render.

### 3. Data loading & scaling model — 3/10

- **Whole collections resident in memory** in global `S`. On login, `cargarDatos` (line 433) loads **all** `COL_KEYS` + `BLOB_KEYS` (lines 435–437) via `ld(k)` which does `getDocs` over the **entire** subcollection: `window._fsGetDocs(window._fsCol(db,'gp',k,'docs'))` then `snap.docs.map(...)` (lines 209–211). **No `limit()`, no `where()`, no cursor.**
- `COL_KEYS` (line 201) = `clientes, proveedores, cotizaciones, ordenes, remitos, fichas, gastos, cotTrabajos`. Every one is pulled in full at startup. At thousands of `ordenes`/`cotizaciones` this is a large initial read (Firestore bills per doc read, and the browser holds the full object graph).
- **Pagination is client-side only** (`PER=25`, `pCot`/`pOT`/`slice`, e.g. lines 2908, 3271). It reduces DOM rows rendered but does **nothing** for network/read cost or memory — the full dataset is already downloaded and in RAM.
- **Realtime listeners on 6 collections** — `activarSincronizacion` (line 482) attaches `onSnapshot` to `clientes, proveedores, cotizaciones, ordenes, fichas, gastos` (`COLS_SYNC`, line 487). Each listener receives the **entire** collection snapshot on any change (line 494 `snap.docs.map(d=>d.data().v)`).
- **Trajectory:** at 5,000 orders + 5,000 quotes, initial load = ~10k doc reads streamed to the client, held in memory, mirrored by 6 always-open listeners. This is the single biggest scalability ceiling.

### 4. Hot compute loops — 4/10

Occurrence counts: **`.find` 192×, `.filter` 195×, `.forEach` 256×, `.map` 162×** across the file. Most `S.ordenes.find(x=>x.id===...)` in *event handlers* are fine (one lookup per user action). The problem is the ones **inside render loops**:

- **`capMetricas` (line 5644)** — for a machine, iterates every planned day × every slot, and for each production block calls `S.ordenes.find(x=>x.id===b.otId)` (line 5652). Complexity **O(days × slots × |ordenes|)** per machine.
  - **`rCapacidad` (line 5666) calls it twice per machine:** once in the `conAct` filter (line 5670) and again in the `rows.map` (line 5680). So the capacity screen is **O(2 × machines × days × slots × |ordenes|)**. With ~9 machines, a year of planning, and thousands of orders, this is the most expensive single screen.
- **`rPlan` (line 4170)** — `S.maquinas.forEach` (line 4176) with a `S.ordenes.filter` **per machine** (line 4177), plus extra full `S.ordenes.filter` scans for the "Pre-prensa" and "Guillotina" cards (lines 4181, 4186). **O(machines × |ordenes|)** just to draw the machine cards.
- **`rCalSemanal` / `rTallerDiario` (rendered from rPlan, line 4202)** — per-slot `S.ordenes.find(o=>o.id===bl.otId)` at lines 4453, 4650, 7320, 7328, 7704, 7762. Grid render is **O(slots × |ordenes|)**.
- **`cotCalc` (line 1661)** — called **16×** across the codebase (grep), including inside per-variant loops (`cotCalc(cotW,v.cantidad)` at lines 1896, 2270, 2484, 2840). Each call does 4× `.find` over config arrays (`cotPapeles`, `cotImpresion`, `cotChapas`, `cotLaminados`, lines 1676/1691/1706/1708) **per piece**. Config arrays are small, so this is O(variants × pieces × config) and only bites in the quote editor with many variants — moderate, not critical.
- **`rankingVendedores` (line 5730)** iterates all `fichas`, and `costoFicha`→`_costoRealOT` does object lookups (line 5721) — linear, acceptable.

### 5. Persistence write model — 5/10

- `sk(k)` → `sv(k,v)` (lines 291, 219). For `COL_KEYS`, `sv` iterates the **entire** array, `JSON.stringify`-ing every item to compare against a cache and writing only changed docs (lines 240–249). This is a **genuine improvement** over the old "rewrite whole collection every keystroke" model (documented in the comment at line 234) and is correctly debounced (`_costosSaveT` ~700 ms, lines 901/959; `_estrSaveT` 600 ms line 921).
- **But** every save is still **O(|collection|) in stringify work** on the client even when one field changed, because the diff requires serializing all items. At thousands of records, a debounced save of `ordenes` stringifies the whole array. Tolerable at current scale, a latency spike at 10×.
- `JSON.parse(JSON.stringify(...))` deep-clone pattern appears **23×** (grep) — used for undefined-stripping (line 246) and config sanitize (line 256); each is a full serialize/parse of the value.

### 6. Realtime sync overhead — 3/10

- The `onSnapshot` callback (lines 492–535) on **every** remote event, for **each** of 6 collections, does:
  - `JSON.stringify(S[k]||[])` **and** `JSON.stringify(docs)` over the **entire** collection to detect change (lines 496–497) — **O(|collection|) serialization per event**.
  - On any genuine change, rebuilds `_knownIds` and `_docJson` caches by stringifying every doc again (lines 508–511) and then calls **full `render()`** (line 512).
- **Amplification:** in a multi-user shop, one user editing one order fires a snapshot on **every** connected client, each of which stringifies the whole `ordenes` array twice and rebuilds the entire visible page. At thousands of orders × several concurrent users, this is the most likely source of perceived "the app froze" jank.
- The anti-echo/anti-clobber machinery (lines 468–531, `_saveEnCurso`, `_snapPend`, 2.2 s deferral) is clever and necessary given the model, but it is **complexity compensating for the wrong architecture** (syncing whole collections instead of deltas). `snap.docChanges()` is available and unused.

### 7. Memory / listener hygiene — 7/10

- **Listeners are cleaned up before re-subscribe:** `activarSincronizacion` unsubscribes prior listeners (`_snapshotUnsubs.forEach(u=>u())`, lines 485–486). Good.
- **Timers are singletons or cleared:** `window._backupTimer` single `setInterval` (line 342, 10-min poll); debounce timers use `clearTimeout` before re-set (lines 901, 921, 959). No obvious runaway-interval leak.
- **18 `addEventListener` total.** One mild concern: `ov.addEventListener('paste', aiPasteHandler)` (line 6160) is attached each time the AI modal opens; if `ov` is the same reused node across opens, handlers could stack. Low severity (single modal, function reference is stable so duplicates are deduped by the browser only if same reference — worth a look, not a blocker).
- `URL.createObjectURL` blobs are revoked (lines 2958, 8565). Good.

### 8. AI serverless function (`interpretar.js`) — 6/10

- **`max_tokens: 8000`** (line 82) with `tool_choice` forced — the model may generate up to 8k output tokens; combined with a large system prompt (lines 24–40, embeds full catalogs via `JSON.stringify`) this drives **latency and cost** on every call. Most quote interpretations need a fraction of that; the ceiling is high and there's no streaming, so the client waits for the full completion.
- **Images:** up to **4** base64 images (line 21), downscaled client-side to max **1600 px, JPEG q0.85** (`aiDownscale`, lines 6184–6193). A 1600 px JPEG ≈ 200–500 KB → ~270–670 KB base64 each; 4 of them ≈ **1–2.7 MB** JSON body. Under Netlify's **6 MB** synchronous-function limit in the typical case, but a pathological 4-image request approaches it — no explicit total-size guard exists (only per-count `.slice(0,4)` and per-item mediaType filter, lines 19–21).
- **Cold starts:** standard Netlify Lambda cold-start (~0.5–2 s) added to a multi-second model call; acceptable for an occasional assist feature.
- **Pedido truncated to 8,000 chars** (line 15) — sensible guard. CORS `*` (line 5) is a security note, out of scope here.
- Reasonable overall; main lever is dropping `max_tokens` and adding a total payload-size check.

---

## Top risks blocking approval

1. **Whole-collection in-memory model with no server-side pagination (lines 201, 209–211, 433–437).** Initial load reads and holds *every* order/quote/invoice. This is the hard scaling ceiling — it caps how large a single tenant's dataset can get before login itself becomes slow and memory-heavy. **Blocker for any customer with multi-year history.**
2. **Full-collection `JSON.stringify` + full `render()` on every realtime event, ×6 collections, ×every client (lines 492–512).** Multi-user editing at scale produces cross-client full re-renders. **Blocker for concurrent-user scaling.**
3. **`rCapacidad` calling `capMetricas` twice per machine, each O(days×slots×|ordenes|) with an inner `S.ordenes.find` (lines 5652, 5670, 5680).** The capacity screen degrades quadratically. **Blocker for the reporting/analytics value proposition at scale.**

## Quick wins (low risk, high leverage — no architecture change)

- **Add a build step** (esbuild/terser) to minify + strip comments from `index.html`. Immediate ~40–60% source-size cut, zero behavior change.
- **Replace whole-array stringify diffing in `onSnapshot` with `snap.docChanges()`** (lines 494–512) — react only to added/modified/removed docs; skip the O(n) double-stringify.
- **Build an `id → order` Map once per render** and reuse it in `capMetricas`, `rCalSemanal`, `rTallerDiario` instead of `S.ordenes.find` per block (lines 5652, 4453, 4650, 7320, 7328, 7704, 7762). Turns O(slots×|ordenes|) into O(slots).
- **Compute `capMetricas` once per machine** in `rCapacidad`: merge the `conAct` filter (line 5670) and `rows.map` (line 5680) into a single pass. Halves the most expensive screen instantly.
- **Memoize the dashboard's 6 filter passes** (lines 3077–3085) into a single loop.
- **Lower AI `max_tokens`** (line 82) to a realistic ceiling (~2000–3000) and add a total-payload byte guard before the fetch (line 78).

## Deeper refactors (required for true scale)

- **Server-side pagination / lazy loading.** Query `ordenes`/`cotizaciones` with `where`/`orderBy`/`limit` + cursors; load lists on demand instead of the full collection at login (rework `ld`, `cargarDatos`, lines 205–216, 433). This is the single change that unblocks large tenants.
- **Incremental rendering instead of full `innerHTML` rebuild.** Adopt a diffing layer (a lightweight vdom, or targeted `update*` functions for *every* screen the way `updateSegResults` already does for its table) so `render()` (line 2886) stops tearing down and reparsing whole pages. Removes the focus/scroll-restoration hacks as a side effect.
- **List virtualization** for `updateSegResults` "todas" and any unbounded table (line 3424) so row count no longer scales with dataset.
- **Delta-based sync** end to end (write deltas, listen to `docChanges`, patch `S` in place, targeted re-render of affected rows only) — replaces the whole `activarSincronizacion` + anti-clobber machinery (lines 468–540) with something that scales to thousands of records and multiple users.
- **Split the 8,600-line file into modules** with code splitting so screens load their code on demand.

---

*Prepared for acquisition performance/scalability due diligence. Findings are static-analysis-based; recommend a runtime profiling pass (Chrome Performance panel on a seeded 5,000-order dataset) to confirm the estimated big-O breakpoints before close.*
