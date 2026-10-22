# Frontend / UX / State-Management Audit: "Gráfica Pro" (re-audit)

**Date:** 2026-10-02 · **Previous audit:** 2026-09-16 (overwritten by this file; deltas in §8)
**Scope:** Frontend architecture, state management, rendering, UX consistency, input/number handling, accessibility, responsive/mobile, error/empty/loading states, and print/PDF outputs. Backend and security are only covered where they leak into the UI layer.
**Target:** `index.html` (10,571 lines, 1,019,072 bytes, last modified 2026-10-02) and `styles.css` (170 lines, unchanged since 2026-07-12).
**Method:** I read the code and ran read-only regex counts. The app was not run. Line numbers refer to `index.html` unless stated.

**Verdict:** The app is functional and clearly shaped by daily use. Many local patches show the authors know where it hurts: `cotSync` partial updates, scroll restore, deferred-snapshot guards, and focus restore in the paginado editor. Since 2026-09-16 the codebase grew about 24%, and the new features add complexity without fixing the architecture: per-quantity piece swapping, AI pre-costing, an undo FAB, and more overlays. This audit also found **concrete data-corruption paths** that the first audit missed:
- a thousands-separator round-trip bug in the cost tables
- an undo feature that can delete other users' records
- silent load timeouts that can lead to config being overwritten

A skeptical buyer should not approve this frontend without remediation.

---

## 0. Quantified inventory (2026-10-02)

| Metric | 2026-09-16 | **2026-10-02** | Δ |
|---|---:|---:|---|
| Lines in `index.html` | 8,543 | **10,571** | +24% |
| Top-level `function` declarations | n/a | **649** | |
| `onclick=` inline handlers | 328 | **462** | +41% |
| Other inline handlers (`onchange/oninput/onkeydown/onblur/onfocus/...`) | 125 | **166** | +33% |
| `onclick` on non-button elements (`div/span/td/tr/a/i/...`) | "large fraction" | **98** | |
| `onclick="...'${...}'..."` (string-interpolated args inside quotes) | n/a | **45** | |
| `<button` | 245 | **364** | |
| `alert(` | 76 | **83** | +7 |
| `confirm(` | 41 | **47** | +6 |
| `prompt(` | not counted | **25** | (includes a password prompt, L435) |
| **Blocking native dialogs total** | 117+ | **155** | |
| `.innerHTML =` assignments | 199 (different method) | **73** (+ every `r*()` view returns one big HTML string) | not comparable |
| `render()` call sites | ~74 | **189** | +155% |
| `cotRerender(` call sites | n/a | **46** | |
| `cotSync(` call sites (no-rerender path) | n/a | **15** | |
| Distinct `window._*` / `window.__*` globals | ~45 | **52** | +7 |
| `aria-*` / `role=` / `tabindex` | 0 / 0 / 0 | **0 / 0 / 0** | unchanged |
| Semantic landmarks (`main/nav/header/section/footer/aside`) in app shell | 0 | **0** | unchanged |
| `<label` total / `<label for=` | n/a | **269 / 1** | 99.6% unassociated |
| `:focus-visible` rules | n/a | **0** (`outline:none` ×3, styles.css L51, L68, L80) | |
| `.focus()` calls | 10 | **12** | |
| `@media` queries | 3 (+print) | **3 layout + 4 print** | unchanged |
| Inline `style="..."` attributes | "thousands" | **2,303** | |
| Distinct hardcoded font sizes | n/a | **42** (px and pt mixed) | |
| Inline font sizes ≤10px | n/a | **343** (9px ×59, 10px ×271) | |
| Distinct hex colors | n/a | **155** | |
| CSS custom properties (`var(--`) | n/a | **0** | |
| Distinct `z-index` values | 12 | **13** (`5…100005`) | |
| Dynamically created overlay/floating ids | 8+ | **14** (`ov, ov2, cot-embed, cot-desg, ai-ov, estr-armar, estr-aprender, extra-ov, he-ov, oe-ov, ov-stockparcial, save-indicator, backup-reminder, undo-fab`) | +6 |
| Empty `catch(e){}` blocks | n/a | **49** | |
| `beforeunload` guard | n/a | **0** | |
| `es-AR` occurrences | 51 | **72** | |
| Inline base64 images | n/a | **3** (one is 124,152 chars on a single line, L10457) | |

---

## 1. Rubric

| # | Criterion | Score /10 | Trend vs 09-16 |
|---|---|---:|---|
| 1 | State management | **2** | worse (3 → 2) |
| 2 | Rendering strategy & UI robustness | **4** | unchanged |
| 3 | UX consistency & feedback | **3** | unchanged/worse |
| 4 | Input, validation & number formats (es-AR) | **2** | new criterion; critical bug |
| 5 | Accessibility | **1** | unchanged |
| 6 | Responsive / mobile | **6** | worse (7 → 6) |
| 7 | Error / empty / loading states | **4** | worse (5 → 4) |
| 8 | Print / PDF outputs | **5** | new criterion |

### Overall: **3.0 / 10**, Frontend risk **HIGH, trending to CRITICAL for data integrity**

The 2026-09-16 score was 3.5. The drop does not mean the app got less useful. It reflects data-integrity defects that are now verified in the UI and state layers, plus growth in every debt metric.

---

### 1.1 State management: 2/10

**Five sources of truth instead of one:**
1. **Global `S`** (L317+), mutated directly from hundreds of handlers. Persisted with `sk(k)` (198 call sites) or `await sv(k, …)` (27).
2. **52 `window._*` / `window.__*` globals.** These include costing-editor state (`_cotEmbed`, `_cotVistaCant`, `_cotItems`, `_cotVariantes`, `_cotVarActiva`, `_editandoCotId`), persistence coordination (`_docJson`, `_knownIds`, `_saveEnCurso`, `_snapPend`, `_ultimoGuardadoLocal`, `_pendingSave`), debounce timers (`_costosSaveT`, `_estrSaveT`, `_catSaveT`, `_maqExtraT`, `_pagT`) and a full undo engine (`__undoStack`, `__undoShadow`, …).
3. **Module-level `let`s** (L124–141): `curPg, bCli, bProv, pCli, pProv, fCot, fOT, bOT, bDash, bCot, fichaTab, fichaVerID, bFicha, pCot, pOT, pFicha, bSeg, fSeg, fichaEditMode, planMaq, planOffset, tallerOff`, plus `cotW`, `cotVista`, `costosTab` (L908).
4. **The live DOM.** `_leerItemsDOMNuevo()` (L8295–8306) and `cotDesdeItem()` (L3091–3098) still read `.value` from `#ci2 .id2/.in2` back into `_cotItems` before saving or costing. This is unchanged from the previous audit.
5. **`cotW` with a pointer-swap mechanism (new).** `_cotSwapA(c)` (L2260) makes `cotW.piezas` an *alias* of `cotW.porCant[c].piezas` and parks the base in `cotW._piezasBase`. `_cotUnswap()` (L2259) reverses it. Every save or close path has to remember to unswap: L2975, L3257, L3283, L2967.

**Verified defects and fragilities:**
- **Alias break in the swap mechanism.** `_cotPagAplicar1()` does `const P=cotW.piezas` (L3470) and then **reassigns** `cotW.piezas=P.filter(...)` (L3552–3553). This path runs from `cotPagEd` (L3591), `cotDesdeItem` (L3143, L3165) and piece edits (L2609). If it runs while a non-base quantity is being viewed, the new array is no longer `porCant[k].piezas`. Later edits go to an orphan array, and `_cotUnswap()` silently discards them. Edits to a per-quantity configuration can vanish with no error.
- **Undo FAB can delete other users' data.**
  - **How it works:** an IIFE-like block glued onto the end of `updateCot` (L9847) monkey-patches the global `sk` and `render`. On every `sk(k)` for `clientes/proveedores/cotizaciones/ordenes`, it pushes a **whole-collection snapshot** (`__undoShadow[k]`) onto the stack. `doUndo()` does `S[e.k]=e.prev; sk(e.k)`.
  - **Why it loses data:** `sv()` deletes every id in `_knownIds[k]` that is missing from the array (L229–235). The snapshot listener updates `_knownIds` with other users' new records (L524), but `__undoShadow` is not refreshed by remote snapshots. So **undo writes back a stale array, and `sv()` deletes records other users created in the meantime.** With 4 concurrent users this is a realistic data-loss path.
- **Blob config is not live-synced.** `activarSincronizacion()` subscribes only to `['clientes','proveedores','cotizaciones','ordenes','fichas','gastos']` (L503). `cotTrabajos`, `remitos`, and all 23 `BLOB_KEYS` (L205: `cotConfig`, `cotPapeles`, `stockPapel`, `stockMovs`, `planificacion`, `insumosItems`, …) are loaded once at login. `sv()` writes each blob as one whole field via `updateDoc` (L263), so the last writer wins.
  - Example: user A changes the dollar rate or stock while user B still has the old array in memory. B's next edit to that key overwrites A's work. B also quotes with a stale `dolarNominal` until a reload.
- **Dead and misleading state.** `mEditCot()` sets `window._editandoCotId=id` (L9796) and then calls `om('nc2')`. `om()` calls `cm()`, which nulls it (L7756), and the `nc2` factory nulls it again (L7700). The guard in `savCotYpdf()` (L10072) therefore never fires. Edit mode works only because a `setTimeout(...,80)` later replaces the footer buttons through `document.querySelector('.mod .mf')` (L9820–9821). If that DOM patch fails or races, "Guardar y PDF" **creates a duplicate quote** instead of updating.
- **Debounce timers as globals.** Each table has its own timer (`_costosSaveT` L1078/1195, `_estrSaveT`, `_catSaveT`, `_maqExtraT`). Closing a tab inside the 700 ms window loses the edit, and there is no `beforeunload` guard (0 occurrences).

### 1.2 Rendering strategy: 4/10

- **Full teardown is still the default.** `render()` (L4123–4140) does `pg.innerHTML = fns[curPg]()` and then applies a scroll-restore hack (`_scrollPorPg`, double `requestAnimationFrame`, L4134–4137). It has 189 call sites, 2.5× the previous count.
- **The costing editor re-renders the whole editor** through `cotRerender()` (L3073–3080; 46 call sites). That means `#cot-embed-body.innerHTML = rCotizador()`, and `rCotizador` is a 346-line, 50 KB template function (L3766). Fields that trigger it on `change` include:
  - quantity when variants exist (L2382)
  - variant quantity (`cotVarEd` L2963)
  - paper code (`cotPzEd` L2614)
  - manual mode (`cotManEd` L2945)
  - process cost override (L2902)

  Pressing **Tab** after editing one of these fires `change`, rebuilds the DOM, and drops focus to `<body>`. This is the root cause of the tab-order complaints the user reported.
- **Partial mitigations exist but are piecemeal.** `cotSync()` (L2309–2378) updates around 30 ids via `textContent`/`innerHTML` and guards `document.activeElement` (L2354–2355). `cotPagEd` (L3583–3594) saves and restores the focused `pag-*` id. No other editor has focus restore.
- **Remote changes re-render under the user's hands.** The `onSnapshot` handler calls `render()` whenever another user changes one of the six synced collections (L528). On the `cotizador` page (not embedded), this rebuilds the editor mid-typing and loses caret and focus.
- **The global date rewrite is still in place.** A body-wide `MutationObserver` rewrites every `AAAA-MM-DD` text node (L7774–7803). It runs on every `innerHTML` swap, so cost scales with DOM size, and it can also rewrite legitimate text such as codes.

### 1.3 UX consistency & feedback: 3/10

- **155 blocking native dialogs** (83 `alert`, 47 `confirm`, 25 `prompt`). The worst cases:
  - **Password entry by `prompt()`.** `crearUsuario()` asks for the new user's password in a plain-text browser prompt (L434–435). It also checks the admin by email prefix `esteban-gerencia` (L431), while `ADMIN_EMAIL` (L429) is defined and unused.
  - **Multi-step creation by chained prompts.** In `cotMaqNueva()` (L2505–2522), the second prompt's Cancel is ignored: `_cotMaqFmtPrompt` returns `null` (L2499), but L2513 still pushes `{nombre:n,a:0,b:0}` and creates an external supplier (L2516). `cotMaqEditar()` handles the same `null` correctly (L2530). The two flows are inconsistent.
  - **Deleting a vendedor by typing its code** into `prompt()` (L6734). There is no list to pick from.
  - **Clipboard fallback through `prompt('Copiá el pedido:',txt)`** (L1824).
  - **Validation by `alert()` inside `onchange`.** For example, paper "no entra en ninguna máquina" (L2610–2612) fires during Tab navigation and steals focus again.
- **Destructive actions are inconsistent:**
  - Quote modal (`nc2/ec2`): confirm on outside click and Escape (L7714–7738). Good.
  - Costing overlay "Cancelar" (`cotEmbedCerrar`, L3245/L3282): **no confirm**. All costing work is discarded on one click.
  - Cotizador "Nueva" (L3797): `cotNuevo()` replaces `cotW` with **no confirm**.
  - `cotEliminar` (L3013): confirm, then Firestore delete with an empty `catch` (L3017). The UI reports nothing if the delete fails, and the item reappears on the next load.
- **Overlay inconsistency.** There are 14 floating-element ids with independent lifecycles:
  - Only `ov`/`ov2` are wired to Escape and click-outside (L7739–7769).
  - `cot-embed` (L3233), `cot-desg` (L3311), `ai-ov` (L7887) and `estr-armar` (L8314) have their own close functions and **no Escape handling**.
  - **Escape fall-through:** when the costing overlay is opened from the quote modal, Escape goes to the quote modal's document-level handler (L7730–7737). It asks "¿Cerrar sin guardar?" and on OK **closes the quote underneath while the costing overlay stays open**. "Aplicar" then writes into the orphaned `window._cotItems` (L3254). `_renderItems()` finds no `#ci2` and returns (L8178), so the costing is silently lost.
- **CMY delete/edit control has a color/name mismatch.** The comment says "cian=ver, magenta=editar, amarillo=eliminar" (L898). In the CSS, `.tri-m` (Editar) is **yellow** and `.tri-y` (Eliminar) is **magenta** (styles.css L161–162). It is an icon-only control: three clip-path triangles inside 48×42 px (styles.css L157), with delete adjacent to edit.
- **No design tokens.** There are 155 hex colors, 42 font sizes and 5 font weights, all hardcoded. Semantic colors drift: errors use `#a32d2d`, `#c0392b`, `#c62828` and `#791f1f`; success uses `#3b6d11`, `#1a7f37` and `#27500a`.

### 1.4 Input, validation & number formats: 2/10 (critical)

The two parsers are defined at L910–911:
```js
function cotNum(v){const n=parseFloat(String(v).replace(/\./g,'').replace(',','.'));...}   // "38.500" → 38500 ; "1.5" → 15
function cotNumDec(v){const n=parseFloat(String(v).replace(',','.'));...}                 // "0,205" → 0.205 ; "38.500" → 38.5 ; "1.234,5" → 1.234
```
The display formatters use `es-AR` grouping: `cotFmtDec(n,3)` (L913) renders `100000` as `"100.000"`.

**Verified corruption round-trip (cost tables):**
- `rCostos` renders numeric cells with `inp()` (L1290). Its value is `cotEsc(cotFmtDec(v,3))`, so it is displayed with thousands dots.
- `costosEdit()` parses **every** numeric field with `cotNumDec` (L1074–1076). That includes the peso amounts `primerMillar`, `millarSiguiente`, `fijo`, `costo`, `precioM2`.
- The resulting failure cases:
  - Impression price of 100000 shows as `100.000` (L1389). If the user edits it to `110.000`, the stored value is **110**.
  - Paper `fijo` of 271700 shows as `271.700` (L1360). Touching that field saves about **271.7**.
  - Laminate `precioM2` (L1427) and the costing editor's custom laminate `$/m²` (`ninp` L3785, `cotLamCustomEd` L3982, parsed with `cotNumDec` L2803) behave the same way.
  - **Dólar nominal:** shown as `cotFmtDec(c.dolarNominal,2)`, so 1500 becomes `"1.500"` (L1529). `costosCfgEdit` parses it with `cotNumDec` (L1194). Editing `1.500` to `1.550` stores **1.55**. That reprices every paper quote by a factor of about 1000.
- These are the master price tables, so one careless edit silently corrupts every future quote. There is no range validation and no "value changed by more than X%" warning.

**Other input problems:**
- **Correct parser chosen by hand per field (14 `cotNum` vs 25 `cotNumDec` call sites).** Peso amounts in the cotizador use `cotNum` (L2382, L2688, L2902, L2925, L2944, L2960). Piece fields use `cotNumDec`, including `demasia`, which also displays with grouping (L2579–2581). A `demasia` of 1000 or more round-trips to 1.
- **Wrong keyboard on phones.** There are 0 `required`, 0 `maxlength`, 9 `min=` and 1 `step=`. 49 `type=number` inputs coexist with free-text numeric inputs, and `inputmode` appears 20 times.
- **No field-level error UI.** Invalid values are coerced to 0 (`isNaN(n)?0:n`) silently. The only inline invalid state is the red border on an unknown paper code (L2605).
- **Labels are not associated with inputs.** There are 269 `<label>` elements and only 1 uses `for=` (L387). The `.fg label + input` pattern (styles.css L65–66) never wires them up, so tapping a label does not focus its input.

### 1.5 Accessibility: 1/10 (unchanged)

- There are **0** `aria-*`, **0** `role=`, **0** `tabindex`, and **0** landmarks. The sidebar is still `<div class="ni" onclick="nav('…')">` (L82–106), which is not focusable and not keyboard-operable.
- There are 98 `onclick`s on non-interactive elements, including table rows (`<tr class="rlink" onclick="om('vc',…)">`, L4159). There are 116 inline `cursor:pointer` uses.
- **Modals and overlays are not accessible dialogs.** They have no `role="dialog"` and no `aria-modal`. There is no focus-on-open (except a few `setTimeout(...focus(),60)` at L1692, 5866, 7594, 7903, 9632), no focus trap, and no focus return.
- **Focus is invisible or barely visible.** `outline:none` is replaced by a 10%-alpha shadow (styles.css L51, L68), buttons have no focus style, and there are 0 `:focus-visible` rules.
- **Color-only status:** the `seg-dot` traffic lights (styles.css L136–144, with an animated pulse for "late") and the CMY action triangles.
- 6 of 7 `<img>` have no `alt`, including the sidebar logo (L81) and the logo after login (L351).
- The silver lining remains: `<html lang="es">` is set (L2), and the native `alert`/`confirm` dialogs are announced by screen readers.

### 1.6 Responsive / mobile: 6/10

**Positives (unchanged):**
- Viewport meta (L5), 3 breakpoints (L32–75), drawer sidebar with backdrop (L38–44, L110–118), and inputs forced to 16px below 640px to prevent iOS zoom (L72).
- Near-fullscreen modals (L56–57), and grid collapse through attribute-selector overrides (L66–67, which is fragile because they match inline-style substrings).
- PWA meta tags (L13–18).

**Negatives:**
- **16px font in fixed-width numeric inputs.** The forced font size (L72) collides with inputs whose widths are 60–80px (`inp()` L1290, `ninp()` L3785). Values like `100.000` or `271.700` overflow or clip on phones in exactly the fields where the parsing bug lives.
- **Very small text:** 343 inline font sizes of 10px or less (9px ×59). Badges are 10px (styles.css L31), and table cells are 12px with `white-space:nowrap; max-width:200px; text-overflow:ellipsis` (styles.css L35). Descriptions are truncated with no tooltip and no wrap on phones.
- **Hover-only help:** 154 `title=` tooltips, including the explanation of encaje suggestions (L2347). This information is invisible on touch devices.
- **Tiny touch targets:** CMY triangles (styles.css L157–165) and pagination buttons `padding:2px 9px` (L132).
- **Dense desktop layout inside the cot-embed overlay.** It is a max-width 1180 desktop layout (L3241); the only mobile adjustment is padding (L62–63).
- **PDF printing through a hidden iframe** (`_descargarComoPDF`, L10480–10517). On iOS/Android, `iframe.contentWindow.print()` often prints the parent page or does nothing. There is no mobile-specific path.
- The undo FAB is fixed bottom-left (L9847, `z-index:9999`) and the save indicator bottom-right (L158). On a phone both cover table content and the `.mf` footer buttons.

### 1.7 Error / empty / loading states: 4/10

**Positives:**
- Save indicator with "Reintentar" (`showSaveError`, L169–175).
- Connection timeout message (L340–342) and a "Cargando datos..." splash (L450).
- 29 `class="empty"` states and 20 "No hay…/Sin resultados" messages.
- Login button spinner (L405).

**Negatives:**
- **Silent partial load leads to overwrite.** `cargarDatos()` races each key against an 8 s timeout and keeps defaults when the result is `null` (L452–453). `ld()` also returns `null` on any error (L218). The user gets no warning and lands on the dashboard with, for example, `stockPapel=[]` or default `cotConfig`.
  - For blob keys, the next edit writes the whole field (L263), which **overwrites the real data with the default plus one change**.
  - For collections, the user sees empty lists ("No hay…") that look legitimate.
- **49 empty `catch(e){}` blocks.** Examples:
  - Firestore delete in `sv()` (L233): a failed delete is swallowed, `_knownIds` is updated, and the record resurrects later.
  - `cotEliminar` (L3017).
  - `cotAFormal` saving `cotTrabajos` (L3069): the quote is reported as "creada" by `alert` (L3070) even if the link to the costing failed.
- **Errors are rendered as raw HTML.** `e.message` is interpolated into `innerHTML` (L342, L414).
- **AI output is rendered unescaped.** `cotW._aiFaltantes` contains strings built from model output (`s.material`, process names; L3163, L3168, L3182, L3208). It is interpolated into the overlay unescaped (L3248), while the line below it uses `cotEsc` (L3249). This is inconsistent and an injection path from pasted customer text.

### 1.8 Print / PDF outputs: 5/10

**Positives:**
- A4 `@page` rules, `print-color-adjust:exact`, page breaks per supplier (`printPapelPedido` L5587).
- Sensible filenames (`c.num - CLIENTE - TRABAJO`, L10474–10477) with a document-title swap so Chrome suggests them (L10497–10503).
- HTML-download fallback (L10508–10516) and a popup-blocked message (L5613).

**Negatives:**
- **Contradictory validity on the client-facing PDF:**
  - Quotes created from the costing tool store `validez:'15 días'` (L3065). The PDF prints "Válida hasta: 15 días" (L10460), because `_fFecha` passes non-dates through (L10381).
  - The PDF also force-rewrites any "Mantenimiento de oferta: N días hábiles" in the notes to **10** (L10385), silently overriding what the user typed.
  - Normal quotes default "Válido hasta" to `addDiasHabiles(hoy, plazo)` (L7832), coupling **validity to the delivery term**.
- **Generator function weight.** `generarPDFCotizacion` is 133 KB because a 124,152-char base64 logo is inlined at L10457. A *different* copy of the logo is embedded twice more (L81, L147). That is about 30% of a 1 MB file, parsed on every load.
- **Escaping is not uniform.** Client name, CUIT and item names are interpolated raw into the PDF HTML (L10403, L10464–10466). They are protected only by `<>` stripping at save time (`_SAN_FIELDS`, L284–304), and `cotTrabajos.nombre` is stripped but not every path uses it. `oePDF` escapes its title (L5905). `printCartel` (L5647–5650) and `printPapelPedido` (L5586) do not.
- **No overflow control on the pallet sign.** `printCartel` prints the job description at 22pt with no length clamp (L5649), so long descriptions spill to a second page of a sign meant to be one A4.
- **Inconsistent print paths.** Quotes use a hidden iframe. `printPapelPedido`, `printCartel` and `oePDF` use `window.open('')` + `document.write`. The behavior differs across browsers, especially on mobile (§1.6).
- Unused helper `$n` (L10378).

---

## 2. Top risks that would block approval (ranked)

1. **Price-table corruption via es-AR round-trip.** `inp()` displays `cotFmtDec(v,3)` (L1290), and `costosEdit` and `costosCfgEdit` parse it with `cotNumDec` (L1076, L1194). The dollar rate (L1529), `primerMillar`/`millarSiguiente` (L1389, L1446), `fijo` (L1360) and `precioM2` (L1427, L3982) can be stored 1000× too small after a normal edit. Every downstream quote is wrong, with no warning.
2. **Undo FAB can delete other users' records.** The monkey-patched `sk`/`render` at L9847 restores stale whole-collection snapshots. `sv()` then deletes ids missing from the array (L229–235).
3. **Silent partial load plus whole-field blob writes.** Load timeouts and errors leave defaults in `S` without warning (L218, L452–453). The next edit writes them over real config or stock (L263). No live sync for `_config` (L503) adds multi-user lost updates on costs, stock and planning.
4. **Costing-editor state fragility:**
   - Pointer-swap alias break (L2259–2264 vs L3552).
   - Escape fall-through that closes the quote under the costing overlay (L7730–7737 vs L3233–3251).
   - Cancel or "Nueva" discard work without confirm (L3245/L3282, L3797).
   - Edit-mode guard `_editandoCotId` is always null (L7700, L7756, L9796, L10072).

   This is the core money-making workflow.
5. **Accessibility floor of zero.** There are 0 aria, 0 roles, 0 tabindex and 0 landmarks, 98 click handlers on non-interactive elements, and invisible focus. Tab-order breakage is caused by `cotRerender` on `change` (L2382, L2614, L2963).
6. **155 blocking dialogs as the UX language,** including a plain-text password `prompt` (L435) and multi-prompt creation flows with inconsistent cancel semantics (L2505–2522 vs L2523–2534).
7. **Client-facing PDF content errors** (validity text and forced offer term, L3065, L10385, L10460), plus mobile PDF unreliability (L10504–10505).

---

## 3. Quick wins (hours to 2 days each, low risk)

1. **Write one locale parser and use it everywhere.** For example, `parseAR(v)`: strip `.` only when it is followed by exactly 3 digits and no comma follows, then convert `,` to `.`. Use it in `costosEdit` (L1076), `costosCfgEdit` (L1194), `cotPzEd` (L2581) and `cotLamCustomEd` (L2803). Alternatively, render raw numbers in `inp()`/`ninp()` (L1290, L3785) instead of `cotFmtDec`. Add a confirm when a price changes by more than 50%.
2. **Disable or neuter the undo FAB** (L9847). At minimum, refresh `__undoShadow[k]` inside the snapshot `aplicar()` (L521–528) and restore only the changed document, not the whole array.
3. **Fail loudly on partial load.** In `cargarDatos()` (L452–453), track the keys that came back `null` and show a blocking "Datos incompletos — recargá". Make `sk`/`sv` refuse to write those keys until they are reloaded.
4. **Fix the costing overlay:**
   - Register its own Escape handler in `cotEmbedRender` that runs `stopImmediatePropagation()` and suspends the base modal's handler, as `_openStacked` already does (L7766).
   - Confirm on "Cancelar" when `cotW` changed.
   - Confirm on "Nueva" (L3797).
5. **Escape AI strings** at L3248 (`cotEsc(f)`), error messages at L342/L414, and PDF interpolations at L10403, L10464–10466, L5647–5650, L5586.
6. **PDF validity:**
   - Store `validez` as an ISO date in `cotAFormal` (L3065).
   - Stop the forced "Mantenimiento de oferta" rewrite (L10385), or derive it from the same field.
   - Default validity to its own setting, not to `plazo` (L7832).
7. **Fix `cotMaqNueva` cancel handling:** `if(f===null) return render();` before L2511.
8. **Fix `_editandoCotId`:** set it after `om('nc2')` in `mEditCot` (L9796–9797), or delete the dead guard at L10072.
9. **Accessibility basics in styles.css:**
   - Add `:focus-visible{outline:2px solid #185fa5;outline-offset:2px}`.
   - Convert `.ni` divs to `<button>` (L82–106).
   - Add `role="dialog" aria-modal="true"` plus focus-first-field and focus-return in `om()`/`cm()` (L7710–7756).
   - Add `<nav>`/`<main>` wrappers (L80, L109).
10. **Add a `beforeunload` guard** while `nc2/ec2` or `cot-embed` is open, or while any `_*SaveT` timer is pending.
11. **Replace the password `prompt`** (L434–435) with a modal containing `type="password"`, or remove in-app user creation entirely.
12. **Move the 124 KB logo** (L10457) and the duplicate logos (L81, L147) into one static `logo.jpg`, referenced by URL. This removes about 30% of the payload.

## 4. Deeper issues requiring refactoring (weeks to months)

1. **A real state layer.** Use a single store with explicit actions, such as `S` wrapped in a tiny observable. Delete the 52 ambient `window._*` globals, DOM read-back (`_leerItemsDOMNuevo` L8295, `cotDesdeItem` L3091), and the `cotW` pointer swap in favor of an explicit `{base, porCant}` model that the editor addresses by key.
2. **Per-document persistence for config.** Split `_config` blobs (`stockPapel`, `cotPapeles`, `planificacion`, …) into documents. Add onSnapshot for them, and use transactions or field-level merges instead of whole-array `updateDoc` (L258–267).
3. **Keyed / diff rendering** (lit-html, Preact or similar) for at least the cotizador (`rCotizador`, 346 lines / 50 KB, L3766) and the quote modal. This removes the `cotRerender` focus loss, the scroll hack (L4134–4137) and the global date MutationObserver (L7777–7803).
4. **One overlay manager** with a z-index scale, a dialog stack, Escape and click-outside, focus trap and restore, and a dirty-check. It should replace 14 ad-hoc overlay ids, 13 z-index values and the `ov`/`ov2` special cases (L7748–7770).
5. **A form-field component for numbers** with locale-aware parse and format, `inputmode`, min/max, inline error, and `aria-invalid`. Remove the coerce-to-0 behavior.
6. **Non-blocking feedback system** (toasts, inline errors, confirm dialogs) to replace 155 native dialogs. Turn chained `prompt` flows into forms.
7. **Design tokens** (CSS custom properties for colors, type scale and spacing) and migration of 2,303 inline styles into classes. Collapse the 42 font sizes to about 6 steps with a minimum of 12px on mobile.
8. **A PDF/print module.** One template engine with escaping, shared assets, a one-page clamp for the pallet sign, and a mobile-safe path, such as server-side or library PDF generation instead of `iframe.print()`.
9. **Split the 10.5 k-line file** into modules with a build step and lint. Gate CI on an axe/accessibility smoke test and on unit tests for `cotCalc`, `cotNum`/`parseAR` and `sv()` diff/delete logic.

---

## 5. Findings index (file : line : function)

| Area | Location | Finding |
|---|---|---|
| Number parse | `index.html:910–913` `cotNum`/`cotNumDec`/`cotFmtDec` | Two parsers with opposite `.` semantics; display uses grouping |
| Number parse | `:1290` `rCostos.inp` + `:1072–1076` `costosEdit` | Display "100.000" parses to 100 for peso price fields |
| Number parse | `:1529` + `:1192–1194` `costosCfgEdit` | Dólar nominal "1.500" parses to 1.5 |
| Number parse | `:3785` `ninp`, `:3982`, `:2798–2803` `cotLamCustomEd` | Same bug in the costing editor's custom laminate $/m² |
| Number parse | `:2579–2581` `cotPzEd` | `demasia` ≥1000 round-trips wrong |
| State | `:2259–2264` `_cotUnswap/_cotSwapA`, `:3552` `_cotPagAplicar1` | Alias break loses per-quantity edits |
| State | `:9847` undo IIFE, `:229–235` `sv` | Undo restores stale arrays, then sv deletes others' records |
| State | `:503` `activarSincronizacion` | No live sync for `_config` blobs, `cotTrabajos`, `remitos` |
| State | `:7700`, `:7756`, `:9796`, `:10072` | `_editandoCotId` always null; dead guard |
| State | `:8295` `_leerItemsDOMNuevo`, `:3091` `cotDesdeItem` | DOM as source of truth (unchanged) |
| Rendering | `:4123–4140` `render` | Full innerHTML plus scroll hack; 189 call sites |
| Rendering | `:3073` `cotRerender`; `:2382`, `:2614`, `:2945`, `:2963` | Re-render on `change` drops focus (tab order) |
| Rendering | `:528` snapshot `aplicar` → `render()` | Remote edits wipe the local editor DOM mid-typing |
| Rendering | `:7774–7803` | Global MutationObserver date rewrite |
| UX | `:7714–7738` `om` protected Escape vs `:3233` `cotEmbedRender` | Escape closes the quote under the costing overlay |
| UX | `:3245`, `:3282` `cotEmbedCerrar`; `:3797` | Discard without confirm |
| UX | `:434–435` `crearUsuario` | Password via `prompt()` |
| UX | `:2505–2522` `cotMaqNueva` vs `:2523–2534` `cotMaqEditar` | Cancel ignored on the 2nd prompt |
| UX | `:6734` | Delete vendedor by typed code |
| UX | `:2610–2612` `cotPzEd` | `alert()` inside `onchange` |
| UX | `:898–900` `triAcc`, styles.css `:157–165` | Color/name mismatch; tiny icon-only targets |
| Errors | `:218` `ld`, `:452–453` `cargarDatos`, `:263` `sv` | Silent partial load, then default overwrite |
| Errors | `:233`, `:3017`, `:3069` | Swallowed Firestore errors |
| Errors | `:3248` | Unescaped AI strings in innerHTML |
| Errors | `:342`, `:414` | Raw `e.message` in innerHTML |
| A11y | `:82–106` sidebar; `:4159` row onclick; styles.css `:51,68,80` | Non-focusable nav; invisible focus |
| A11y | 269 `<label>` / 1 `for=` (`:387`) | Unassociated labels |
| A11y | `:7696–7770` `om/cm/_openStacked` | No dialog semantics or focus management |
| Mobile | `:72` vs `:1290`, `:3785` | 16px font in 60–80px numeric inputs |
| Mobile | styles.css `:35` | `nowrap` + ellipsis truncation, no tooltip on touch |
| Mobile | `:10480–10517` `_descargarComoPDF` | Hidden-iframe print unreliable on mobile |
| PDF | `:3065`, `:10385`, `:10460`, `:7832` | Validity text "15 días"; forced 10-day offer; validity tied to plazo |
| PDF | `:10457` | 124 KB inline logo (+ copies at `:81`, `:147`) |
| PDF | `:10403`, `:10464–10466`, `:5586`, `:5647–5650` | Unescaped interpolation |
| PDF | `:5649` `printCartel` | No overflow clamp on the A4 sign |

---

## 6. Changes vs 2026-09-16 audit

**Improved:**
- **More partial-update paths in the cotizador.** `cotSync()` (L2309) updates around 30 fields without re-render and guards `activeElement`. Paginado edits restore focus (`cotPagEd`, L3583–3594). The tab-order pain was acknowledged and fixed in these two spots only.
- **Render-time escaping helpers exist and are used.** `cotEsc` (144 uses), `escHtml` (37), `sanTxt` (15), `_descHtml` (7). The previous audit credited none. Coverage is still partial (§1.7, §1.8).
- **Pagination helper** `_pagina`/`_pagCtrl` (L129–133, 25 rows) for large tables.
- **Snapshot guard against stale echoes** (`_snapPend` deferral with timestamps, L530–547). The comments document a previously fixed "paso se desmarca" bug.
- **Save path writes only changed docs** (JSON cache) and strips `undefined` (L236–251); blob writes use field-level `updateDoc` (L259–267). This is better than the previous full rewrite, but see §1.1 for the remaining lost-update problem.
- A CSP meta tag (L10) and the redirect to the canonical host (L6–7) are present (not mentioned in the previous audit).

**Worse:**
- **Size and debt grew across the board:** lines +24%, `onclick` +41%, `render()` sites +155%, globals 45 → 52, overlay ids 8+ → 14, blocking dialogs 117 → 155 (prompts now counted).
- **New features added complex state without a model:** the per-quantity pointer swap (`porCant`, `_cotSwapA`), AI pre-costing, and an **undo FAB that monkey-patches `sk` and `render`** (L9847). This is a data-loss vector that did not exist on 09-16.
- **New, verified defects:**
  - es-AR round-trip corruption in cost tables and the dollar rate (§1.4)
  - Escape fall-through from the costing overlay (§1.3)
  - dead `_editandoCotId` guard (§1.1)
  - PDF validity contradictions (§1.8)
  - unescaped AI strings (§1.7)
- **Mobile regressions from feature density:** 343 inline font sizes of 10px or less, and the dense cot-embed and costos tables, with no mobile adaptation beyond padding.

**Unchanged:**
- Accessibility: still 0 ARIA, 0 roles, 0 tabindex, 0 landmarks, div-based nav, no dialog semantics.
- DOM-as-truth (`_leerItemsDOMNuevo`), the full-innerHTML render with the scroll hack, and the global date MutationObserver.
- No z-index scale, no design tokens, single-file architecture, `styles.css` untouched since 2026-07-12.
- The quick wins from 09-16 (focus management in `om`/`cm`, `.ni` → `<button>`, Z constants, a toast system) were **not implemented**.

**Score movement:** overall 3.5 → **3.0**. State 3 → 2, Responsive 7 → 6, Error states 5 → 4. Rendering 4 and Accessibility 1 are unchanged. Two new criteria were added: Input/number formats **2** and Print/PDF **5**.

*Report only. No production code was modified.*
