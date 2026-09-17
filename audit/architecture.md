# Gráfica Pro — Architecture & Maintainability Audit

**Scope:** Architecture / maintainability ONLY (security, performance, UX, DB covered in sibling reports).
**Perspective:** Acquisition due-diligence. Buyer is looking for reasons NOT to buy. Brutally honest.
**Date:** 2026-09-16
**Reviewer:** Independent code audit (no production code modified).

---

## 0. What was measured (hard numbers)

All evidence below was gathered directly from the source tree.

| Metric | Value | Evidence |
|---|---|---|
| `index.html` total lines | **8,621** | full-file line count |
| Single app `<script>` block | **lines 122–8619 (~8,498 lines)** | `<script>` L122, `</script>` L8619 |
| Function-like definitions in `index.html` | **555 matches** | regex count of `function`/arrow decls |
| Named top-level render functions | **~28** (`rDash`, `rCot`, `rOT`, `rFichaVer`, …) | grep of `function r[A-Z]` |
| `.innerHTML =` assignments | **68** | grep count |
| Inline `onclick=` handlers | **328** | grep count |
| `window.*` global stashing / access | **125** | grep count |
| `try`/`catch` keyword occurrences | **103 (~50 blocks)** | grep count |
| `innerHTML+=` / incremental injection | **8** | grep count |
| Largest function `rFichaVer` | **~447 lines (L4721–5168)** | function boundaries |
| `package.json` / lockfile / eslint config | **0 (none exist anywhere)** | glob returned no files |
| `tests/pruebas.js` | 204 lines, standalone, **re-implements** prod logic | L14, L26, L33, L46 |
| CSS extracted to `styles.css` | 169 lines, **but 3 `<style>` blocks remain inline** | L23, L4106, L4134, L8472 |

**Note on stated premises:** two premises in the brief are now partly outdated and were verified against code: CSS has largely been extracted to `styles.css` (L21), and a test file *does* exist (`tests/pruebas.js`). Both are noted as mitigations below — but neither materially changes the maintainability picture, for reasons given.

---

## 1. Rubric & Scores

| # | Criterion | Score /10 | One-line justification |
|---|---|---|---|
| 1 | Module boundaries / separation of concerns | **2** | One 8.5k-line script in global scope; zero modules/bundler. |
| 2 | Function size & complexity | **3** | 447-line render functions; dense multi-statement one-liners. |
| 3 | Global state coupling | **3** | Single mutable `S` + ~30 module-level `let`s + `window.*` stash. |
| 4 | HTML generation (safety & maintainability) | **3** | 68 `innerHTML`, 328 inline `onclick`, string concat, unescaped interpolation. |
| 5 | Duplication & dead code | **4** | 4 near-identical escapers; dead `facturas`/`cobranzas`; "TEMPORAL" code. |
| 6 | Error handling | **4** | ~50 `try/catch`, mostly swallow-and-`console.warn`; no telemetry. |
| 7 | Testability | **3** | Tests re-implement logic (can't import); no DOM/integration coverage. |
| 8 | Build / deploy / dependency management | **3** | No build, no `package.json`/lockfile, CDN deps w/o SRI (but pinned). |

### **OVERALL: 3 / 10** — Maintainability risk: **HIGH**

The application is functionally coherent and shows genuine engineering thought (incremental Firestore writes, input sanitization, pinned deps, a CSP, an escape helper, a test file). But **as an asset to be acquired and maintained by a new team, its architecture is a liability.** The entire business logic — CRM, quoting engine, work orders, production planning, capacity, costing, PDF generation — lives in one 8,600-line file with hundreds of global symbols and no module boundaries. Onboarding, safe change, and parallel work are all severely constrained. This is textbook **key-person risk**: whoever wrote it holds the mental model, and the code does little to externalize it.

---

## 2. Detailed findings & evidence

### Criterion 1 — Module boundaries / separation of concerns — **2/10**

- The whole SPA is a single `<script>` running **L122–8619** (~8,498 lines). There is **no module system, no bundler, no imports** between app units. Firebase is the only thing loaded as ES modules, via runtime `import()` inside `initFirebase()` (L182–197), and its SDK objects are then **re-exported onto `window`** (`window._fsOnSnapshot`, `window._fsDoc`, `window._fsSet`, … L189–196) so the rest of the flat script can reach them. That is the opposite of encapsulation.
- Concerns are fully interleaved in one namespace: persistence (`ld`/`sv`/`sk` L205–300), domain state (`S` L302), 28 view renderers, ~25 modal builders, PDF generation (`generarPDFCotizacion` L8425, `_descargarComoPDF` L8530), and a costing engine all sit side by side with no layering.
- **Impact for a buyer:** you cannot lift out or replace one subsystem (e.g. swap Firestore, or reuse the quoting engine) without touching the monolith. There is no seam.

### Criterion 2 — Function size & complexity — **3/10**

- `rFichaVer(id)` spans **L4721–~5168 (~447 lines)** — a single function that renders an entire job-sheet view.
- Other oversized units: `rCotizador()` **L2572–2880 (~308)**, `rAnalOT()` **L5254–5491 (~237)**, `rCostos()` **L989–1190 (~201)**, `rInsumos()` **L1454–1636 (~182)**.
- Density compounds length: many "functions" are one physical line containing 5–15 statements, e.g. `savProv()` (L8104) and `savRem()` (L8420) are each a single line performing read-from-DOM, validation, `S` mutation, save, and re-render. `updateCliTable()` (L2902–2919) builds table rows with nested ternaries inside template literals inside a `for` loop on one line (L2915–2916). Cyclomatic complexity is high and invisible to tooling (no linter).
- **Impact:** diffs are noisy, code review is hard, and a one-character change in a 447-line template literal can silently break layout with no test to catch it.

### Criterion 3 — Global state coupling — **3/10**

- A single mutable object `S` (L302–317) holds *all* domain data. Every mutation is a direct in-place write (`S.proveedores.push(...)`, `S.gastos=S.gastos.filter(...)`) followed by a manual `sk('key')` call. There is **no change-detection, no single source of dispatch** — persistence correctness depends on the author remembering to call `sk()` after every mutation (e.g. L8104, L8422, L8423). Miss one and data silently fails to persist.
- Beyond `S`, ~30 free-floating module-level `let`s hold UI state: `curPg, bCli, bProv, pCli, pProv, fCot, fOT, bOT, bDash, bCot, fichaTab, fichaVerID, bFicha, pCot, pOT, pFicha, bSeg, fSeg, fichaEditMode, planMaq, planOffset, tallerOff` (L124–142). More state is stashed ad-hoc on `window` (`window._editandoCotId`, `window._knownIds`, `window._docJson`, `window.capPeriodo`, `window.capOffset`, `window._pendingSave` — 125 `window.*` references total).
- Inline handlers **mutate globals directly from markup strings**, e.g. `onclick="bCli='';Q('sci').value='';updateCliTable();return false"` (L2911). Business state is being reassigned from inside HTML attribute strings.
- **Impact:** state flow is untraceable; there is no way to reason about "what can change this value" without reading the whole file. This is the single biggest barrier to a new maintainer.

### Criterion 4 — HTML generation (safety & maintainability) — **3/10**

- Rendering is **string concatenation of template literals** assigned to `innerHTML` (68 `.innerHTML=` sites) — `render()` (L2880) does `pg.innerHTML=fns[curPg]()`, and renderers build markup with `let h=...; h+=...` (see `rDash` L3056–3062).
- **328 inline `onclick` handlers** are embedded in those strings, tying every DOM node to a specific global function name and specific argument serialization (e.g. `onclick="om('vc',${c.id})"` L2915). This couples markup to the global namespace and defeats any static analysis.
- **Interpolation is frequently unescaped.** `rDash` injects the live search term straight into an attribute: `value="${bDash}"` (L3058); `updateDashResults` injects it into markup at L3075. The `hl()` highlighter (L846) deliberately returns **raw** text wrapped in `<mark>` with no escaping. The app leans on save-time stripping of `<>` (`_sanitizeColeccion` L279–289, `sanTxt`) as its safety net rather than escaping at render — a fragile, easy-to-bypass strategy (fields not in the `_SAN_FIELDS` map at L269–278 are never stripped). *(Security detail is in `security.md`; here it counts as a maintainability smell: correctness depends on two lists staying in sync forever.)*
- **Impact:** every new field is a potential breakage/injection unless the author remembers the sanitization map. There is no template engine enforcing escaping.

### Criterion 5 — Duplication & dead code — **4/10**

- **Four near-identical HTML-escape helpers** exist instead of one: `escHtml` (L832), `cotEsc` (L866), `insEsc` (L1248), and a *local* `escH` re-declared inside a function (L6545). They do the same `&<>"` replacement with minor variations — a maintenance trap (fix a bug in one, the other three stay broken).
- **Dead / abandoned state:** `S.facturas` and `S.cobranzas` are declared in the initial state (L303) but appear in **neither** `COL_KEYS` (L201) nor `BLOB_KEYS` (L203) — they are never persisted and never read back. Vestige of an invoicing/collections feature that was cut but not removed.
- **Self-flagged throwaway code left in production:** comment at L2939 — *"TEMPORAL — borra TODOS los datos salvo clientes y proveedores… Borrar cuando no se use"* — a destructive data-wipe path shipped with a note to remove it later.
- The two client-table renderers `updateCliTable` (L2902) and `updateProvTable` (L2920) are ~95% copy-paste of each other (same pagination, same alphabetical-separator logic, same row template) — classic un-abstracted duplication.
- **Impact:** moderate. The duplication is contained, but it signals no refactoring discipline and multiplies the change surface.

### Criterion 6 — Error handling — **4/10**

- ~50 `try/catch` blocks exist, but the dominant pattern is **swallow-and-continue**: `catch(e){}` (empty, e.g. L231, L7910) or `catch(e){console.warn(...)}` (L216, L261). Errors vanish into the browser console; there is no error reporting, no telemetry, no user-facing surfacing beyond the save indicator.
- The **one** good pattern is the save path: `sk()` → `sv()` throws → `showSaveError()` exposes a "Reintentar" retry (L169–180). This is genuinely well done and should be the template for the rest of the app — but it is the exception, not the rule.
- **Impact:** in production, a swallowed error during (say) a partial Firestore write leaves the in-memory `S` and the persisted state silently divergent, with no signal. For a data-of-record ERP, silent failure is the worst failure mode.

### Criterion 7 — Testability — **3/10**

- A test file exists (`tests/pruebas.js`, 204 lines, run via `node tests/pruebas.js`) and is a good instinct. **But because the code is a non-modular single file, the tests cannot import the real functions** — they **re-implement** them inline and test the copies: `uid` (L14), `sanTxt` (L26), `_pagina` (L33), incremental-save logic (L46). The production `uid`/`sanTxt`/`_pagina` in `index.html` could drift from these copies and the tests would still pass. This is testing a parallel universe.
- No DOM, integration, or end-to-end coverage of the 28 renderers, the quoting engine, or the Firestore layer — i.e. none of the actual risk surface is tested.
- **Impact:** effectively untested where it matters. The single-file architecture is the *direct cause* — you cannot unit-test what you cannot import.

### Criterion 8 — Build / deploy / dependency management — **3/10**

- **No build system, no `package.json`, no lockfile, no linter config anywhere** in the repo (verified: glob for `package.json`/`package-lock.json`/`*.config.js`/`.eslintrc*` returns nothing). The Netlify function (`interpretar.js`) relies on the platform's global `fetch` with **zero declared dependencies and no version pinning of the runtime** — reproducibility depends entirely on whatever Node version Netlify defaults to.
- Front-end third-party code is loaded from CDNs: Tabler icons `@2.44.0` (L20) and Firebase `10.12.0` (L183–185). Versions *are* pinned (good), but there are **no Subresource Integrity (SRI) hashes** — a CDN compromise executes in the app.
- Deploy is GitHub→Netlify static hosting; `netlify.toml` is minimal (publish `.`, functions dir, esbuild). Simple, which is a plus for a 4-user tool — but there is no CI, no test gate, no lint gate: `tests/pruebas.js` is run manually "antes de subir" (per its own header comment L5).
- `firebase-config.js` commits the Firebase web config into the repo (L1–8). Firebase web keys are not strictly secret, but combined with the client-only architecture the security boundary rests entirely on Firestore rules (`firestore.rules`) — see `security.md`.
- **Impact:** dependency drift and supply-chain exposure are unmanaged; there is no automated safety net between a commit and production.

---

## 3. Top risks that would BLOCK acquisition approval

1. **Single-file monolith → severe key-person risk.** 8,621-line `index.html`, ~8,500 lines of JS in one global-scope script (L122–8619), no modules. A new team cannot safely change or extend this without a lengthy, high-risk reverse-engineering effort. *This alone justifies a valuation haircut or an escrow/knowledge-transfer clause.*
2. **No meaningful test coverage of the real code.** `tests/pruebas.js` re-implements logic (L14/26/33/46) rather than importing it; the 28 renderers, quoting engine, and persistence layer are untested. Any acquirer inherits a codebase where regressions cannot be caught automatically.
3. **Silent-failure error handling on a system of record.** Empty/`console.warn`-only catches (L216, L231, L261, L7910) mean data-write failures can leave persisted and in-memory state divergent with no signal — unacceptable for an ERP holding the shop's quotes, orders, and costs.
4. **State correctness depends on manual discipline.** Persistence requires the author to remember `sk()` after every one of hundreds of direct `S` mutations; sanitization depends on the `_SAN_FIELDS` map (L269–278) being kept in sync with every new field. Both are unenforced conventions, not guarantees.
5. **No dependency management or supply-chain controls.** No `package.json`/lockfile; CDN scripts without SRI (L20, L183). Not reproducible, not auditable.

## 4. Quick wins (fast score improvements — low effort, real gain)

1. **Delete confirmed dead code:** remove `facturas`/`cobranzas` from `S` (L303) and the "TEMPORAL" data-wipe path (L2939). Immediate clarity, removes a destructive footgun. *(Crit 5)*
2. **Collapse the 4 escapers into one** (`escHtml`, L832) and call it everywhere; delete `cotEsc`/`insEsc`/`escH`. *(Crit 4/5)*
3. **Add SRI hashes** to the Tabler and Firebase `<link>`/import tags (L20, L183). *(Crit 8)*
4. **Add a `package.json`** (even minimal) declaring the Node engine and any function deps, plus an `npm test` script wiring `tests/pruebas.js`, and a Netlify build step that fails the deploy if tests fail. Cheap CI gate. *(Crit 7/8)*
5. **Stop swallowing errors:** change bare `catch(e){}` blocks to at least `console.error` + route critical ones (writes) through the existing `showSaveError` pattern (L169). *(Crit 6)*
6. **Escape at render:** wrap live-search interpolations (`value="${bDash}"` L3058, `hl()` output L846) in `escHtml`, so correctness no longer depends on the save-time strip list. *(Crit 4)*

## 5. Deeper architectural issues (require real refactoring investment)

1. **Break the monolith into modules.** Even without a bundler, split into ES modules by domain (persistence, state, each feature's render+handlers, PDF, quoting engine) and load with `<script type="module">`. This is the prerequisite for everything else — real tests, parallel work, subsystem replacement. Largest single investment; largest payoff.
2. **Introduce a state layer with dispatched mutations.** Replace direct `S.*` writes + manual `sk()` with a thin store that auto-persists on change (the `_docJson`/`_knownIds` diffing at L237–252 already hints at this). Eliminates the "forgot to call `sk()`" class of bugs and the ~30 loose UI `let`s.
3. **Adopt a rendering approach that escapes by default.** Move from `innerHTML` string concatenation + 328 inline `onclick`s to either a tiny template helper that escapes interpolations and uses event delegation, or a lightweight view library. Removes the entire unescaped-interpolation and global-handler-coupling class of problems.
4. **Decompose the 200–450-line functions** (`rFichaVer` L4721, `rCotizador` L2572, `rAnalOT` L5254) into composable sub-renderers, and de-duplicate `updateCliTable`/`updateProvTable` into one parameterized table renderer.
5. **Build a real test suite against the (now importable) modules** — unit tests for the quoting/costing engine, and DOM/integration tests for the critical renderers and the Firestore layer — wired into CI as a merge gate.

---

*Prepared for internal due-diligence. Scores reflect an acquisition lens (production-readiness for a new owning team), not whether the tool currently works for its 4 internal users — it evidently does.*
