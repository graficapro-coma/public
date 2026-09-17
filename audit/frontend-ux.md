# Frontend / UX / State-Management Audit — "Gráfica Pro"

**Scope:** Frontend architecture, rendering, UX, accessibility, forms, responsiveness, i18n, and state management ONLY. Backend/security/data-model out of scope except where they leak into the UI layer.

**Target:** `G:\Mi unidad\GRUPO COMA\6 - ESTEBAN\CLAUDE\GRAFICA PRO\index.html` — single-file SPA, **8,543 lines**, no framework, hand-rolled render loop over Firestore.

**Verdict up front:** Functional and clearly battle-tested by its authors (lots of defensive patches, save-throttling, scroll-restoration hacks), but architecturally it is a **string-templating monolith with global mutable state and effectively zero accessibility**. It works because one team knows where the bodies are buried. For an acquisition, the maintenance and accessibility risk is **High**.

---

## 1. Quantified inventory (grep evidence)

| Metric | Count | Notes |
|---|---:|---|
| `onclick=` handlers | **328** | Interactivity is inline-attribute driven |
| `<button` elements | **245** | Many click targets are `<div>`/`<span>`/`<a>` instead (see §Accessibility) |
| Other inline handlers (`onchange/oninput/onkeydown/onblur/onfocus`) | **125** | Logic wired directly into markup strings |
| `alert(` | **76** | Blocking native dialogs for all error/feedback |
| `confirm(` | **41** | Blocking native dialogs for all destructive/guard flows |
| `innerHTML` assignments | **199** | Primary render mechanism; XSS surface + focus loss |
| `render()` (full-page re-render fn) | 1 fn, called ~74× | Blows away `#pg` innerHTML wholesale |
| `document.body.appendChild` | **18** | Overlays/toasts appended to body |
| `position:fixed` blocks | **17** | Overlays, toasts, sidebar drawer, save indicator |
| Distinct `z-index` values | **12** (`1100, 8999, 9000, 9001, 9999, 99998, 99999, 100000, 100001, 100002, 100004, 100020`) | No scale/token system — ad-hoc escalation |
| Distinct fixed-overlay element ids | **8+** (`ov`, `ov2`, `cot-embed`, `cot-desg`, `estr-armar`, `ai-ov`, `save-indicator`, `backup-reminder`) | Multiple independent overlay lifecycles |
| `window._*` global variables | **~45 distinct** names | Plus `S` and ~15 module-level `let`s |
| `aria-*` / `role=` / `tabindex` | **0** | Zero. None. |
| Semantic landmarks (`<main>/<nav>/<header>/<section>/<footer>/<aside>`) | **0** | Layout is all `<div class>` |
| `.focus()` programmatic calls | 10 | No focus trap, no focus restore after modal/render |
| `toLocaleString`/`es-AR`/`Intl` | 51 | Locale hardcoded `es-AR`; all UI strings hardcoded Spanish |
| `@media` breakpoints | 3 (1200/900/640px) | Mobile handled better than expected (see §Responsiveness) |

---

## 2. State management

### 2.1 Sources of truth (three, competing)
1. **`S` — one global mutable object** (`index.html:302-317`). Holds every collection: `clientes, proveedores, cotizaciones, ordenes, remitos, facturas, cobranzas, gastos, fichas, procesos, maquinas, ... cotEstructuras`. Directly mutated throughout; `sv(k, S[k])` persists a slice.
2. **~45 `window._*` globals** — scattered ambient state. Examples: `_cotItems`, `_dotRows`, `_aiImgs`, `_extraCtx`, `_editandoCotId`, `_cotVariantes`, `_cotVarActiva`, `_papelModo/_papelTab/_papelFecha/_papelFechaSel/_papelFiltroPapelera`, `_cliRetCtx`, `_provRetSel`, `_estrAprEi/_estrAprNuevos`, plus a whole `window.__undo*` machine (`index.html:7909`) and Firestore handles (`_fsDoc/_fsGet/_fsSet/...`) and save-coordination flags (`_saveEnCurso`, `_ultimoGuardadoLocal`, `_snapPend`, `_docJson`, `_knownIds`). Module-level `let`s add more: `planMaq, planOffset, tallerOff, cotW, bCli, bProv, pCli, pProv, curPg, _lastRenderPg, _scrollPorPg, _saveTimer`.
3. **The DOM itself** — `_leerItemsDOMNuevo()` (`index.html:6434-6445`) reads `.value` from live inputs (`#ci2 .id2`, `#ci2 .in2`) back into `_cotItems` *before* saving, because "onfocus puede dejar cosas sin actualizar." This is an explicit admission that state and DOM drift apart; the DOM is treated as authoritative for the quote-items grid.

**Consequence:** No single source of truth. To know "what is the current quote?" you must reconcile `_cotItems` + `_cotVariantes` + `_cotVarActiva` + `_editandoCotId` + whatever is currently typed into un-blurred inputs. This is the classic condition under which "I saved but it saved the wrong number" bugs appear.

### 2.2 Re-entrancy / save coordination
The save path is hand-synchronized with flags (`window._saveEnCurso`, `window._snapPend`, `window._ultimoGuardadoLocal`, `index.html:472-526`) and per-key debounce timers (`_costosSaveT`, `_estrSaveT`, `_backupTimer`, `_saveTimer`). Comments (`index.html:234-236`) reveal a prior bug where "reescribía la colección entera en cada guardado ... agotaba la cuota de Firestore." The current fix caches JSON per doc in `window._docJson`/`window._knownIds`. This works but is **implicit, undocumented coupling**: the correctness of persistence depends on these globals staying in sync with `S` and with Firestore's onSnapshot echo. Any new contributor mutating `S` without touching the cache invites silent divergence.

### 2.3 Coupling
- `render()` is a giant dispatch (`index.html:2880-2896`) mapping `curPg` → one of 20 render functions, each returning an HTML string. State reads are global; there is no props/data-flow discipline.
- Business logic, formatting, and markup are interleaved inside template literals (e.g. `updateCliTable`, `index.html:2902-2919` — filtering, pagination, highlighting, and `<tr onclick>` wiring all in one function).

**Score: 3/10.** It is coherent enough that the authors ship features, but it is the definition of implicit global state with DOM-as-truth confusion.

---

## 3. Rendering & UX

- **Full innerHTML re-render.** `render()` does `pg.innerHTML = fns[curPg]()` (`index.html:2886`). Every re-render destroys and rebuilds the entire page subtree. **Focus is lost** on any re-render — there is no focus save/restore (only 10 `.focus()` calls total, none tied to the render cycle).
- **Scroll is hacked back.** `_scrollPorPg`/`_lastRenderPg` (`index.html:2879-2895`) store per-page scrollTop and restore it, with a `requestAnimationFrame` double-set "por si el contenido tarda un frame." This is a workaround for the destroy-rebuild approach, not a fix; it restores scroll but not focus, selection, or in-progress input caret.
- **Partial-update escape hatches exist** where the full re-render was too painful: `updateCliTable`/`updateProvTable` patch only `#cli-tbody`/`#cli-pag` innerHTML (`index.html:2902-2919`), and the cotizador updates individual fields by id guarding `document.activeElement` (`index.html:1879-1880`) precisely to avoid clobbering what the user is typing. So the team already discovered the re-render problem and patched the worst spots by hand.
- **Overlay soup.** At least 8 distinct overlay element ids, each with its own create/append/remove lifecycle: the generic modal `ov`/`ov2` (`om`, `index.html:5955-6006`; `_openStacked`, `6018-6029`), plus independent overlays `cot-embed`, `cot-desg` (`2531`), `estr-armar` (`6454`), `ai-ov` (`6143`), and toasts `save-indicator` (`158`), `backup-reminder` (`3000`). Only `ov`/`ov2` are closed by `cm()` and Escape; the others manage their own closers (`cotVerDesgloseCerrar`, `estrArmarCerrar`). **Escape and click-outside do not uniformly dismiss all overlays** → orphaned-overlay risk.
- **Z-index has no system.** 12 distinct hardcoded values from `1100` up to `100020`. `_openStacked` uses `100020`, `estr-armar` and `ai-ov` both use `100001`, `cot-desg` uses `100004`. Stacking is by trial-and-error; two overlays at `100001` will collide by DOM order, not intent.
- **Modal stacking supports one level reliably.** `cm()` (`index.html:6007-6016`) special-cases exactly `ov2` over `ov`, juggling `_escHandler`/`_baseEsc` to suspend/restore the lower modal's Escape. A third stacked layer, or any non-`ov` overlay opened on top, is outside this bookkeeping.

**Score: 4/10.**

---

## 4. Accessibility — the worst category

- **Zero ARIA, zero roles, zero tabindex.** Grep for `aria-|role=|tabindex` returns **0 matches** across 8,543 lines.
- **Zero semantic landmarks.** No `<main>`, `<nav>`, `<header>`, `<section>`. The sidebar nav is `<div class="ni" onclick="nav('cli')">` (`index.html:82-96`) — not focusable, not keyboard-operable, not announced as navigation.
- **Div/span-onclick everywhere.** 328 `onclick` vs 245 `<button>`; the gap plus the nav and table-row pattern (`<tr class="rlink" onclick="om('vc',...)">`, `index.html:2915`) means a large fraction of primary actions are on non-interactive elements: not tab-reachable, no Enter/Space activation, no role announced to screen readers.
- **Modals are not accessible dialogs.** No `role="dialog"`, no `aria-modal`, no focus trap, no focus-on-open, no focus-return-on-close. A keyboard or screen-reader user cannot reliably operate the quote/OT modals — which is where the core work happens.
- **Color-only signaling.** Status uses color chips/traffic-light metaphors (e.g. `nav('seg')` "Seguimiento", traffic-lights icon; provisional-client badge `index.html:2912`) without text/ARIA equivalents in the interactive path.
- **Native `alert/confirm`** are at least screen-reader-audible, so error *delivery* is technically accessible — but it's the only accessible feedback channel, by accident.

**Score: 1/10.** This would fail any WCAG 2.1 AA review outright and is a legal/compliance liability in many jurisdictions.

---

## 5. Forms & validation

- **Feedback is 76 `alert()` + 41 `confirm()`** — 117 blocking native modal dialogs. No inline, field-level validation UI; no error summaries; no `aria-invalid`/`aria-describedby`. Example guard: `nav()` uses `alert('No tenés permiso...')` (`index.html:2872`).
- **Validation is client-only and ad-hoc**, scattered inline (`onkeydown="if(event.key==='Enter')..."`, `index.html:3701`) and inside save handlers.
- **Unsaved-changes protection exists** for the two big forms (`MODALES_PROTEGIDOS=['nc2','ec2']`, `index.html:5973`) via `confirm('¿Cerrar sin guardar?...')` on outside-click and Escape — a genuine UX positive, though implemented with blocking dialogs.
- **DOM-read-before-save** (`_leerItemsDOMNuevo`) means validation state can be bypassed if inputs aren't blurred; the app compensates by re-reading the DOM rather than validating a model.

**Score: 3/10.**

---

## 6. Responsiveness / mobile — the best category

- Proper `<meta name="viewport">` (`index.html:5`).
- Three real breakpoints (1200 / 900 / 640, `index.html:32-75`): tablet narrows the sidebar; ≤900px converts the sidebar to a slide-in drawer with backdrop (`.sb-backdrop`, `.menu-btn`); ≤640px bumps inputs to 16px to stop iOS zoom.
- Wide tables get `overflow-x:auto` with `-webkit-overflow-scrolling:touch` inside cards (`index.html:52`); modals go near-fullscreen on mobile (`index.html:56-57`).
- Grid layouts collapse to one column via attribute-selector overrides (`index.html:66-67`).

This is thoughtfully done and clearly tested on phones. **Score: 7/10.** (Caveat: horizontal-scroll tables are a mediocre mobile pattern for a data-dense ERP, and the drawer nav is still keyboard-inaccessible.)

---

## 7. Consistency & i18n

- **Single-locale by design.** All UI strings hardcoded Spanish; numbers/dates formatted with `es-AR` (`toLocaleString('es-AR', ...)`, `index.html:3859`) in 51 places. No i18n layer, no string catalog. Fine for an internal Argentine print shop; a blocker if the acquirer wants to localize.
- **Date display is monkey-patched.** A global observer rewrites visible `AAAA-MM-DD` → `DD/MM/AAAA` (`index.html:6033+`) rather than formatting at the source — fragile and surprising.
- **Visual consistency** is decent (shared `.card`, `.mod`, `.ph`, `.ni` classes, consistent blue `#185fa5` brand), but styling is a mix of external `styles.css`, an embedded `<style>`, and thousands of inline `style="..."` strings, making theming/rebranding costly.

**Score: 5/10.**

---

## 8. Error / empty / loading states

Present more than expected:
- **Loading:** connect splash in `init()` (`index.html:320`), Firebase 10s timeout with a failure message (`324-326`), spinner save indicator (`showSaving`, `156-162`).
- **Error:** `showSaveError` with a "Reintentar" affordance and `window._pendingSave` retry (`169-180`) — a real, non-blocking error state (the exception to the alert()-everything rule).
- **Empty:** `.empty` state markup with icon + message in tables ("Sin resultados para...", `index.html:2916`).

These are inconsistent (some flows use `alert`, some use inline states) but the primitives exist. **Score: 5/10.**

---

## 9. Rubric summary

| # | Criterion | Score /10 | Key evidence |
|---|---|---:|---|
| 1 | State management (single-source-of-truth, coupling, re-entrancy) | **3** | `S` global + ~45 `window._*` + DOM-as-truth (`index.html:302`, `6434`, `472-526`) |
| 2 | Rendering architecture & UX robustness | **4** | full `innerHTML` re-render + scroll hack, focus lost (`index.html:2880-2896`); overlay soup (§3) |
| 3 | Accessibility | **1** | 0 aria/role/tabindex, 0 landmarks, div-onclick nav (`index.html:82-96`) |
| 4 | Forms & validation UX | **3** | 76 `alert` + 41 `confirm`, no field-level validation |
| 5 | Responsiveness / mobile | **7** | 3 breakpoints, drawer nav, iOS zoom fix (`index.html:27-75`) |
| 6 | Consistency & i18n | **5** | hardcoded `es-AR` (51×), inline-style sprawl, date monkey-patch |
| 7 | Error / empty / loading states | **5** | retry save state, loading splash, `.empty` markup |
| 8 | Maintainability / architecture | **3** | 8.5k-line single file, logic+markup interleaved, 199 `innerHTML`, 328 inline `onclick` |

### Overall: **3.5 / 10** — Frontend risk **HIGH**

Not "broken." It ships and the team is productive. But it is a monolithic, globally-mutable, string-templated SPA with a genuine accessibility floor of zero and a maintenance cost that scales badly with new hires. For an acquisition, the cost to bring this to a maintainable, accessible baseline is substantial and must be priced in.

---

## 10. Top risks blocking approval

1. **Accessibility = 0** (`aria/role/tabindex` count: 0; landmarks: 0; nav is div-onclick, `index.html:82-96`). Legal/compliance exposure (WCAG/ADA/EU EAA) and unusable by keyboard/AT users. Non-trivial to retrofit given div-onclick is pervasive.
2. **Three competing sources of truth** — `S`, ~45 `window._*` globals, and live DOM read back via `_leerItemsDOMNuevo` (`index.html:6434`). This is the root cause of "saved the wrong value" / stale-state bug classes and makes every change risky.
3. **Fragile persistence coordination** on implicit globals (`_saveEnCurso`, `_snapPend`, `_docJson`, `_knownIds`, `index.html:472-526`, `234-252`) — a documented prior incident (Firestore quota exhaustion) already occurred here. New contributors will re-trip it.
4. **Overlay/z-index anarchy** — 8+ overlay lifecycles, 12 ad-hoc z-index values, only 1 level of modal stacking reliably handled by `cm()` (`index.html:6007-6016`). Orphaned-overlay and stacking-collision bugs are latent.
5. **8,543-line single file** with markup, business logic, and persistence interleaved. Bus-factor and onboarding risk.

## 11. Quick wins (days, low risk)

- Add `role`/`aria-label` to the generic modal (`om`, `index.html:5969`), `role="navigation"` to `.sb`, and convert the sidebar `.ni` divs to `<button>` (or add `role="button"` + `tabindex="0"` + keydown) — recovers the most-used surface for keyboard/AT at low cost.
- Add focus-on-open and focus-restore-on-close in `om()`/`cm()`; add a focus trap in the overlay. ~30 lines, huge a11y payoff.
- Replace the destructive-action `confirm()`/error `alert()` calls with the existing non-blocking toast pattern (`showSaveError` already proves the pattern, `index.html:169`).
- Introduce a `Z` constant object for z-index tiers and route all overlays through one `openOverlay()` that registers Escape/click-outside centrally — eliminates orphaned overlays.
- Guard all `innerHTML` sinks for user data (199 sites) — the code already sanitizes at save (`_SAN_FIELDS`, `index.html:269`) but render-time is the correct defense.

## 12. Deeper refactors (weeks–months)

- **Introduce a real state container** (even a tiny observable store) and make `S` the single source of truth; delete the `window._*` ambient globals and the DOM-read-back path (`_leerItemsDOMNuevo`). Bind inputs to state on `input`, render from state only.
- **Move to keyed/diff rendering** (lit-html, Preact, or a hand-rolled keyed patch) to stop full-`innerHTML` teardown — this removes the scroll/focus-loss hacks entirely.
- **Split the 8.5k-line file** into modules (state, persistence, render/views, components) with a build step; separate markup from logic.
- **Build an accessibility baseline** (landmarks, focus management, dialog semantics, form validation with `aria-invalid`/live regions) and gate CI on axe.
- **Extract an i18n string layer** if any non-`es-AR` market is in scope.

*Report only. No production code was modified.*
