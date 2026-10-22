# Gráfica Pro — Security / Auth / Data-Protection Due-Diligence Audit (re-audit)

**Scope:** Security, authentication/authorization and data protection only. Posture: adversarial buyer/investor (reasons NOT to approve).
**Date:** 2026-10-02 (previous audit: 2026-09-16).
**Method:** Static, read-only review. No live requests were sent to the Netlify function, Firebase or Anthropic; nothing in production was touched. Anything that depends on Firebase/Netlify/Google console state is marked **[verify]**.

**Artifacts reviewed**

| File | Size / state |
|---|---|
| `index.html` | 10,571 lines, 1,019,072 bytes (was ~8.5k lines). Whole app. |
| `netlify/functions/interpretar.js` | 106 lines, modified 2026-10-01 |
| `firestore.rules` | 32 lines (dated 2026-07-11; the previous audit said it was missing) |
| `firebase-config.js`, `firebase.json`, `.firebaserc`, `netlify.toml`, `.gitignore` | config |
| `.firebase/hosting..cache` | shows the last Firebase Hosting deploy (2026-10-01) |
| `.git/config` | remote `github.com/graficapro-coma/GRAFICA-PRO`; last local commit 2026-07-11 |
| `tests/pruebas.js` | 1 security test (`sanTxt`) |
| `audit/security.md` (2026-09-16), `audit/SEGURIDAD-PENDIENTE.md` (2026-07-11) | baseline |

---

## 0. Executive verdict

**Overall security score: 2.5 / 10** (was 3.5).
**Security risk level: CRITICAL.** It drops to High only if the owner proves that public email/password sign-up is turned off in Firebase. If it is off, the app's own `crearUsuario()` would also stop working (see §2).

The previous audit could not see the Firestore rules. The rules are now in the repo and wired into `firebase.json`, so we can read them, and they are weak. Every path under `/gp/**` allows read and write to **any authenticated Firebase user** (`firestore.rules:22`). The domain restriction is commented out (`:23`). The app creates users with the **client-side** `createUserWithEmailAndPassword` (`index.html:440-443`), and that only works while public sign-up is enabled on the project. So anyone with the public `apiKey` (`firebase-config.js:2`) can create an account, receive a token that satisfies `request.auth != null`, and then read, change or delete every client, CUIT, price, margin and expense record. No UI is needed to do this.

Authorization is still entirely client-side (an email-prefix regex plus `display:none`). The Anthropic proxy is still an open, unauthenticated, unthrottled endpoint with `Access-Control-Allow-Origin: *`. None of the three blocking risks from 2026-09-16 has been closed. The XSS surface also grew: `innerHTML` went from 74 to 79 and inline handlers from 328 to 462. I confirmed several **stored XSS sinks in body context** (not just attribute context). One of them can be fed by the AI output, which means a customer's email can deliver the payload through prompt injection.

---

## 1. Scored rubric

| # | Criterion | Score /10 | Evidence (file:line) |
|---|---|:---:|---|
| 1 | **Authentication** | 4 | Real Firebase Auth: `index.html:183-198`, `:345-365`, `:399-417`. Points lost: public self-sign-up is effectively required by `crearUsuario()` (`:430-447`). No MFA. No password policy beyond Firebase's 6-character minimum, and the new password is collected with `prompt()` (`:435`). "Remember me" is pre-checked (`:386`), giving indefinite LOCAL persistence (`:409`) on shared shop PCs. No idle timeout. |
| 2 | **Authorization (server-enforced)** | 1 | Role = regex over the email local part: `rolUsuario()`/`puedeVerFinanzas()` (`:688-689`). Enforcement is `display:none` (`:692-695`) and `alert()+return` in `nav()` (`:4112-4117`). The page renderers sit in a plain object (`:4124`) and can be called directly. The admin check in `crearUsuario()` looks only at the local part (`:431`, so `esteban-gerencia@anything` passes). Firestore primitives are exported on `window` (`:189-198`), so `_fsDelDoc`/`_fsSet` can be called from the console. No custom claims, no rule-level roles. |
| 3 | **Backend data-access rules (Firestore) & tenant isolation** | 2 | `firestore.rules:19-25` grants read/write on all of `/gp/**` when `request.auth != null`. The default-deny at `:28-30` is good. No role, field, schema or delete constraints. The domain line `:23` is commented out, and it would not help anyway without an `email_verified` check. Single-tenant hard-coded root `gp` (`index.html:211,215,249,258`), so there is no tenant isolation model. Selling to a second shop requires a separate Firebase project. |
| 4 | **XSS / output encoding** | 2 | 79 `innerHTML`, 462 inline `onclick=`, 3 `document.write` into same-origin windows/iframes (`:5614,5655,5945`, `:10491`). Confirmed **stored XSS in body context** through fields that are never sanitized: client `cuit`/`domEnt` (`:7825`, `:10465`), ficha `facCuit/facEmail1/facCondIva/facDomicilio/facTelefono/cob*` (`:6620-6621`, written raw by `fichaSet()` `:6738-6741`), machine/external/freight names (`addRec()` `:9181-9189` → raw at `:9165,9170,9176,5683`), process names (`:8384` → `:8380`), and AI output `aiSug` (`:8205`, persisted at `:10107`). `escHtml`/`cotEsc` do not escape `'` (`:875`, `:909`) but are used inside `'…'` JS strings in handlers (e.g. `:3955`, `:2778`). CSP allows `'unsafe-inline'` and any `https:` script (`:10`). |
| 5 | **Serverless / AI endpoint abuse resistance** | 2 | `interpretar.js:5` sets `ACAO:*`. No auth anywhere in the handler. No rate limit. No byte cap on images (`:18-21`) or on `contexto` (`:16`), which is interpolated into the **system prompt** (`:28-37`). `max_tokens: 8000` (`:85`). Upstream and exception messages are reflected (`:95`, `:103`). The browser call sends no credential (`index.html:7965`). |
| 6 | **Secrets management** | 7 | `ANTHROPIC_API_KEY` is server-side only (`interpretar.js:9`). No `localStorage`/`sessionStorage` use (0 matches). The Firebase `apiKey` is public by design. Minor: `firebase-config.js` is git-ignored (`.gitignore:2`), which is pointless because it is served publicly. The function source was deployed as a static file to Firebase Hosting (`.firebase/hosting..cache:4`). |
| 7 | **PII handling, backups & data at rest** | 3 | CUIT, emails, phones, addresses and all pricing/margins sit in one flat, any-user-readable store. `descargarBackup()` (`:4186-4206`) dumps everything to unencrypted JSON, can be called from the console by any user, and the app tells users to keep it "en una carpeta de Drive o un pendrive" (`:4204`). `restaurarBackup()` (`:4252-4272`) trusts any JSON with `_app:'GraficaPro'` (no integrity check, BLOB keys never sanitized). Customer emails/WhatsApp text (PII) are sent to Anthropic (`:7965` → `interpretar.js:81-92`) with no disclosure or redaction. Server-side Firestore backups/PITR are not evidenced **[verify]**. |
| 8 | **Audit trail, monitoring, headers & supply chain** | 2 | No audit log. Attribution fields such as `por:` are client-asserted (`:5877`, `:7244`). No server logs or alerting in the function. `netlify.toml` has no `[[headers]]` (no HSTS, no `frame-ancestors`/XFO, so clickjacking is possible). CDN assets have no SRI (`:20`). Firebase JS SDK pinned at 10.12.0 (mid-2024, `:183-185`). Version control abandoned: last local commit 2026-07-11, and `git` is not even installed on the current machine. |

**Overall: 2.5 / 10. Security risk level: CRITICAL.**

---

## 2. Authentication and authorization (detail)

### 2.1 Self-sign-up turns "authenticated" into "anyone" (CRITICAL)
- `index.html:439-443` (`crearUsuario`):
  ```js
  const secondApp=initializeApp(firebaseConfig,'secondary-'+Date.now());
  const auth2=getAuth2(secondApp);
  await createUser(auth2,email,pass);
  ```
  This is the public Identity Toolkit `accounts:signUp` call, made with the browser `apiKey`. It does not use admin privileges. For it to work, the project must allow **client sign-up**, which means anyone can call the same endpoint with `firebase-config.js:2` and receive an ID token.
- `firestore.rules:22-24`:
  ```
  allow read, write: if request.auth != null
    // && request.auth.token.email.matches('.*@coma-grupoimpresor[.]com[.]ar$')
    ;
  ```
  A self-registered stranger therefore has **full read/write/delete on every collection**: `clientes`, `fichas`, `gastos`, `cotConfig`, `analCostos`, and so on.
- Uncommenting the domain line would **not** fix this. Without `request.auth.token.email_verified == true`, an attacker can sign up as `whatever@coma-grupoimpresor.com.ar` without owning the mailbox. It could also lock out the real users: `ADMIN_EMAIL='esteban@graficapro.com'` (`index.html:429`) suggests the accounts may not be on that domain **[verify]**.
- **[verify]** Firebase Console → Authentication → Settings → User actions → "Enable create (sign-up)". If it is ON, this is a live, unauthenticated full-database compromise.

### 2.2 Roles are cosmetic (unchanged)
- `index.html:688-689`: `puedeVerFinanzas()` = `/gerencia|admin|contab|direccion|esteban|juanpablo/.test(localPart)`. A self-registered `admin@x.com` gets the finance UI. Every user can read finance data anyway through `S.gastos`, `S.cotConfig` or Firestore.
- `index.html:692-695` hides `.fin-only` with CSS. `:4112-4117` blocks navigation with `alert()`. `:4124` exposes `rBalMes`, `rCostos` and the other renderers globally.
- `index.html:4275` `wipeDatos('CONFIRMAR-BORRAR-TODO')` is reachable from the console by **any** logged-in user, because the rules allow deletes.

### 2.3 Session handling
- LOCAL persistence by default (`:386` pre-checked, `:409`). No inactivity logout. No token revocation path.
- `doLogout()` (`:419-426`) clears only the COL arrays. BLOB keys (`cotConfig`, `analCostos`, `stockPapel`, etc.) stay in memory until reload.
- Login error and Firebase-init error messages are injected raw into `innerHTML` (`:342`, `:375`, `:414`), and `user.email` is rendered raw (`:351`). Low severity, but these are sinks.

---

## 3. Firestore rules (now visible)

| Check | Result |
|---|---|
| Rules file in repo | Yes, `firestore.rules`, and wired via `firebase.json:20-22` |
| Default deny outside `/gp` | Yes (`:28-30`). This also makes the legacy `graficapro/*` migration reads fail (`index.html:463`, `:661`), which is harmless. |
| Requires auth | Yes (`:22`) |
| Restricts *who* is authenticated (allowlist / claims / verified domain) | **No** |
| Per-collection role checks (finance) | **No** |
| Schema / type / size validation | **No.** Any document shape, including HTML payloads, is accepted. |
| Delete protection | **No.** Any user can delete any document; `sv()` also silently deletes docs that are missing from the local array (`index.html:231-235`). |
| Deployed state | Probably deployed (a `firebase deploy` occurred on 2026-10-01 per `.firebase/hosting..cache`) **[verify]** |

---

## 4. XSS (detail)

**Model:** strip `<>` on save for a hard-coded whitelist (`_SAN_FIELDS`, `index.html:284-293`, applied in `sk()` `:306-307`), plus *optional* escaping at render (`escHtml` `:875`, `_descHtml` `:877`, `cotEsc` `:909`). Fields missing from the whitelist are stored and rendered raw. Whole BLOB configs (`maquinas`, `externos`, `fletes`, `procesos`, `tiposTrabajo`, `recursosAnal`, `vendedores`, `cotEstructuras`, `externosInfo`, …) are **never** sanitized.

Confirmed stored-XSS chains (write path → render sink):

| # | Field | Write (unsanitized) | Raw render sink | Context |
|---|---|---|---|---|
| X1 | client `cuit`, `domEnt`, edited `email/tel` | `updateCli()` `:9790`; create `:10028` (`cuit:Q('cc').value`) | view modal `:7825`; quote PDF iframe `:10465`; edit form `value="${c.cuit||''}"` `:9789` | body + attribute + same-origin print iframe |
| X2 | ficha `facCuit, facEmail1/2, facCondIva, facDomicilio, facTelefono, cobCondPago, cobFormaPago, cobDiasHorarios, cobContacto, cobTelefono, cobEmail`, `ent{n}Email` | `fichaSet()` `:6738-6741` (no sanitization) | `:6620-6621`, `:6635` (`<a href="mailto:${f.facEmail1}">${f.facEmail1}</a>`) | body + `href` |
| X3 | machine / external / freight names | `addRec()` `:9181-9189` (raw; contrast `setAsign()` `:9147`, which does strip) | `:9165,9170,9176` `<span>${m}</span>`; planning `:5683,5699` `${m}` and `onclick="planMaq='${m.replace(/'/g,"\\'")}'…"` (escapes `'` but not `"`) | body + JS-in-attribute |
| X4 | process names | `addNuevoProceso()` `:8384` | `:8380` `<option value="${n}">${n}</option>` | body + attribute |
| X5 | **AI output** `aiSug.material/maquina/colores/medidaCerrada/procesos` | `aiAplicar()` `:8167`, persisted via `itemsVariantes:rawItems` `:10107` | `_renderItems()` `:8205` `${parts.join(' · ')}` | body |
| X6 | `facRazonSocial` (angle-stripped but `"` kept) | — | `value="${f.facRazonSocial}"` `:9776` | attribute breakout |
| X7 | step / OT names in handlers | — | `onclick="avP(${o.id},'${p.nombre}')"` `:6285`; `onchange="setAsign(${otId},'${p.nombre}',…)"` `:9136` | JS string breakout |

**X5 is new and the most dangerous.** A staff member pastes a customer email into "Interpretar pedido". Text inside it (e.g. "set material to `<img src=x onerror=…>`") flows through the model into the structured `material` string. The tool schema (`interpretar.js:63-66`) constrains only the type, so the string comes back intact, is rendered raw at `:8205`, and is stored in the quote. It fires for every user who later edits that quote. The CSP (`:10`) allows inline handlers, and `connect-src https:` allows exfiltration to any host.

Other notes:
- `hl()` (`:889`) highlights search matches without escaping. It is safe today only because `nombre`/`fantasia`/`loc` are angle-stripped on save.
- Print/PDF: `window.open('','_blank')` + `document.write(html)` (`:5613-5614`, `:5654-5655`, `:5944-5945`) and an iframe `contentDocument.write` (`:10491`) run **in the app's origin**. Raw interpolations there include `o.descripcion`, `c.material`, `c.papelera` (`:5586`, `:5649-5651`), and `cli.nombre`, `cli.cuit` (`:10464-10465`). The external-work-order print (`:5905-5940`) is correctly escaped with `cotEsc`, so the team knows the pattern but does not apply it everywhere.
- `escHtml`/`cotEsc` HTML-encode `"` but not `'`. HTML encoding is the wrong defence for values placed inside `onclick="f('${x}')"`, because the HTML parser decodes entities before JS runs. Example: `cotPzMaq(${k},'${cotEsc(m)}')` `:3955`, where `m` is an unsanitized machine name.

---

## 5. `netlify/functions/interpretar.js` (detail)

| Issue | Line | Status vs 09-16 |
|---|---|---|
| `Access-Control-Allow-Origin: '*'` (the app calls same-origin `/.netlify/functions/interpretar`, `index.html:7965`, so CORS is not even needed) | `:5` | Unchanged |
| No authentication (no Firebase ID-token verification, no origin check, no shared secret) | whole handler | Unchanged |
| No rate limiting / quota / per-user budget | — | Unchanged |
| No body-size check before `JSON.parse` | `:14` | Unchanged |
| Images: count capped at 4, **no byte cap**, media type checked but data not validated | `:18-21` | Unchanged |
| `contexto` (`tiposTrabajo`, `maquinas`, `maquinasExtra`, `materiales`, `laminados`, `procesos`, `estructuras`) is **unbounded** and string-interpolated into the **system prompt** | `:16`, `:28-37` | New finding. A caller controls system-prompt text and can inflate input tokens far beyond the 8,000-char `pedido` cap (`:15`). |
| `max_tokens: 8000`, model defaults to `claude-sonnet-5` | `:85`, `:11` | Unchanged |
| Upstream error message and `e.message` reflected | `:95`, `:103` | Unchanged |
| Output not sanitized before returning; feeds the X5 XSS sink | `:99-101` | New impact |
| Key handling via `process.env` | `:9` | Good, unchanged |

**Denial of wallet:** anyone who knows the Netlify URL (it is in the public bundle) can script unlimited calls, each with up to 4 large images plus an arbitrarily large `contexto` and 8k output tokens, billed to the company's Anthropic key. The only practical ceilings are Netlify's request-body limit and the Anthropic account's spend limit **[verify that one is set]**.

**PII / data-transfer:** customer emails and WhatsApp messages (names, phones, addresses) go to a US processor. Nothing tells the user this, and there is no redaction. That is relevant under Argentina's Ley 25.326 (international transfers).

---

## 6. Deployment, headers and supply chain

- **Netlify publishes the whole folder**: `netlify.toml:4` `publish = "."`, with no ignore list. If the site is deployed from this folder or from a repo that contains `audit/`, then **this report, the rest of `audit/`, `tests/`, `firestore.rules` and `PENDIENTES.md` are publicly downloadable** from `graficapro-coma.netlify.app` **[verify by checking the deploy file list in Netlify, not by probing]**. `firebase.json:4-18` correctly ignores these for Firebase Hosting, but not `GraficaPro_backup_*.json`. A backup saved into this Drive folder would ship on the next `firebase deploy`, and on every Netlify deploy.
- Firebase Hosting (`graficapro-coma.web.app`) is still live. It redirects in JavaScript (`index.html:6-7`), but it also serves `netlify.toml` and `netlify/functions/interpretar.js` as static files (`.firebase/hosting..cache:3-4`).
- CSP is a `<meta>` tag (`index.html:10`): `script-src 'self' 'unsafe-inline' https:`, `connect-src 'self' https: wss:`. It blocks `<object>` and `<base>` hijacking and little else. A `<meta>` tag cannot set `frame-ancestors`, and there are no HTTP headers, so clickjacking is possible. `referrer no-referrer` (`:11`) is a positive.
- No SRI on `cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0` (`:20`). Pinned version, so the risk is low. Firebase SDK is loaded by dynamic `import()` from `gstatic` at **10.12.0** (`:183-185`, `:408`, `:439-440`). SRI is not possible with that loading method, and the version is about two years old.
- Source of truth: the project lives in Google Drive. `.git` has not been committed since 2026-07-11, and `git` is not on this machine's PATH. The remote is `github.com/graficapro-coma/GRAFICA-PRO`, visibility unknown **[verify it is private]**. Three months of security-relevant changes are unversioned and unreviewable.

---

## 7. Top risks that BLOCK approval (ranked)

1. **Open self-sign-up + `auth != null` rules = unauthenticated full read/write/delete of all PII and financials** (CRITICAL). `index.html:439-443`, `firestore.rules:22-24`, `firebase-config.js:2`.
2. **Stored XSS in body context across several PII and config fields, including an AI-fed path from external customer emails** (HIGH). Any insider, self-registered stranger (via direct Firestore writes) or malicious customer email can run script in the gerencia session. `:6620-6621/:6738`, `:7825/:9790/:10028/:10465`, `:9165-9189`, `:8205/:10107`.
3. **Unauthenticated, unthrottled, CORS-`*` Anthropic proxy with unbounded `contexto` and image payloads: denial of wallet** (HIGH). `interpretar.js:5,14-21,28-37,85`.
4. **No server-side authorization: finance/admin separation is CSS + regex on email** (HIGH). `index.html:688-695`, `:4112-4117`, `:431`, `:189-198`.
5. **Any user can mass-delete; no server backups evidenced, no audit log** (HIGH). Rules allow delete, `wipeDatos` `:4275`, silent deletes in `sv()` `:231-235`; SEGURIDAD-PENDIENTE item 3 is still open **[verify]**.
6. **Possible public exposure of internal docs and backups through `publish = "."`** (MEDIUM, could be HIGH). `netlify.toml:4`, `firebase.json` ignore list missing `GraficaPro_backup_*.json`.

---

## 8. Quick wins (hours to days)

1. **Disable client sign-up** in Firebase Auth (User actions → uncheck "Enable create"). Create users from the Console, or from a tiny Admin-SDK function. Then restrict the rules to an explicit allowlist:
   `allow read, write: if request.auth != null && request.auth.token.email_verified == true && request.auth.uid in get(/databases/$(database)/documents/gp/_acl).data.uids;`
   or, better, a custom claim: `request.auth.token.gp == true`.
2. **Lock `interpretar.js`**: require `Authorization: Bearer <Firebase ID token>`, verify it with the Firebase Admin SDK, drop `ACAO:*` (same-origin needs no CORS), cap the raw body (e.g. 3 MB), cap each image (e.g. 1.5 MB base64) and each `contexto` array/string, lower `max_tokens` to about 4000, add a per-UID daily counter, set a monthly spend limit in the Anthropic console, and return generic error messages (`:95,103`).
3. **Escape at render for the known sinks**: wrap with `escHtml` at `:6617` (`ev` fallback), `:6620-6621`, `:6635`, `:7825`, `:7827`, `:8205`, `:8380`, `:9165/9170/9176`, `:5683/5699`, `:5586/5649-5651`, `:10464-10466`, `:9776`, `:9789`. Add `'`→`&#39;` to `escHtml`/`cotEsc` and stop interpolating strings into inline handlers (pass an index or `data-*` attribute instead).
4. **Harden headers in `netlify.toml`**: add `[[headers]]` with HSTS, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and a CSP with `script-src` limited to `'self' https://www.gstatic.com 'unsafe-inline'` and `connect-src` limited to `*.googleapis.com`, `wss://*.firebaseio.com` and `'self'`.
5. **Stop publishing the repo root**: move the app into `public/` (or add a Netlify ignore/redirect for `/audit/*`, `/tests/*`, `*.md`, `firestore.rules`, `GraficaPro_backup_*`). Add `GraficaPro_backup_*.json` to `firebase.json` ignore.
6. Enable **Firestore PITR / scheduled exports**, and add a delete guard in the rules (e.g. `allow delete: if false` on collections, plus soft-delete).
7. Default "Recordar mi sesión" to **unchecked** (`:386`), add a 30–60 min idle sign-out, and replace the `prompt()` password collection (`:435`) with a form that enforces at least 12 characters.

## 9. Deeper issues requiring refactoring

- **Real authorization model:** Firebase custom claims (`role: gerencia|ventas|produccion`) set by an Admin-SDK function, mirrored in the rules per collection (`gastos`, `cotConfig`, `analCostos`, cost fields read-only for finance). Finance data then has to move out of the shared `_config` blob into separately-ruled documents, because rules cannot hide individual fields of a document a user can read.
- **Server-side write validation:** rules with schema/type/length checks per collection, or a write proxy. Today any authenticated client can write any shape, including HTML payloads, into any document.
- **Rendering layer:** 79 `innerHTML` and 462 inline handlers in one 1 MB file cannot be made safe sink by sink. Move to a framework with auto-escaping or `textContent`/DOM builders with delegated listeners. Then remove `'unsafe-inline'` from the CSP.
- **Treat LLM output as untrusted input:** validate it against enums and length limits, and escape it before rendering.
- **Append-only audit log** (Cloud Function trigger on writes to `/gp/**` that records uid, time and diff), plus alerting on mass deletes.
- **Encrypted, access-controlled backups** handled server-side, instead of unencrypted JSON on Drive or a pendrive. Restore should go through a validated, admin-only server path.
- **Multi-tenancy:** if the product is meant for other shops, introduce `/tenants/{tid}/…` with tenant-scoped claims. Today it is hard-wired to one `gp` root.
- **Engineering hygiene:** resume git (commit per change, private repo, PR review), add security tests for the rules (Firebase emulator + `@firebase/rules-unit-testing`) and for escaping. Today `tests/pruebas.js:24-28` tests only `sanTxt`.

---

## 10. Changes vs 2026-09-16 audit

| Area | 2026-09-16 | 2026-10-02 | Verdict |
|---|---|---|---|
| Firestore rules | "Not provided, unverifiable" | `firestore.rules` present (dated 07-11, so the previous audit missed it) and wired in `firebase.json:20-22`; probably deployed. Content is `auth != null` only, domain line commented out. | **Visibility improved; actual protection is weak.** Combined with the self-sign-up inference, it is worse than the provisional assumption. |
| Self-sign-up | "Possibly enabled (unverifiable)" | Inferred **enabled**, because the app's own `crearUsuario()` depends on it (`:439-443`) | **Worse (confirmed by inference)** |
| Role model | Client-side regex | Identical (`:688-695`, `:4112-4117`); line numbers shifted from `:670-676` | Unchanged |
| `interpretar.js` | CORS `*`, no auth, no RL, no image byte cap, error leakage | All still present (`:5`, `:18-21`, `:95`, `:103`). New: unbounded `contexto` interpolated into the system prompt (`:16`, `:28-37`); output now reaches a raw sink (X5) | **Unchanged / worse** |
| XSS surface | 74 `innerHTML`, 328 `onclick` | 79 `innerHTML`, 462 `onclick`; file grew from about 8.5k to 10.6k lines | **Worse** |
| Ficha attribute sinks (`facEmail1`, `facCuit`, …) | Reported at `:4879-4880` | Same code at `:6620-6621`; still unsanitized via `fichaSet()` `:6738-6741`. Reclassified: **body-context** stored XSS (no `<>` stripping at all), not just attribute | **Unchanged (worse than stated)** |
| New sinks | — | X1 (client `cuit` in view modal and quote PDF), X3 (resource names via `addRec`), X4 (process names), X5 (AI output) | **New** |
| Raw `\n→<br>` sinks | `:4782, :4815, :4880` | Still raw at `:6523`, `:6556`, `:6621` (protected only by the save-side whitelist) | Unchanged |
| CSP | "No CSP" | `<meta>` CSP at `:10`, which SEGURIDAD-PENDIENTE (July) says already existed, so the previous audit overlooked it. Permissive (`'unsafe-inline'`, `https:`) | Unchanged in practice |
| HTTP security headers | None | None (`netlify.toml` has no `[[headers]]`) | Unchanged |
| Backups | Unencrypted JSON, restore without integrity check | Same (`:4186-4206`, `:4252-4272`); now also a weekly reminder nudging users to store it on Drive/pendrive (`:4204`, `:4228-4249`) | Unchanged; more copies of PII in circulation |
| `prompt()` passwords | `:418-419` | `:434-435` | Unchanged |
| Audit log | None | None (client-asserted `por:` only, `:5877`, `:7244`) | Unchanged |
| Legacy Firebase Hosting | — | JS redirect to Netlify (`:6-7`); hosting still serves function source (`hosting..cache`) | Minor improvement / minor new disclosure |
| Deployment exposure | — | Netlify `publish="."` may expose `audit/`, `tests/`, rules, backups | **New finding** |
| Version control | (SEGURIDAD-PENDIENTE item 4) | Last commit 2026-07-11; git not installed on current machine | **Worse (drift)** |
| SEGURIDAD-PENDIENTE items | 1 rules, 2 apiKey restriction, 3 backups, 4 git | 1: done but weak; 2, 3: **[verify]**, no evidence; 4: abandoned | Mostly open |

**Net:** the score moves from 3.5 to **2.5**. The largest unknown from last time, the rules, is now known and inadequate. None of the three blocking items from 2026-09-16 was remediated, and the attack surface grew.

---

## Appendix — quantified findings (2026-10-02)

- `index.html`: 10,571 lines; `innerHTML` 79; `onclick=` 462; `document.write` 3 (+1 iframe `contentDocument.write`); `escHtml(` 37 uses; `cotEsc(` 144; `_descHtml(` 7; `sanTxt(` 15; `localStorage`/`sessionStorage` 0; `eval`/`new Function` 0; `integrity=` 0.
- `_SAN_FIELDS` (`:284-293`) omits: `clientes.cuit/domEnt/prov`, all `fichas.fac*`/`cob*`/`ent*Email`/`ent*Tel`, all BLOB_KEYS (`:205`).
- `escHtml`/`cotEsc` do not encode `'` (`:875`, `:909`).
- Firestore rules: 1 effective allow (`auth != null`) on `/gp/**`; 0 role checks; 0 validation; 0 delete restrictions.
- Serverless: CORS `*` (`:5`), auth 0, rate limit 0, image byte cap 0, `contexto` cap 0, `max_tokens` 8000 (`:85`), error reflection 2 (`:95`, `:103`).
