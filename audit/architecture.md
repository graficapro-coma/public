# Gráfica Pro — Architecture & Maintainability Audit

**Scope:** Architecture / maintainability ONLY (security, performance, UX, DB covered in sibling reports).
**Perspective:** Acquisition due-diligence. Buyer is looking for reasons NOT to buy. Brutally honest.
**Date:** 2026-10-02 (supersedes the 2026-09-16 version of this file)
**Reviewer:** Independent code audit (read-only; no production code modified).
**Snapshot audited:** `index.html` last modified 2026-10-02 12:40, `netlify/functions/interpretar.js` 2026-10-01, `tests/pruebas.js` 2026-07-12, `styles.css` 2026-07-12.

---

## 0. What was measured (hard numbers)

All numbers below were gathered with read-only `node`/PowerShell counts over the working copy. "Function length" = distance from a top-level declaration to the next top-level declaration (same method for every function, so the ranking is reliable even if absolute numbers differ slightly from the 09-16 method).

| Metric | 2026-09-16 | **2026-10-02** | Δ | Evidence |
|---|---|---|---|---|
| `index.html` lines | 8,621 | **10,572** | **+1,951 (+22.6%)** | line count |
| `index.html` size | — | **1,015,267 chars** | — | `ReadAllText().Length` |
| Main app `<script>` | L122–8619 (~8,498) | **L122–10569 (~10,447 lines)** | +1,949 | `<script>` L122, `</script>` L10569 |
| `function` declarations (named) | 555 (all fn-like) | **665 named + 64 arrow consts**; 748 `function` keywords; 1,426 `=>` | ↑ | regex counts |
| Top-level declarations | — | **662** in one global scope | — | node scan |
| `.innerHTML =` / `+=` | 68 / 8 | **79 / 6** | ↑ | grep |
| Inline `onclick=` | 328 | **462 (+41%)** | ↑ | grep |
| All inline `on*="…"` handlers | — | **638** | — | grep `\son[a-z]+="` |
| Inline `style="…"` attributes | — | **2,303** | — | grep |
| `window.*` references | 125 | **251 (×2)**; **58 distinct `window.` globals** | ↑↑ | grep + distinct set |
| Top-level mutable `let` lines | ~30 names | **30 `let` lines** (≈55 names) outside `S` | ↑ | node scan |
| Distinct `S.<key>` fields used | — | **35** (incl. 2 dead) | — | grep |
| `try` blocks / **empty `catch(e){}`** | 103 kw (~50 blocks) | **99 try / 99 catch / 49 empty catches** | ≈ / worse | grep |
| `typeof X==='function'` defensive self-checks | — | **49** | — | grep |
| Script lines > 300 chars | — | **374** | — | node scan |
| Longest code line | — | **L906: 19,459 chars** (`COT_SEED`), **L9847: 2,490 chars** (entire undo subsystem) | — | node scan |
| Base64 images inlined | — | **3 (138,509 chars ≈ 13.6% of the file)**; L81 and L147 are the **same logo twice**, L10457 a 124 KB logo inside the PDF template | — | regex |
| Hard-coded machine literals | — | `'SM52'` ×35, `'SM74'` ×40, `'Xerox'` ×37 | — | grep |
| `alert(` / `confirm(` / `prompt(` | — | **83 / 47 / 25** | — | grep |
| `package.json` / lockfile / linter / CI | 0 | **0** | = | glob |
| Tests | 204 lines, copies of prod code | **same file, unchanged since 2026-07-12; 59 assertions, all on copies** | = (relatively worse) | `node tests/pruebas.js` → 59 ✓ |
| Git history (local `.git`) | — | **1 commit ("Initial commit", 2026-07-11)**; last fetch 2026-07-17 | — | `.git/logs/HEAD` (1 entry) |

---

## 1. Rubric & Scores

| # | Criterion | 09-16 | **Now** | One-line justification |
|---|---|---|---|---|
| 1 | Modularity / separation of concerns | 2 | **2** | 10.4k-line single global script; the pricing engine now has hidden write side-effects. |
| 2 | Code size, complexity & duplication | 3.5 | **3** | +22.6% in 16 days; `rCotizador` 346 lines / 50 KB; verbatim-duplicated blocks keep multiplying. |
| 3 | Global state coupling & state integrity | 3 | **2** | `window.*` doubled; `sv`/`sk`/`render` monkey-patched at runtime; pointer-swap invariants maintained by hand. |
| 4 | UI/markup coupling (HTML generation) | 3 | **2** | 462 inline `onclick`, 2,303 inline styles; nav state read back from `onclick` attribute text. |
| 5 | Error handling & persistence integrity | 4 | **4** | Blob saves fixed (`updateDoc` per field) but 49 empty catches and non-atomic two-key saves remain. |
| 6 | Testability & test coverage | 3 | **2** | Zero tests for any feature added since July; tests still exercise copies, not production code. |
| 7 | Build / dependency / deploy hygiene | 3 | **3** | No manifest, no SRI, no CI; two live hosting targets deployed from a Google Drive folder. |
| 8 | Documentation, version control & bus factor | n/a | **2** | ~2.5 months of changes are not in git; only roadmap doc is 3 months stale. |

### **OVERALL: 2.5 / 10** (09-16: 3 / 10) — Maintainability risk: **HIGH** · Technical debt: **CRITICAL**

The app keeps gaining real, domain-rich features (per-quantity costing, a paper catalog with cut/machine optimisation, stock reservation, an OT state machine), and several individual fixes are well reasoned. But all of it went into the same global namespace at roughly **120 lines/day**, with no tests, no version control and an increasing number of *implicit* invariants ("call `_cotUnswap()` before saving", "`cotMaqExtra()` may write config", "snapshots within 2 s are ignored"). The codebase is getting harder to hand over, not easier. For a buyer, the asset is the **domain knowledge encoded in it**, not the code as a maintainable product.

---

## 2. Detailed findings & evidence

### Criterion 1 — Modularity / separation of concerns — **2/10** (unchanged)

- Still one classic `<script>` **L122–L10569**, 662 top-level declarations in one scope, no `import`/`export`. Firebase SDK functions are still re-exported to `window` in `initFirebase()` (**L189–198**: `window._fsOnSnapshot`, `_fsDoc`, `_fsGet`, `_fsSet`, `_fsUpdate`, `_fsCol`, `_fsGetDocs`, `_fsDelDoc`, `_fsRunTxn`, `_fsAuth`).
- **The pricing engine is not a pure function.** Call chain: `cotCalc()` (L2047) → `cotPapelDePieza()` (L1047/L2065) → `cotPapelSelResolver()` (L1028) → `cotPapelOpciones()` (L989) → `cotPliegoEnMaq()` (L2491) → `cotMaqMax()` (L2486) → **`cotMaqExtra()` (L2469)**, which mutates `S.cotConfig.maqExtra` (`l.push(...)` L2479), calls `asegurarExterno(n)` (mutates `S.externos`) and schedules a Firestore write: `window._maqExtraT=setTimeout(()=>{try{sk('cotConfig');}catch(e){}},300)` (L2480). A "calculate a price" call can therefore persist configuration. `cotMaqExtra()` is reached from 10 call sites, including render paths (`cotMaqLista` ×8, `cotEsMaqExtra` ×11).
- **UI state leaks into the domain engine:** `cotCalc` reads the editor's transient swap field: `...:(w._piezasBase||cotPiezasDe(w))` (L2053). The calculator has to know about a UI tab-switching trick.
- **Side-effecting "check" functions:** `papelChequearStock(o)` (L5207) — the name says *check*, the body rewrites the OT's material (`m.material=s.material; m.marca=...` L5216), flips `o.papel.enStock` (L5218), mutates the stock item's reservation string and calls `sk('stockPapel')` (L5219).
- **Business rules duplicated across the client/server boundary:** machine-selection heuristics and the "2 hojas A3 per SM74 sheet" rule are written in prose in the AI prompt (`interpretar.js` L29, L39) and in code in `_cotPagAplicar1` (L3495, L3504). The prompt's "exact JSON shape" (L25) does not match the tool `input_schema` (L45–76; e.g. `laminado`, `revista`, `familia` exist only in the schema/rules). No shared contract.
- Business price data lives in source: `COT_SEED` (L906, 19 KB on one line) and `COT_PAPEL_CAT_SEED` (L925–942, USD/kg and ARS box prices). A price update is a code deploy unless the user has already overridden it in `S.cotPapelCat` (`cotPapelCat()` L943).

### Criterion 2 — Code size, complexity & duplication — **3/10** (was ~3.5)

- **Growth:** +1,951 lines in 16 days with zero structural extraction. `index.html` is now ~1 MB, 13.6% of which is base64 images (logo duplicated at **L81** and **L147**; 124 KB logo at **L10457** inside `generarPDFCotizacion`, making that 105-line function 133 KB).
- **Largest functions (lines / chars):**

  | Function | Lines | Size | Location |
  |---|---|---|---|
  | `rCotizador` | **346** (09-16: ~308) | 50.2 KB | L3766–4111 |
  | `rCostos` | **281** (09-16: ~201) | 31.7 KB | L1282–1562 |
  | `rAnalOT` | 237 | 18.2 KB | L6995–7231 |
  | `rCalSemanal` | 194 | 17.7 KB | L6162–6355 |
  | `rFichaVer` | 185 (09-16 reported ~447) | 21.0 KB | L6462–6644 |
  | `rInsumos` | 182 | 16.6 KB | L1827–2008 |
  | `cotDesdeItem` | 143 | 9.4 KB | L3090–3232 |
  | `cotCalc` | 127 | 9.1 KB | L2047–2173 |
  | `_cotPagAplicar1` (new) | **117** | 7.5 KB | L3466–3582 |
  | `updateDashResults` | 109 | 10.6 KB | L4309–4417 |
  | `cotPagCalc` (new) | 106 | 8.0 KB | L3338–3443 |

  `rFichaVer`'s drop in line count is accompanied by ~114 chars/line; it is denser, not decomposed.
- **`_cotPagAplicar1` (L3466)** — 117 lines with 5 nested closures (`tomar`, `matchImp`, `setPz`, `tienePapel`, `copiarPapel`), mutating `cotW.piezas`, `cotW.otros`, `cotW.manuales` and `cotW.paginado._term`. It is driven by a **fixed-point loop capped at 3 iterations** in `cotPagAplicar` (L3460–3463) that compares a `JSON.stringify` "signature". If it doesn't converge in 3 passes it **silently stops**, with no warning. The loop exists because paper format ↔ machine ↔ sheets-per-pliego are circularly dependent, and the code doesn't model that dependency explicitly.
- **Verbatim duplicates (sample):**
  - Cost snapshot block `cotW.calc={total:Math.round(r.total),venta:...}` + `cotW.calcVariantes=...map(...)`: **L2978–2982 ≡ L3260–3264** (`cotGuardar` vs `cotEmbedAplicar`).
  - Step transition `pending→active→done` with `fechaInicio/fechaFin`: **5 copies** (L4817, L4975, L5372, L10368 `avP`, L10369 `avPN`).
  - `(Array.isArray(o.itemsOT)&&o.itemsOT[0]&&o.itemsOT[0].desc)||String(o.descripcion||'').split(' + ')[0]`: **L5049, L8819, L8872**.
  - `S.ordenes.find(x=>x.id===…)`: **54 lines** — no `getOT(id)` accessor.
  - "save with indicator" wrapper re-implemented instead of using `sk()`: `costosSave` (L1055), `cotGuardar` (L2988–2989), and **8 inline copies** for insumos (L1635, 1672, 1716, 1720, 1729, 1750, 1775, 1802).
  - **Four HTML escapers still exist:** `escHtml` (L875), `cotEsc` (L909), `insEsc` (L1621, which doesn't escape `&`), local `escH` (L8406, which doesn't escape `"`). Unchanged since 09-16.
- **Magic constants:** machine names hard-coded >110 times; chapas codes `cc=(p.maquina==='SM52')?2:(p.maquina==='SM74')?3:0` (L3512); machine limits `COT_MAQ_MAX` (L2466); IVA `0.21` ×8.

### Criterion 3 — Global state coupling & state integrity — **2/10** (was 3)

- **Runtime monkey-patching of core functions (3 layers):**
  1. `sv` is reassigned in an IIFE: `const _svOriginal=sv; ... sv=async function(k,v){...}` (**L486–497**) to track `window._saveEnCurso` / `_ultimoGuardadoLocal`.
  2. `sk` and `render` are reassigned for the undo feature: `var __origSk=sk;sk=function(k){...}` and `var __origRender=render;render=function(){...}` — all on **one 2,490-char line, L9847**, appended after a closing `}` of an unrelated function.
  3. So a call to `sk('ordenes')` runs: undo wrapper (deep-clones the **entire** collection, `__undoClone(S[k])`) → original `sk` → sanitizer → patched `sv` → original `sv`. You can't see this from any of the call sites. A maintainer who "fixes" `sk` at L306 edits the innermost layer only.
- **Undo is collection-level and blind to other users:** `doUndo` does `S[e.k]=e.prev; ... sk(e.k)` (L9847), restoring a *whole* array snapshot (up to 20 deep). If another user changed an OT in between, undo silently reverts their change too.
- **Concurrency is resolved by timers:** snapshot listener (L506–549) replaces the whole collection `S[k]=dcs` (L522) and suppresses remote snapshots for **2,000 ms** after a local save, re-checking after **2,200 ms** (L533, L545). Correctness depends on network latency staying under those numbers.
- **Per-quantity costing (`porCant`) uses pointer swapping on global state:** `_cotSwapA(c)` (L2260) stores the base pieces in `cotW._piezasBase` and points `cotW.piezas` at `cotW.porCant[c].piezas`; `_cotUnswap()` (L2259) reverses it. The invariant "never persist or compute while swapped" is enforced **by hand at 7 call sites** (L2261, 2284, 2967, 2975, 3257, 3283, plus `cotCalc` reading `_piezasBase` at L2053). `nav()` (L4112) and `render()` (L4123) don't enforce it. `cotVerDesglose` (L3291) writes `cotW.piezas=cotPiezasDe(cotW)` without unswapping. The design works only as long as every future code path remembers the rule.
- **`cotW` (L1971)** — the cotizador working object — is referenced **307 times**. **58 distinct `window.*` globals** carry state (e.g. `_cotVistaCant`, `_cotEmbed`, `_cotVariantes`, `_cotVarActiva`, `_cotItems`, `_papelModo`, `_papelTab`, `_papelFiltroPapelera`, `_procCol`, `_extraCtx`, `_estrAprEi`, `capPeriodo`, `capOffset`, eight `__undo*` symbols), on top of ≈55 module-level `let` names in 30 declarations (L124–141, L484, L697–714, L908, L1577, L1971, L4122, L4511, L5956–5958, L6923, L6989–6993, L7650, L7679, L9426, L9512).
- **The global `S` is shadowed** inside `cotPliegoEnMaq`: `const L=Math.max(...), S=Math.min(dims[0],dims[1]);` (**L2493**). It's harmless today, but it's a trap the next time someone needs app state in that function.
- **Stock reservations are a comma-joined string of OT numbers** (`s.reservaOT=lst.join(', ')` L5219; parsed by `_resLista` L5173, 6 call sites). They're keyed by human-visible `num` instead of `id`, aren't referentially checked, and are kept consistent across **two separately-saved stores**: `ordenes` (per-doc collection) and `stockPapel` (a field in the single `_config` blob, `BLOB_KEYS` L205). `stockLibrePara` (L5186) recomputes availability by scanning all OTs for every stock item (`papelStockCandidatos` L5196 → O(stock × OTs)), with liveness rules (`sigueVigente` L5189) defined inline.
- **The OT state machine is only partly centralised.** `recomputeEstadoOT(o)` (L4913) is a real improvement (12 call sites). But it's bypassed by direct writes (`if(o.estado==='lista')o.estado='en_produccion';` L4806), and two callers guard it with `typeof recomputeEstadoOT==='function'` (L5883, L5895). That guard is one of **49** such existence checks in the file, which shows the authors can't rely on declaration order or a dependency graph.

### Criterion 4 — UI/markup coupling — **2/10** (was 3)

- **462 inline `onclick`** (+134 since 09-16), **638 inline `on*` handlers**, **2,303 inline `style=` attributes**, `#185fa5` hard-coded **233** times despite `styles.css` existing (169 lines, untouched since 2026-07-12). A `<style>` block still sits in `<head>` (**L23–76**).
- **Navigation state is derived from markup text:** `n.classList.toggle('on',n.getAttribute('onclick')===\`nav('${p}')\`)` (**L4119**). If you rename a handler or add an argument, the menu highlight breaks.
- Inline handlers force `script-src 'unsafe-inline'` in the CSP (L8–10; the comment there says so).
- Unescaped interpolation is unchanged: `value="${bDash}"` (**L4302**, was L3058), and `hl()` (**L889**) still returns raw text wrapped in `<mark>`. Modals are built with raw `document.createElement('div')`+`innerHTML` side systems (e.g. `papelElegirParcial` L5236–5239, `__undoBtnRender` L9847) in parallel with the `om()`/`cm()` system (L7696/L7748).
- **UX primitives as architecture:** 83 `alert`, 47 `confirm`, 25 `prompt` calls. Business input such as user creation (`crearUsuario` L434–435) and machine sheet size (`_cotMaqFmtPrompt` L2498) is collected with `prompt()`, so you can't test or validate it.

### Criterion 5 — Error handling & persistence integrity — **4/10** (unchanged)

- **Improved:** blob saves now update a single field instead of read-modify-write of the whole `_config` document: `await window._fsUpdate(ref,{[k]:cleanV})` with a `not-found` fallback to `setDoc(...,{merge:true})` (**L259–267**). This removes the cross-key lost-update race that 09-16 implied. It is still last-writer-wins *within* a key (two users editing `stockPapel` concurrently: one loses).
- **Unchanged/worse:**
  - **49 empty `catch(e){}`** blocks (e.g. L233 deleting a Firestore doc during save; L1678 insumos save; L2479–2480 inside `cotMaqExtra`; L3069 `sv('cotTrabajos')`; L4132 `actualizarBadgeExt`).
  - **Non-atomic two-key saves with partial retry:** `await sv('insumosItems',…);await sv('insumosMovs',…)` then on failure `showSaveError('insumosItems',…)` (**L1716, 1720, 1750, 1775, 1802**). If the second write fails, the retry button (`retrySave` L176, single slot `window._pendingSave` L174) retries only `insumosItems`, and the movements log is silently not persisted. L1729 swallows it entirely.
  - **Paths that bypass `sk()` also bypass sanitisation and undo:** `cotGuardar` calls `sv('cotTrabajos',…)` directly (**L2989**, also L3069), although `cotTrabajos` is listed in `_SAN_FIELDS` (L285). So the "single place" sanitizer claim in the comment at L281–283 is false for this collection. There are 18 direct `sv(` call sites outside `sk`.
  - `sv()` for collections still awaits writes **sequentially per document** (L242–251), with no batch and no transaction (`runTransaction` used only 3×).
  - **Unbounded logs stored inside a single document:** `stockMovs` and `insumosMovs` are `BLOB_KEYS` (L205), i.e. arrays inside `gp/_config`, which has Firestore's 1 MiB per-document ceiling shared by 23 config keys. This is an architectural time bomb: when the movement logs grow, **every** config save will start failing.

### Criterion 6 — Testability & coverage — **2/10** (was 3)

- `tests/pruebas.js` has not changed since **2026-07-12**. It runs (59 ✓) but still tests **re-declared copies** (`uid` L14, `sanTxt` L26, `_pagina` L33, `puedeVerFinanzas` L65, `capNom` L94, `posesAuto` L151, …). Drift has already started: the test's `puedeVerFinanzas(email)` takes an argument, while production `puedeVerFinanzas()` (index.html **L689**) reads `rolUsuario()`.
- **None of the new logic has a single test:** `cotCalc` per-quantity (`_cotPorCant` L2250), `cotPapelOpciones`/`_catCortes` (L953, L989), `cotPagCalc`/`_cotPagAplicar1` (L3338, L3466), `recomputeEstadoOT` (L4913), `stockLibrePara`/`papelChequearStock` (L5186, L5207). These are exactly the pure-ish money/stock calculations that are *easiest* to test and *most expensive* to get wrong. The structure prevents it: every one reads the global `S`/`cotW`, and some write it.
- Test-to-code ratio has fallen from 204 test lines per 8,621 lines of code to 204 per 10,572, and the tests still cover none of the production code.

### Criterion 7 — Build / dependency / deploy hygiene — **3/10** (unchanged)

- Still **no `package.json`, lockfile, linter, formatter or CI** (glob: nothing outside `audit/`). `netlify.toml` (9 lines) has no build command, no test gate, no Node version.
- CDN dependencies still have **no SRI**: Tabler icons `@2.44.0` (L20), Firebase `10.12.0` dynamic imports (L183–185, again at L439–440).
- `interpretar.js` defaults to model `'claude-sonnet-5'` via env fallback (L11) and pins `anthropic-version: 2023-06-01` (L83); no declared runtime.
- **Two live hosting targets:** `.firebase/hosting..cache` shows `index.html` deployed to Firebase Hosting on 2026-10-01, while `index.html` L6–7 redirects `graficapro-coma.web.app` to Netlify at runtime. There are two deploy pipelines, both fed from a Google Drive folder.
- `firebase-config.js` is in `.gitignore` (L2) but is a hard runtime dependency (`<script src="firebase-config.js">` L121). A clean clone of the repo **cannot run**. Either Netlify isn't deploying from git, or production differs from git. I couldn't verify which; the buyer must ask.

### Criterion 8 — Documentation, version control & bus factor — **2/10** (new criterion)

- **Version control isn't being used.** `.git/logs/HEAD` has exactly one entry ("Initial commit", 2026-07-11); `refs/remotes/origin/main` dates from 2026-07-11, `FETCH_HEAD` from 2026-07-17. Since then `index.html` has changed continuously (last write 2026-10-02) in a **Google Drive** folder. `PENDIENTES.md` itself says "Google Drive guarda historial de versiones del archivo". There are no commits, branches, diffs or blame for ~2.5 months of changes, including every feature this audit was asked to verify.
- **Documentation:** `PENDIENTES.md` is "Última actualización: 9/7/2026" and describes none of the September features (paper catalog, porCant, stock reservations, maq extra). There's no README, data-model doc or architecture doc. The only systematic documentation is this `audit/` folder.
- **Positive:** inline comments are frequent, written in plain Spanish, and usually explain *why* (e.g. L236–238, L260–262, L2248–2258, L5179–5181). For a Spanish-speaking successor this is the main onboarding asset.
- **Identity hard-coding** ties the system to named people: `puedeVerFinanzas` regex `/gerencia|admin|contab|direccion|esteban|juanpablo/` (L689); `crearUsuario` gated on `'esteban-gerencia'` (L431); dead `ADMIN_EMAIL='esteban@graficapro.com'` (L429, 1 occurrence, never read).

---

## 3. Verification of the changes claimed since 09-16

| Claimed change | Verified? | Architectural assessment |
|---|---|---|
| Per-quantity configs (`porCant`, `_cotSwapA`/`_cotUnswap`) | **Yes** — L2248–2307, `cotCalc` L2052–2053, 28 `porCant` refs | Works through mutable pointer swapping on global `cotW`, with a hand-maintained invariant at 7 sites. Its UI-only field `_piezasBase` leaks into `cotCalc`. **Fragile.** |
| Paper catalog (`COT_PAPEL_CAT_SEED`, `cotPapelOpciones`, `cotPapelSelResolver`) | **Yes** — L925–1045 | The cleanest new code in the file: small, well-commented helpers (`_catCortes`, `_catOrigenes`). But prices are hard-coded in source, and the resolver chain ends in side-effecting `cotMaqExtra()`. It also recomputes all options (≤ formats × 16 cuts × 2 machines) on every resolve, with no memoisation. |
| Extra machines (`cotMaqExtra` auto-repair) | **Yes** — L2469–2483 | **A getter that writes**: it mutates `S.cotConfig`, `S.externos` and debounces `sk('cotConfig')`, and it's invoked from render and pricing paths. "Auto-repair" means the data model can lose entries and the code compensates silently. |
| Blob saves use `updateDoc` per field in `sv()` | **Yes** — L255–273 | Genuine improvement (removes the whole-document read-modify-write). Within-key last-writer-wins remains, as does the 1 MiB single-document ceiling. |
| OT state machine `recomputeEstadoOT` | **Yes** — L4913–4922, 12 callers | Good direction. Still bypassed by a direct write (L4806), and the step-transition logic it depends on is duplicated 5×. |
| Stock reservation (`papelChequearStock`, `stockLibrePara`, `reservaOT` comma lists) | **Yes** — L5173–5228 | Denormalised string FK keyed on OT number, spread across two independently-saved stores, with no transaction. "Check" function with write side-effects. |
| Paginado loop `_cotPagAplicar1` | **Yes** — L3455–3581 | 117-line mutating function inside a 3-iteration fixed-point loop with silent non-convergence. |
| (Not claimed) Undo subsystem | Found — L9847 | Monkey-patches `sk` and `render` on a single 2,490-char line; whole-collection deep clones on every save of 4 collections. |

---

## 4. Top risks that would BLOCK acquisition approval

1. **No version control of the product for ~2.5 months.** One local commit (2026-07-11); all later work exists only as a Google Drive file. You can't audit, diff, bisect, roll back or attribute anything after July, and git can't reproduce production (it also lacks `firebase-config.js`).
2. **Single 10.4k-line global script growing at ~120 lines/day, now with runtime monkey-patching of `sv`/`sk`/`render`** (L486–497, L9847). Behaviour is no longer visible at call sites; key-person risk is increasing.
3. **The money and stock logic is untested and untestable as written.** `cotCalc`, the paper optimiser, paginado, OT state and stock reservation all read and write globals. The only tests (unchanged since July) exercise copies of 10 utilities.
4. **Data-integrity design relies on conventions and timers.** That covers the manual `_cotUnswap` invariant (7 sites), the 2,000/2,200 ms snapshot suppression (L533/L545), collection-wide undo that can revert other users' edits, non-atomic `insumosItems`+`insumosMovs` saves with single-key retry (L1716 etc.), and `sk()` bypasses that skip sanitisation (L2989).
5. **Single-document storage for growing logs.** `stockMovs` and `insumosMovs` live in `gp/_config` with 21 other keys (L205), so the 1 MiB Firestore document limit is a hard, unmonitored ceiling. When it's hit, every configuration save fails.

## 5. Quick wins (low effort, measurable score gain)

1. **Commit the current working copy to git today and make every deploy go through git** (and add `firebase-config.js` to the deploy via an env-injected file, or commit it; it isn't secret). Biggest risk reduction per minute of effort. *(Crit 7, 8)*
2. **Route every save through one function:** replace the 18 direct `sv(` calls (L1055, L1635–1802, L2989, L3069) with `sk()`, and give `sk` a multi-key form `sk(['insumosItems','insumosMovs'])` whose retry covers all keys. *(Crit 3, 5)*
3. **Make `cotMaqExtra()` read-only:** move the auto-repair (L2476–2481) into `cargarDatos()` (L449) as a one-time migration. The pricing chain then becomes pure. *(Crit 1, 3)*
4. **Collapse duplicates:** one `escHtml` (delete `cotEsc` L909, `insEsc` L1621, `escH` L8406); one `snapshotCalc(cotW)` for L2978/L3260; one `avanzarPaso(o,p)` for the 5 transition copies; a `getOT(id)` for the 54 `find` calls. *(Crit 2)*
5. **Point the tests at real code:** move ~15 pure helpers (`_catCortes`, `cotPosesSug`, `_cotPorCant`, `recomputeEstadoOT`, `stockLibrePara` with injected `S`) into a `lib.js` loaded by both `index.html` and `tests/pruebas.js`. Add a `package.json` with `"test"` and a Netlify build command that runs it. *(Crit 6, 7)*
6. **Delete dead code and footguns:** `facturas`/`cobranzas` (L318), `ADMIN_EMAIL` (L429), the stale "TEMPORAL" comment above `wipeDatos` (L4183). Remove the duplicated base64 logo (L81 vs L147) and serve logos as files (−138 KB). *(Crit 2)*
7. **Rename side-effecting functions** to say what they do (`papelChequearStock` → `papelReservarSiAlcanza`) and log a warning when `cotPagAplicar`'s loop doesn't converge (L3460). *(Crit 2, 5)*

## 6. Deeper architectural issues (require refactoring investment)

1. **Split into ES modules by domain** (persistence, state/store, cotizador engine, paper catalog, paginado, OT workflow, stock, views, PDF). The engine modules should take inputs and return outputs: no `S`, no `cotW`, no `window`. This is the prerequisite for everything below.
2. **Replace the three monkey-patch layers with an explicit store:** `dispatch(action)` → mutate → persist (batched/transactional per action) → notify views, with undo implemented as inverse actions per *document*, not whole-collection snapshots. Replace timer-based snapshot suppression with per-document versioning (`updatedAt` / `rev`) and merge.
3. **Model the per-quantity configuration explicitly** (`cotizacion.configs[cantidad] = {piezas, margen}` with a resolver), instead of swapping `cotW.piezas` pointers.
4. **Normalise stock reservations** into their own collection (`reservas/{id}: {stockItemId, otId, pliegos, estado}`), written in a transaction with the OT change. Move `stockMovs`/`insumosMovs` out of `_config` into per-document collections.
5. **Rendering:** move to event delegation (`data-action` attributes; currently **0** in the code) and a small escaping template helper, so the 462 inline `onclick`s, `unsafe-inline` CSP and `onclick`-string introspection (L4119) can be removed. Move the 2,303 inline styles into `styles.css` classes.
6. **Move business reference data out of source:** `COT_SEED`, `COT_PAPEL_CAT_SEED` and machine limits `COT_MAQ_MAX` should live in Firestore with an admin UI (partly exists). Define the AI contract (`interpretar.js` schema) in one shared JSON Schema file used by both the function and the client mapper.

---

## 7. Changes vs 2026-09-16 audit

**Improved**
- Blob persistence: per-field `updateDoc` with create-fallback (L259–267) replaces whole-document read-modify-write.
- OT status derivation centralised in `recomputeEstadoOT` (L4913, 12 callers).
- The destructive data wipe is no longer a casual path: `wipeDatos` requires the console code `'CONFIRMAR-BORRAR-TODO'` plus two confirms (L4274–4278).
- Paper catalog helpers (L943–1045) are the best-factored new code in the file.

**Got worse**
- Size: 8,621 → **10,572** lines (+22.6%); `rCotizador` 308 → **346**, `rCostos` 201 → **281**.
- Inline `onclick` 328 → **462**; `window.*` refs 125 → **251** (58 distinct globals); `innerHTML=` 68 → **79**.
- **New hidden control flow:** `sv`, `sk` and `render` monkey-patched at runtime (L486–497, L9847).
- **New impure engine path:** `cotCalc` → … → `cotMaqExtra()` writes config (L2469–2481).
- **New manual invariants:** `porCant` pointer swap (7 sites), paginado fixed-point loop (L3460).
- Test coverage is relatively lower: no tests added for any September feature.
- Version-control gap is now ~2.5 months (single commit 2026-07-11).

**Unchanged (all 09-16 quick wins still open)**
- Single global script, no modules, Firebase re-exported to `window` (L189–198).
- Four escapers (L875, L909, L1621, L8406); `value="${bDash}"` unescaped (L4302); raw `hl()` (L889).
- Dead `facturas`/`cobranzas` in `S` (L318); `updateCliTable`/`updateProvTable` duplication (L4146/L4164).
- No `package.json`, lockfile, linter, CI or SRI (L20, L183–185).
- Tests still re-implement production functions (`tests/pruebas.js` unchanged since 2026-07-12).
- Inline `<style>` in `<head>` (L23–76) despite `styles.css`.

**Net:** of the 6 quick wins from 09-16, only one is partly done (the wipe path is now gated, but the code still ships). The other five are untouched. Score **3 → 2.5**.

---

*Prepared for internal due-diligence. Scores reflect an acquisition lens (production-readiness for a new owning team), not whether the tool works for its internal users. It evidently does, and its domain modelling of a print shop is the asset of value.*
