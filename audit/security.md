# Gráfica Pro — Security / Auth / Data-Protection Due-Diligence Audit

**Scope:** Security, authentication/authorization, and data protection ONLY. Acquisition posture: adversarial (reasons NOT to buy).
**Artifacts reviewed:** `index.html` (~8.5k lines), `firebase-config.js`, `netlify/functions/interpretar.js`, `netlify.toml`. Firestore security rules were **NOT provided** and could not be reviewed.
**Date:** 2026-09-16

---

## 0. Executive verdict

**Overall security score: 3.5 / 10.**
**Risk rating: HIGH (borderline CRITICAL), pending one unverifiable fact.**

The single most consequential control in this entire product — the Firestore security rules — is **not in the repository and cannot be verified**. Every piece of business data (clients, CUITs, prices, margins, financials) is written to Firestore *directly from the browser* with a publicly-shipped API key. If those rules are permissive (the Firebase default "test mode" is `allow read, write: if true;`), the entire database is world-readable/writable by anyone who reads the JS bundle. Nothing in the client can compensate for that. **Treat missing rules as a critical, deal-blocking unknown until the buyer is shown the deployed rules.**

Beyond that, the app's role/authorization model is **client-side only** (CSS `display:none` + JS `if` guards). There is real *authentication* (Firebase email/password), but effectively **no server-side authorization**. The Anthropic-backed serverless function is **open to the internet with no auth, no rate limit, and `Access-Control-Allow-Origin: *`** — a direct path to unbounded spend on the buyer's Anthropic key.

---

## 1. Is there real authentication? Yes. Real authorization? No.

**Authentication — REAL.** Firebase Auth email/password is genuinely wired in:
- `index.html:185-196` imports `signInWithEmailAndPassword`, `onAuthStateChanged`, `signOut`, `createUserWithEmailAndPassword`.
- `index.html:329-349` gates the UI on `onAuthStateChanged`; unauthenticated users get `mostrarLogin()` and the sidebar is hidden (`:322`, `:346`).
- `index.html:383-401` `doLogin()` performs a real credential check; `:392-393` sets LOCAL/SESSION persistence.

This is NOT merely CSS hiding of a login screen — an unauthenticated visitor cannot obtain a Firebase ID token and (if rules require `request.auth != null`) cannot read data. Good.

**Authorization / roles — NOT REAL (client-side theatre).** The "finance" role boundary is enforced only in the browser:
- `index.html:670-671`
  ```js
  function rolUsuario(){return ((currentUser&&currentUser.email)||'').toLowerCase().split('@')[0];}
  function puedeVerFinanzas(){const r=rolUsuario();if(!r)return false;return /gerencia|admin|contab|direccion|esteban|juanpablo/.test(r);}
  ```
  **The user's "role" is derived from the local-part of their own email address** via a regex. There is no roles table, no custom claims, no server check. Any account whose email contains `admin`, `contab`, `gerencia`, etc. is "finance". Worse: because rule enforcement is client-side, role is irrelevant to data access — see below.
- `index.html:674-676` `aplicarVisibilidadRol()` merely toggles `el.style.display` on `.fin-only` elements. Hiding, not access control.
- `index.html:2870-2874` `nav()` blocks finance pages with an `alert()` and `return` — trivially bypassed by calling `render()`/the page function from DevTools, or by reading `S.gastos` / `S.cotConfig` directly in the console.
- `index.html:414-417` `crearUsuario()` restricts user creation to `esteban-gerencia` **in the client only**. Any authenticated user can call `createUserWithEmailAndPassword(auth2, ...)` directly from the console (the function is imported at `:185`), or self-register with the public apiKey if email/password sign-up is enabled in the Firebase console (unverifiable here — **flag**).

**Consequence:** All data lives in `S` (in-memory) and Firestore. `ld()`/`sv()` (`index.html:205-259`) read/write `/gp/{collection}/docs/*` with the logged-in user's token. If Firestore rules only check `request.auth != null` (a very common misconfiguration), then **every authenticated user — regardless of "role" — can read and write every client's PII, every price, every margin and balance**, directly, bypassing `puedeVerFinanzas()` entirely. The finance gate is cosmetic.

---

## 2. Firestore security rules — MISSING / UNVERIFIABLE (critical)

- Rules are not in the repo. Data is written from the browser via the client SDK (`index.html:207-258`), and the config (`firebase-config.js`) ships `apiKey`, `projectId: "graficapro-coma"`, etc. publicly.
- A Firebase `apiKey` is **not** a secret and its exposure (`firebase-config.js:2`) is normal — **but it is also the project identifier that lets anyone target the database.** The *only* thing standing between the internet and this data is the Firestore rules, which we cannot see.
- **Default "test mode" rules are open.** Until proven otherwise, assume the database may be world-accessible. This is the top deal risk.
- **Action for buyer:** Demand the deployed `firestore.rules`. Confirm rules require `request.auth != null` AND enforce per-collection/field authorization (e.g. only finance roles via custom claims can read `gastos`, `cotConfig`, `analCostos`). Confirm email/password self-signup is disabled in the Firebase console. Without these, do not proceed.

---

## 3. XSS — string-concatenated `innerHTML` throughout; escaping is inconsistent and defense is at the wrong layer

**Sink volume:** `innerHTML` assignments/uses: **74** (`grep innerHTML`). `onclick=` inline handlers built by string concatenation: **328**. Essentially the entire UI is rendered by concatenating data into HTML template strings and assigning to `.innerHTML` — a large XSS attack surface by construction.

**The mitigation model is fragile.** There are two helpers:
- `index.html:832` `escHtml()` — escapes `& < > "` at *render* time.
- `index.html:837` `sanTxt()` — strips only `< >` at *save* time.
- `index.html:269-289` `_SAN_FIELDS` + `_sanitizeColeccion()` strips `< >` from a **hard-coded whitelist of fields** before every save (`sk()` at `:291-292`).

Problems:
1. **Save-time stripping only removes `<` and `>`, not `"` or `'`.** Any field rendered inside an HTML **attribute** without `escHtml` is injectable via a quote. Example — ficha email rendered raw into an `href`:
   `index.html:4879`
   ```js
   ...f.facEmail1?`<a href="mailto:${f.facEmail1}">${f.facEmail1}</a>`:'—'...
   ```
   `facEmail1` is **not** in `_SAN_FIELDS.fichas` (`:277`), so it isn't even quote/angle-stripped, and it is emitted unescaped into an attribute. A value like `x" onmouseover="alert(document.cookie)` yields attribute-injection XSS. Same pattern for `facCuit`, `facCondIva`, `facDomicilio`, `facTelefono`, `cobCondPago`, `cobEmail`, etc. at `:4879-4880` — **all rendered raw, none in the sanitize whitelist.**
2. **Render-time escaping is applied unevenly.** Some sinks correctly use `escHtml()` (e.g. `:6075`, `:2751`, `:7973`). Others concatenate raw data:
   - `index.html:4782` `${f.descripcion.replace(/\n/g,'<br>')}` — raw, no `escHtml`.
   - `index.html:4815` `${f.observacionesTrabajo.replace(/\n/g,'<br>')}` — raw.
   - `index.html:4880` `${f.cobDetalle.replace(/\n/g,'<br>')}` — raw.
   - `index.html:4879` `<strong>${f.facRazonSocial}</strong>`, `${f.facCuit}` — raw.
   Total raw `\n→<br>` sinks that skip escaping: **4** (`:4782,4815,4880` + `:379/335` logo). These fields *happen* to be angle-stripped at save (they are in `_SAN_FIELDS`), so stored `<script>` is blocked — **but the safety depends entirely on the save-side whitelist matching the render-side sink, a coupling that will silently break the next time a developer adds a field or a render path.** Escaping belongs at the render sink (`escHtml`/`_descHtml` at `:834`), and here it is frequently absent.
3. **Data arrives from an untrusted-ish channel:** the AI function output (`aiAplicar(data)` at `:6221`) and imported JSON backups (`restaurarBackup()` at `:3010`) populate `S` and are rendered. A malicious/compromised backup file or manipulated AI response could carry attribute-breaking payloads into raw-attribute sinks that bypass the save whitelist.

**Net:** Stored XSS via the *body* of whitelisted text fields is largely blocked, but **attribute-context XSS via non-whitelisted fields (CUIT, emails, phones, domiciles, payment terms) rendered raw into `href`/`value`/`style` is live.** Given roles are client-side, an XSS running in a finance user's session = full data compromise.

---

## 4. Serverless function `interpretar.js` — open relay to a paid API

`netlify/functions/interpretar.js`:
- **Open CORS + no authentication.** `Access-Control-Allow-Origin: '*'` (`:5`) and the handler never checks any auth token, session, or origin allow-list. **Anyone on the internet can POST to `https://<site>/.netlify/functions/interpretar` and cause calls to Anthropic billed to the buyer's `ANTHROPIC_API_KEY`.** The browser call (`index.html:6218`) sends no credential either — there's nothing to check.
- **No rate limiting / no abuse controls.** No per-IP throttle, no quota, no CAPTCHA. Combined with the above, this is a straightforward cost-amplification / denial-of-wallet vector.
- **Large, expensive requests.** `max_tokens: 8000` per call (`:82`). Up to **4 images** accepted (`:21`) as base64 with **no per-image or total payload size cap** — only the media-type is checked (`:18-20`). A caller can push megabytes of base64 per request, multiplying token/cost and bandwidth. `pedido` is capped at 8000 chars (`:15`) — the only input bound present.
- **Prompt injection is possible but low-blast-radius.** Output is constrained by `tool_choice` to the `cargar_cotizacion` schema (`:43-84`), so free-form model output can't easily escape into the app — good. However injected instructions could still corrupt the structured values a human then approves.
- **Error leakage.** `:97` returns `String(e.message)` and `:92` forwards the upstream Anthropic error message to the client. Low severity, but it leaks internal/dependency detail.
- The env-var handling itself is fine: key is read from `process.env.ANTHROPIC_API_KEY` (`:9`), never shipped to the client. `netlify.toml` only omits the non-secret model name from the secret scanner (`:8`) — acceptable.

---

## 5. Data protection / PII / operational

- **PII exposure hinges entirely on Firestore rules (see §2).** Clients' names, CUIT (tax ID), emails, phones, domiciles, plus all pricing/margin/financial data are stored in Firestore and mirrored into `S`. No field-level encryption, no data classification. If rules are weak, this is a full PII + commercial-secrets breach.
- **No audit log.** No record of who read/changed/deleted clients, prices, or financial records. `doLogout()` (`:403-410`) clears local state but nothing is logged anywhere. For an ERP handling money, absence of an audit trail is a material gap (accountability, incident response, dispute resolution).
- **Backups are unencrypted client-side JSON.** `descargarBackup()` (gated only by client-side `puedeVerFinanzas()`, `:2987`) dumps the entire dataset — all PII and financials — to an unencrypted `.json` on the user's disk (`:105` nav entry). `restaurarBackup()` (`:3010`) re-imports arbitrary JSON with only a `confirm()`; a tampered file becomes trusted app state and feeds the XSS sinks in §3. No integrity check, no encryption at rest for the export.
- **No secrets in `localStorage`.** `grep localStorage` → **0 matches**; session persistence is delegated to Firebase Auth's own storage. This is a genuine positive.
- **HTTPS.** Netlify serves HTTPS by default and there's no mixed-content risk in the reviewed code, but there is no explicit HSTS/CSP configured in `netlify.toml` (no `[[headers]]` block). **No Content-Security-Policy** is set — which matters given the 74 `innerHTML` sinks; a CSP would meaningfully blunt the XSS surface and is absent.
- **`prompt()` for passwords.** `crearUsuario()` (`:418-419`) collects a new user's password via `prompt()` — plaintext in the DOM, shoulder-surfable, no strength policy. Minor, but sloppy for a credential path.

---

## 6. Scored rubric

| # | Criterion | Score /10 | Evidence |
|---|-----------|:---------:|----------|
| 1 | **Authentication** | 6 | Real Firebase Auth (`index.html:185-196,329-349,383-401`). Loses points: password via `prompt()` (`:418`), self-signup possibly enabled (unverifiable), no MFA. |
| 2 | **Authorization (server-side)** | 1 | Purely client-side. Role = regex on own email (`:670-671`); guards are `display:none` (`:674-676`) and `alert()+return` (`:2870-2874`), bypassable from console. No custom claims. |
| 3 | **Backend data-access rules (Firestore)** | 1* | Rules absent from repo; browser writes directly (`:207-258`) with public config (`firebase-config.js`). Unverifiable; default-open is the working assumption. *Provisional — could be 8 if rules are shown to be strict, or 0 if open. |
| 4 | **XSS / output encoding** | 3 | 74 `innerHTML` + 328 inline `onclick` sinks; escaping inconsistent; raw attribute sinks for non-whitelisted PII (`:4879-4880`); save-side strip removes only `<>` not `"` (`:283`); no CSP. |
| 5 | **Serverless abuse resistance** | 2 | Open CORS `*`, no auth, no rate limit, no payload-size cap on base64 images (`interpretar.js:5,18-21,82`) → denial-of-wallet on Anthropic key. |
| 6 | **Secrets management** | 7 | Anthropic key server-side only (`interpretar.js:9`); no secrets in localStorage; Firebase apiKey exposure is expected/acceptable. |
| 7 | **PII & data-at-rest / backups** | 3 | Full PII+financials in Firestore (rules-dependent); unencrypted JSON backup/restore (`:105,3010`); no field encryption. |
| 8 | **Auditability & monitoring** | 2 | No audit log of reads/writes/deletes; errors leaked to client (`interpretar.js:92,97`); no CSP/HSTS headers. |

**Overall: 3.5 / 10.**

---

## 7. Top risks that BLOCK approval

1. **Firestore rules unknown / possibly open (CRITICAL, unverifiable).** With client-direct writes and a public project config, weak rules = full remote read/write of all PII + financials by anyone. Blocks approval until deployed rules are produced and shown to enforce auth + per-role/field access. (`index.html:207-258`, `firebase-config.js`)
2. **No real authorization — finance boundary is client-side only (HIGH).** `puedeVerFinanzas()` regex on email + `display:none` + `alert()` guards (`:670-676,2870-2874`) are trivially bypassed; any authenticated user can reach all data if rules permit. Roles must move to Firebase custom claims + rules.
3. **Open, unauthenticated, unthrottled AI endpoint (HIGH — direct financial loss).** `interpretar.js:5,18-21` — `ACAO:*`, no auth, no rate limit, no image-size cap. Public denial-of-wallet against the Anthropic key from day one.

---

## 8. Quick wins (days, low risk)

- **Lock down `interpretar.js`:** verify the Firebase ID token server-side (client already has one — send it in `Authorization`), restrict CORS to the production origin (replace `*` at `:5`), add a per-IP/day rate limit, cap total base64 bytes (e.g. reject >4-5 MB) at `:19-21`, and stop forwarding raw upstream/`e.message` errors (`:92,97`).
- **Disable email/password self-signup** in the Firebase console (if not already) so the public apiKey can't be used to self-register.
- **Add a Content-Security-Policy + HSTS** via a `[[headers]]` block in `netlify.toml` (no CSP today) to blunt the 74-sink XSS surface.
- **Fix the raw attribute sinks:** wrap every attribute interpolation of user data in `escHtml()` — notably `:4879-4880` (`facEmail1/facCuit/facCondIva/...` into `href`/text) and audit all `href="...${...}"` / `value="...${...}"` / `style="...${...}"` interpolations. Extend `_SAN_FIELDS.fichas` (`:277`) to cover CUIT/emails/phones/payment-term fields, or better, escape at render.
- **Encrypt or password-protect backup exports** and add an integrity check on `restaurarBackup()` (`:3010`).

## 9. Deeper issues needing refactor

- **Re-architect authorization around Firebase custom claims + comprehensive Firestore security rules**, with per-collection and per-field enforcement (e.g. `gastos`, `cotConfig`, `analCostos`, prices/margins readable only by finance claims). This is the load-bearing fix; the client `puedeVerFinanzas()` should become a UI convenience only.
- **Move away from `innerHTML` string concatenation** (74 sinks) toward a templating approach with auto-escaping or DOM APIs / `textContent`, eliminating the whole class of XSS rather than patching sinks one by one. Centralize all rendering through `escHtml`/`_descHtml`.
- **Introduce an audit log** (append-only, server-enforced) for creates/updates/deletes of clients, prices, and financial records — required for an ERP handling money.
- **Server-side write validation.** Because the browser writes documents directly, malformed/malicious documents can only be stopped by Firestore rules' schema validation or a Cloud-Function write proxy; today there is neither in evidence.

---

## Appendix — quantified findings
- `innerHTML` sinks: **74**. Inline `onclick=` handlers: **328**. Raw `\n→<br>` unescaped sinks: **4** (`index.html:4782,4815,4880`, plus logo `img src` interpolations at `:335,379`).
- Save-time sanitizer strips only `[<>]` (`index.html:283`), never `"`/`'` → attribute-context injection remains.
- Non-whitelisted ficha fields rendered raw (examples): `facCuit`, `facCondIva`, `facDomicilio`, `facTelefono`, `facEmail1/2`, `cobCondPago`, `cobFormaPago`, `cobDiasHorarios`, `cobContacto`, `cobTelefono`, `cobEmail` (`index.html:4879-4880`; whitelist at `:277`).
- `localStorage` usage: **0** (positive).
- Serverless: CORS `*` (`:5`), no auth, no rate limit, `max_tokens:8000` (`:82`), up to 4 images with no size cap (`:19-21`).
- Firestore rules: **not present in repo** — unverifiable, treated as critical unknown.
