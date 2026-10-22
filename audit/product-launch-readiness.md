# Product / Business-Risk / Launch-Readiness Audit — Gráfica Pro

**Date:** 2026-10-02 (re-audit; previous: 2026-09-16)
**Lens:** A skeptical buyer, investor or acquirer who wants reasons **not** to approve. Every finding is backed by evidence: file, line, function and quote.
**Scope:** Product-market fit, multi-tenancy, feature completeness, data ownership, backup and DR, lock-in and cost, compliance, bus factor, docs, release process, IP, monetization, and readiness to replace the shop's Excel production plan.
**Code examined (read-only):** `index.html` (10,381 lines, 1,019,072 bytes, 662 top-level functions), `netlify/functions/interpretar.js`, `firestore.rules`, `firebase.json`, `.firebaserc`, `.firebase/hosting..cache`, `netlify.toml`, `firebase-config.js`, `.gitignore`, `.git/`, `tests/pruebas.js`, `PENDIENTES.md`, `audit/*`.

---

## Overall score: 3.3 / 10

| Question | Verdict |
|---|---|
| **(a) Acquisition / resellable product** | **NO-GO (2.5/10).** This is one company's bespoke tool and not a product. Reselling it would mean a rewrite. Ownership of the asset is also unclear: authorship is AI-assisted, there is no LICENSE file, and no version history exists. |
| **(b) COMA's internal production system** | **CONDITIONAL GO (5.5/10).** Keep using it for quoting, OTs, paper and tracking. **Do not move the production plan off Excel yet.** The planning data has known paths to lost updates and silent overwrites (see Risk #3 and #4). Close those first, along with the 6 quick wins. |

The engineering behind the domain logic has improved a lot since 2026-09-16: backup is complete, the number counter now uses a transaction, and the AI quote costing is now implemented. **The business-risk layer around that logic has not improved, and part of it has got worse.** Version control was abandoned, two hosts are now live, the AI endpoint is still open, and Firestore rules are still unchanged and unverified.

---

## 1. Rubric

| # | Criterion | Score | One-line basis |
|---|---|:---:|---|
| 1 | Product-market fit beyond COMA / multi-tenancy | **2** | COMA identity, machines, vendors, staff, shift hours and price list are code literals. There is one data tree and no tenant boundary. |
| 2 | Feature completeness vs. print-shop ERP market | **5** | Production depth is excellent. There is no invoicing, no AFIP/ARCA, no accounts receivable, no collections and no purchase orders beyond paper. |
| 3 | Readiness to replace Excel (internal) | **5** | All the modules exist. The planning store is a single blob with no live sync and no import path, and it has a 1 MiB ceiling. |
| 4 | Data ownership, backup and disaster recovery | **4** | Backup is now complete and restore no longer destroys data (improved). Backups are still manual-only, and a slow login can overwrite data. |
| 5 | Security, compliance (Ley 25.326, tax) and IP/licensing | **3** | Rules and AI endpoint are unchanged. The cost price list is shipped in a public file. There is no privacy, terms or license document. |
| 6 | Vendor lock-in and operating cost | **4** | Firebase lock-in and Netlify deploy credits are known costs. Anthropic spend can be driven by anyone on the internet. |
| 7 | Bus factor, documentation and support | **2** | One author. Git was abandoned after one commit. The roadmap doc is stale. There is no manual or runbook. |
| 8 | Testing, release and change management | **2** | Manual upload to two hosts. The local copy differs from production. The tests exercise a copy of the code and have not been touched since July. |

**Weighted overall: 3.3 / 10.** Weights: 1, 4, 5 and 8 at 1.5x; the rest at 1x. Separate composites: acquisition ≈ 2.5, internal ≈ 5.5.

---

### Criterion 1 — Product-market fit beyond one customer / multi-tenancy: 2/10

The codebase is single-tenant at every layer:

- **Data tree.** All data lives under one path, `/gp/**` (`firestore.rules:19`, `index.html:211` `window._fsCol(db,'gp',k,'docs')`, `:215` `_fsDoc(db,'gp','_config')`). There is no `tenantId` anywhere. The project is hardcoded in `firebase-config.js:5` (`projectId: "graficapro-coma"`) and `.firebaserc:3`.
- **Branding.** A base64 COMA logo is embedded 3 times (`index.html:81` sidebar, `:147` `window._appLogo`, `:10457` quote print). The text fallback `'COMA'` appears at `:5643` and `:5927`. The quote title is `` `Cotización ${c.num} - COMA` `` (`:10421`). The external-work slip has `Entregó (COMA)` and `Recibió en COMA` (`:5941-5942`). The insumos order text is `'PEDIDO DE INSUMOS — COMA Grupo Impresor'` (`:1818`). The AI system prompt says `"una imprenta argentina (COMA Grupo Impresor)"` (`interpretar.js:24`).
- **People in code.** `VENDEDOR_MAP` and `COT_PREFIX_MAP` map `'esteban-gerencia'` and `'juanpablo-gerencia'` (`index.html:678-683`). `puedeVerFinanzas()` matches `/gerencia|admin|contab|direccion|esteban|juanpablo/` (`:689`). `crearUsuario()` only allows `'esteban-gerencia'` (`:431`). `ADMIN_EMAIL='esteban@graficapro.com'` is dead code (`:429`). Vendor initials `['EEC','JPM','FG','CC','AM','JPI','CA','HM']` are hardcoded (`:326`). Freight drivers `['Coma','Edu','Walter','Torreflet']` (`:6824`) and `'Master / Javier','Fiorino / Edu'` (`:322`) are hardcoded too, as are the external die-cutters `'Marcelo (Troquelado)','Víctor (Troquelado)','Oscar (Troquelado)'` (`:321`).
- **Machine park.** `COT_MAQ_BASE=['SM52','SM74','Xerox']` (`:2467`). There are 106 `SM52|SM74|Xerox` references. Plate codes are hardwired: `p.chapasCod=p.maquina==='SM52'?2:(p.maquina==='SM74'?3:...)` (`:8104`). Digital machines are detected by regex `/xerox|digital/i` (`:1010`, `:2415`, `:4542`). The AI prompt hardcodes the machine-selection policy `"tiradas chicas o urgentes = Xerox ... SM74 ... SM52"` (`interpretar.js:29`).
- **Cost resources and vendors by name.** `findProv('COMA - IMPRESION')`, `'COMA - CHAPAS'`, `'COMA - GUILLOTINA'`, `'COMA - STOCK'`, `'COMA - FLETE'` (`:7686-7690`). `'CTP Coma'`, `'Guillotina Coma'`, `'Stock Coma'` appear in `_ceAuto()` (`:9849`) and at `:6820-6834` and `:10000-10003`. `recursosAnal` defaults to `'Troquelado Coma','Pegado Coma','Doblado Coma'` (`:325`, `:565`).
- **Shop calendar.** Planning slots are fixed at `SLOTS_AM=['06:30',...'13:00']` and `SLOTS_PM=['13:30',...'17:30']`, with lunch hardcoded at `13:00` (`:6131-6133`, `:6190`).
- **Commercial terms.** IVA is a literal 21% in at least 8 places (`:3061`, `:8410`, `:8521`, `:9832`, `:10064`, `:10096`). Quote boilerplate is fixed: `"Condiciones de pago: con e-cheq a 30 días ... Cláusula dólar ... BNA"` (`:7670`, `:7675`).
- **Price list.** COMA's own cost sheet is compiled in: `COT_SEED` (`:906`), `COT_PAPEL_CAT_SEED` (`:925-932`), `XEROX_OFICIAL` (`:3743-3750`, `"planilla oficial COMA, dólar 1560,45"`) and `INSUMOS_SEED` with 47 consumables and their last unit costs (`:1578-1597`).

**Positive:** external printers such as DELIGRAF are now user-configurable machines stored in `cotConfig.maqExtra` (`:2468-2506`, `aiCostearOptimo` `:8108`). That is the first data-driven piece of the fleet.

**Verdict:** Onboarding a second print shop would require new branding, roles, fleet, calendar, resources and a new data model, which amounts to a rewrite. Resale value of the code as it stands is close to zero. The know-how it encodes is valuable, but that know-how sits in the owner, not in a transferable asset.

### Criterion 2 — Feature completeness vs. print-shop ERP market: 5/10

**Strong, and comparable to vertical MIS tools (Printvis, Tharstern, EFI Pace and local Argentine MIS products):**
- Quote and costing engine: paper catalog by family, grammage and finish, buy-format and cut optimization (`_catCortes` `:953`, `cotPapelSelResolver`), multi-machine cheapest-option search (`aiCostearOptimo` `:8108`), per-quantity variants (`aprobarCotConItemsSeleccionados` `:8510`), USD/ARS with BNA fetch (`:1201`, `:7655`).
- AI order interpretation from text or images. The AI now also fills the costing (`aiInterpretar` `:7948`, `aiMatchPapel` `:7973`, `_aiAplicarMaq`, `aiCostearOptimo`). This is a real differentiator.
- Production flow: OT (`rOT` `:4489`), ficha (`rFicha` `:6420`), 9-stage board (`rSeg` `:4648`), paper orders with kg calculation and stock reservation (`rPapel` `:5488`, `:5168-5276`), guillotine (`mCorte` `:5348`, `corteRegistrar` `:5374`), 30-minute planning (`rPlan` `:5657`, `rCalSemanal` `:6162`, `rTallerDiario` `:6356`), external work (`rEnviosExt` `:5755`), deliveries and freight (`rEntregas` `:5960`), consumables stock (`rInsumos` `:1827`), per-OT cost analysis (`rAnalOT` `:6995`), times (`rTiempos` `:7308`) and capacity (`rCapacidad` `:7407`).

**Missing versus what any Argentine buyer would require from an "ERP":**
- **No invoicing and no AFIP/ARCA e-invoicing.** A grep for `AFIP|ARCA|CAE|wsfe|factura electr` returns 0 hits. `S.facturas` and `S.cobranzas` exist only as vestigial arrays (`:318`). They are **not in `COL_KEYS` or `BLOB_KEYS`** (`:203-205`), so they are never persisted. `wipeDatos` resets them (`:4287`) and `_nidMaxVisible` references them (`:721`), but nothing uses them.
- **No accounts receivable, customer balances, collections, ageing or credit limits.** The `saldo:0` field in `seed()` (`:790`) is never maintained.
- **No purchase orders and no supplier payables.** Purchasing is limited to paper and consumables reorder sheets (`printPapelPedido` `:5571`, `:1818`).
- **Remitos are internal only.** `rRem` (`:6909`) is titled "Remitos internos": there is no CAI or COT (ARBA transport code), so it is not a fiscal delivery note.
- **Financial reports are wrong for decision-making.** `rBalMes` (`:7503-7508`) books revenue as `c.total` of **approved quotes by quote date**. `c.total` includes 21% IVA (`:8521` `c.total=sub+c.iva`, `:10107` `total:sub+iva`), while costs are ex-VAT. The result is that monthly revenue is overstated by about 21% and margins are inflated. Revenue is also recognized on quote date, not on delivery or invoice.
- **No CRM.** There are no contacts history, leads, follow-ups, quote win/loss reasons or email integration.
- **No data export.** There is no CSV or Excel export anywhere (grep `csv|xlsx|exportar` returns 0 hits). The only export is a full JSON dump.

### Criterion 3 — Readiness to replace Excel (internal): 5/10

Every module the shop needs already exists. The blockers are data-integrity mechanics, not missing screens:

1. **Planning is a single blob with no live sync.** `planificacion`, `stockPapel`, `stockMovs`, `insumosItems`, `insumosMovs` and others are `BLOB_KEYS` (`:205`), all stored as fields of the **one document `gp/_config`** (`ld` `:215`, `sv` `:258-263`). The realtime listener only covers `['clientes','proveedores','cotizaciones','ordenes','fichas','gastos']` (`activarSincronizacion` `:503`). It is the only `_fsOnSnapshot(` call in the file (`:506`). Consequences:
   - Two people editing the plan see stale copies. `sv` then writes the **whole field**: `_fsUpdate(ref,{[k]:cleanV})` (`:263`). Last writer wins, and the other person's moves are silently erased. Excel at least shows the conflict.
   - The same applies to paper stock: `stockMov` (`:5333-5340`) followed by `sk('stockPapel')`.
2. **Hard size ceiling.** A Firestore document is capped at 1 MiB, and that cap applies to **all** config, catalogs, the plan and two ever-growing movement logs (`stockMovs`, `insumosMovs`) combined. There is no pruning or archiving of `planificacion` (grep found nothing). Once Excel's history moves in, the document will eventually reject writes. Every save then fails, and the "Error al guardar" chip (`showSaveError` `:169`) is the only signal.
3. **A slow login can wipe data.** `cargarDatos` (`:452-453`) races each `ld(k)` against an 8-second timeout, and `ld` returns `null` on any error (`:218`). On `null`, `S[k]` keeps the **hardcoded default** (`:317-333`, e.g. `planificacion:{}`, `stockPapel:[]`). The user's next edit to that key then persists default-plus-edit over the real data. On a slow shop Wi-Fi this is a realistic way to lose the entire production plan. `ld` also re-reads the whole `_config` document once per blob key (23 reads at login).
4. **No import path from Excel.** The only "Excel" imports are hardcoded seeds (`costosSeed` `:1057`, `insSeed`, button text "Cargar mis insumos (Excel)" `:1833`). There is no way to bring in open OTs or the current plan. Cut-over would be manual re-keying.
5. **No offline mode.** There is no `persistentLocalCache` and no service worker (grep 0). Excel works offline; the app dies with the connection (`init` `:340-341`).
6. **Fixed calendar.** There are no Saturday shifts, overtime or per-machine hours (`:6131-6133`).

**What it takes to stop using Excel:** move `planificacion` and the movement logs into per-document subcollections (one document per day×machine or per movement), with `onSnapshot` and transactional or field-level writes. Never overwrite a blob loaded with `null`. Add a one-time importer for open OTs and the plan. Run 2–4 weeks in parallel and reconcile weekly. Plus the quick wins below.

### Criterion 4 — Data ownership, backup and disaster recovery: 4/10 (was 3)

- **Improved:** `descargarBackup()` (`:4186-4206`) now builds the dump dynamically from `[...COL_KEYS,...BLOB_KEYS]` (`:4191`), so the pricing catalog is no longer omitted. `restaurarBackup()` (`:4252-4272`) only touches keys present in the file (`:4264`) and is console-only. `wipeDatos()` now requires the literal `'CONFIRMAR-BORRAR-TODO'` and has no UI button (`:4273-4278`).
- **Still a gap:**
  - The backup is a **manual browser download** that relies on a Friday reminder (`chequearRecordatorioBackup` `:4228`). Only finance roles see it (`:4229`), and they can dismiss it with "Ahora no" (`:4247`).
  - There is no scheduled server-side export. `audit/SEGURIDAD-PENDIENTE.md` §3 still states "Hoy no hay copia de seguridad", and nothing in the repo shows it was enabled.
  - `gp/_counters` (`_reservarNumero` `:739`) is not in the backup. A restore therefore recovers from the max visible number, which is acceptable, but this is undocumented.
  - Restore to collections uses `sv`, which **deletes any document not in the file** (`:231-234`). Restoring an older backup erases newer OTs. That is intended "replace" semantics, but it is never explained beyond two `confirm()` dialogs.
  - There is no tested DR runbook and no RPO/RTO definition.
- **Portability:** JSON-only export, with no CSV or Excel. Data is owned by whoever controls the Google account that owns `graficapro-coma`. The repo does not record that account, and the git commit author is `info@agflorida.com.ar` (`.git/logs/HEAD`), which is a different domain from the business. **Ownership of the Firebase and Netlify accounts must be confirmed before any transaction.**

### Criterion 5 — Security, compliance and IP/licensing: 3/10

- **Firestore rules are unchanged since 2026-07-11** (file timestamp). `allow read, write: if request.auth != null` and the domain filter is still commented out (`firestore.rules:22-24`). The client imports `createUserWithEmailAndPassword` (`index.html:185`). If Email/Password sign-up is enabled in the console, any internet user with the public apiKey (`firebase-config.js:2`) can self-register through the Auth REST API and get full read/write access to every client, CUIT, price and margin. Deployment of the rules is still not evidenced. `.firebase/hosting..cache` shows only **hosting** deploys.
- **Authorization is still cosmetic.** Finance pages are hidden with CSS and an `alert()` in `nav()` (`:4112-4116`, `aplicarVisibilidadRol` `:692-695`). Meanwhile `cargarDatos` loads `gastos`, `analCostos` and all cost tables into **every** user's browser (`:451-453`).
- **Commercially sensitive data is shipped publicly.** `index.html` is a static file, and fetching it requires no login. It embeds COMA's paper cost per kg (`:925-932`), Xerox click costs (`:3744-3750`), the full `COT_SEED` cost tables (`:906`), the default 20% margin (`:907`, `margenPct:20`) and 47 consumable unit costs (`:1578-1597`). A competitor can read your cost base with `view-source`. `firebase.json` also publishes `netlify/functions/interpretar.js` on Firebase Hosting (the hosting cache lists it), which exposes the AI prompt.
- **Ley 25.326 (Protección de Datos Personales):**
  - There is no privacy notice and no data-treatment policy.
  - There is no record of AAIP database registration. Client contacts include individuals' names, emails and phones, and `consumidor final` clients (`:790`) are natural persons.
  - Data sits in Google Cloud (Firestore region undocumented). AI requests send client emails, WhatsApp text and screenshots to Anthropic in the US (`interpretar.js:81-91`).
  - Both are **international transfers** that the law (art. 12) and AAIP guidance expect to be assessed and disclosed. None of this is documented.
  - There is **no audit trail**: who changed or deleted a record is not stored, apart from scattered `por:` fields (`:4898`, `:5877`, `:7244`).
- **Tax:** the app produces no fiscal documents, which is fine as long as billing stays in a separate AFIP-compliant system. The weak point is the IVA-inclusive "revenue" in `rBalMes` (`:7504`), which could mislead management or tax planning.
- **IP and licensing:**
  - There is no `LICENSE` file, no copyright header and no authorship statement.
  - The code is substantially AI-generated. Under Argentine Ley 11.723 and comparable regimes, copyright needs human authorship. The protectable portion of the code is therefore uncertain, and so is what a buyer would actually own.
  - Third-party code is permissive: Tabler Icons 2.44.0 (MIT, `:20`) and the Firebase JS SDK 10.12.0 (Apache-2.0, `:183-185`). Both load from CDNs with no SRI and no retained license notices.
  - The Anthropic model is `claude-sonnet-5` by default (`interpretar.js:11`). Anthropic's commercial terms govern use of the outputs, and no record exists of which terms were accepted.

### Criterion 6 — Vendor lock-in and operating cost: 4/10

- **Firebase (Auth and Firestore):** deep lock-in. Persistence goes through `window._fs*` wrappers (`:189-198`), so a port is feasible, but the data shape (`{v: item}` docs plus one config blob) is Firestore-specific. Cost is low today, but **reads scale with full-collection loads at every login** (`ld` `:211` with no `limit`, plus 23 reads of `_config`) and with `onSnapshot` re-delivery of whole collections (`:506-519`). As history grows, both login time and reads per login grow linearly. There is no archiving except `archivarOT` (`:4502`), which is UI-only.
- **Netlify:** static hosting plus one function (`netlify.toml`). Deploys consume plan credits, and there is no cost alerting in the repo.
- **Anthropic:**
  - **The endpoint is still public and unauthenticated:** `'Access-Control-Allow-Origin': '*'` (`interpretar.js:5`), no token check, no rate limit, `max_tokens: 8000` (`:85`), up to 4 images with **no byte cap** (`:19-21`). The client sends no ID token (`index.html:7965`).
  - The workload grew since September with images, tool use and a longer prompt, so each abusive call costs more.
  - Anyone can call it directly and bill the shop's key. A prompt-injected `contexto` is interpolated straight into the system prompt (`:28-37`, `JSON.stringify(ctx...)`).
- **Free CDNs and APIs without fallback:** jsDelivr (icons), gstatic (SDK) and `dolarapi.com` (FX, with a manual fallback). If gstatic is down, the app cannot start (`init` `:340`).
- **Monetization potential:** as a vertical SaaS for Argentine offset shops it would face established local MIS products and would have to add AFIP invoicing, accounts receivable, multi-tenancy, billing and support before charging. The most credible commercial path is to sell **the AI quote-interpretation and costing know-how** as a service or consultancy, not this codebase.

### Criterion 7 — Bus factor, documentation and support: 2/10 (was 3)

- **One author.** The work is done by the owner plus an AI assistant, and there is no second person who can change the code.
- **Version control was abandoned.**
  - `.git/logs/HEAD` still has exactly **one commit**, "Initial commit", dated 2026-07-11, and `FETCH_HEAD` was last written on 2026-07-17.
  - Git is **not installed** on this machine (`git` is not recognized).
  - Since then `index.html` has grown from about 8,600 lines to **10,381 lines**, and `interpretar.js` was rewritten (2026-10-01), all with no recorded history.
  - The only history is Google Drive file versions, which are retained for a limited time and number of revisions for non-Google files.
- **Docs are stale or absent.** `PENDIENTES.md` says "Última actualización: 9/7/2026" and still lists the AI as not configured and "Etapa 2" (AI costing) as pending (`:9-12`). The code shows Etapa 2 is implemented (`aiCostearOptimo` `:8108`).
- **Nothing for anyone but the author.** There is no architecture doc, no user manual, no runbook and no onboarding guide. The `audit/` folder is reviewer-written and excluded from hosting (`firebase.json` ignore `audit/**`).
- **Support:**
  - Errors surface as 83 `alert()` calls, and 46 `catch(e){}` blocks swallow failures silently.
  - There is no error tracking or monitoring (grep for `Sentry|onerror|unhandledrejection` found only an image `onerror`).
  - There is no SLA and no on-call arrangement.
  - Accessibility markup is absent (0 `aria-`/`role=` attributes), which limits any public product.

### Criterion 8 — Testing, release and change management: 2/10 (was 3)

- **Two production hosts, deployed by hand.**
  - The Firebase Hosting cache shows a deploy of `index.html` on 2026-10-01 14:44 (`.firebase/hosting..cache`, timestamp `1790876666639`).
  - Netlify is also live (`index.html:6-7` redirects `graficapro-coma.web.app` to `graficapro-coma.netlify.app`). The redirect does **not** cover `graficapro-coma.firebaseapp.com`, where the AI call (`/.netlify/functions/interpretar`, `:7965`) fails.
- **The local copy differs from production.** `index.html` was modified locally on 2026-10-02 12:40, after the last recorded deploy. Nobody can say which version users are running: there is no version string (grep `APP_VERSION` 0) and no build ID.
- **The tests protect nothing.** `tests/pruebas.js` is unchanged since 2026-07-12 and still **re-implements** the functions it tests (`uid` `:14`, `sanTxt` `:26`). It imports nothing from `index.html`. There is no CI. About 1,800 lines of new logic have shipped since the tests were last edited.
- **No staging, no preview gate, no tested rollback.** Rollback in practice means restoring a Drive version of a 1 MB file and re-uploading it.

---

## 2. Go / No-Go

- **(a) Acquisition / resellable product: NO-GO.** Value would have to be rebuilt; the code would not transfer. Blockers: single-tenancy (Criterion 1), no fiscal layer (Criterion 2), unclear IP and account ownership (Criteria 4, 5 and 7), and no engineering process (Criterion 8).
- **(b) Internal production system: CONDITIONAL GO.**
  - **GO now** for quotes, OTs, fichas, paper, guillotine, tracking and deliveries, provided quick wins 1–6 are done within weeks.
  - **NO-GO for retiring the Excel production plan** until the planning store is fixed (Criterion 3, items 1–3) and a parallel-run period is completed.

---

## 3. Top risks blocking approval (ranked)

1. **Possibly open database.** The rules allow any authenticated user, the domain filter is commented out (`firestore.rules:22-24`), and self-signup is possible with the public apiKey. Rule deployment is unverified. All CUITs, prices and margins could be exposed.
2. **Open AI billing endpoint.** `interpretar.js:5` has `ACAO:'*'` with no auth, no rate limit and no image byte cap. Anyone can spend the Anthropic key, and the AI feature is now heavier than in September.
3. **Silent loss of the production plan and stock.**
   - Whole-blob last-writer-wins with no live sync (`sv` `:263`, `activarSincronizacion` `:503`).
   - A timeout or `null` load followed by a save overwrites real data with defaults (`cargarDatos` `:452-453`, `ld` `:218`).
   - The single `_config` document will eventually hit 1 MiB.
4. **No version control, two manual hosts, local ≠ prod.** One git commit from July, git not installed, 10,381 lines changed by hand, no version stamp. A bad edit cannot be identified or reliably rolled back.
5. **Bus factor of one, with stale or absent docs.** No one else can operate, fix or deploy the system, and `PENDIENTES.md` misdescribes what the system does.
6. **Commercial secrets in a public file.** Cost per kg, click costs, margin and consumable costs are embedded in the anonymously downloadable `index.html` (`:906-932`, `:1578-1597`, `:3743-3750`).
7. **Misleading financials.** Revenue in `rBalMes` includes IVA and is recognized on quote date (`:7503-7508`).
8. **Compliance vacuum.** No privacy notice, no AAIP assessment, undisclosed transfers to Google and Anthropic, no audit trail, no LICENSE file, and AI-authorship IP uncertainty.

## 4. Quick wins (days, not weeks)

1. **Lock down `interpretar.js`.** Require a Firebase ID token: the client sends `Authorization: Bearer <idToken>` and the function verifies it. Set `Access-Control-Allow-Origin` to the Netlify origin only, cap total body size (e.g. 6 MB), cap images, lower `max_tokens`, and set a monthly spend limit in the Anthropic console.
2. **Publish strict Firestore rules and disable self-signup.**
   - Use an allow-list: `request.auth.token.email in [...]`, or a custom claim. Check the real user emails first. The commented domain filter (`@coma-grupoimpresor.com.ar`) may not match the `esteban-gerencia@...` accounts and could lock users out.
   - Disable new-user creation in Firebase Auth. Create users from the console instead of with `crearUsuario` (`:430`).
   - Screenshot the published rules as evidence.
3. **Enable Firestore scheduled backups or PITR** in the console (`SEGURIDAD-PENDIENTE.md` §3). Keep the weekly JSON download as a second copy.
4. **Never save a blob that failed to load.** In `cargarDatos` (`:452-453`), mark keys whose `ld` returned `null` as "not loaded". Make `sk`/`sv` refuse to write them and show a reload banner. This is a single small guard that removes the worst data-loss path.
5. **Re-adopt git now.** Install Git, commit the current tree, and push to the existing private `github.com/graficapro-coma/GRAFICA-PRO`. From then on, commit and tag before every deploy. Add `const APP_VERSION='2026.10.02-1'` and show it in the sidebar.
6. **Choose one host.** Retire Firebase Hosting (or redirect `firebaseapp.com` too), and add `netlify/**` to the `firebase.json` ignore list.
7. **Move the seed price lists out of `index.html`.** `COT_SEED`, `COT_PAPEL_CAT_SEED`, `XEROX_OFICIAL` and `INSUMOS_SEED` are already in Firestore after the first seed, so delete the literals.
8. **Fix the Balance revenue** to use `c.subtotal` (ex-IVA) instead of `c.total` (`:7504`, `:7525`), and label it "cotizado aprobado", not "ingresos".
9. **Rewrite `PENDIENTES.md`** as a two-page README covering what exists, how to deploy, where the keys live, who owns which account, and how to restore. Add a `LICENSE` or "all rights reserved, GRUPO COMA" notice and a one-paragraph AI-assistance and authorship statement.
10. **Add CSV export** for clients, OTs, quotes and paper orders. This helps with the Excel parallel run and with data portability.

## 5. Deeper issues requiring major work

- **Re-model planning and stock.** Move `planificacion`, `stockPapel`, `stockMovs`, `insumosItems` and `insumosMovs` out of `gp/_config` into subcollections. Add `onSnapshot` listeners and transactional updates for stock quantities. This is a prerequisite for retiring Excel.
- **Server-side authorization.**
  - Role claims, with per-collection rules so finance collections are unreadable to employees.
  - An audit trail (`createdBy/updatedBy/updatedAt` plus a change log).
- **A fiscal layer.** Integrate AFIP/ARCA electronic invoicing (WSFE) or a bridge to the shop's billing software, plus accounts receivable, collections and supplier payables. This is mandatory before calling the product an "ERP".
- **Modularize the 1 MB monolith** (662 functions, 79 `innerHTML` sinks) into modules with a build step. Use real unit tests that import the shipped costing functions (`cotCostoXMilPapel` `:916`, `_catCortes` `:953`, `cortesCalc` `:5028`, `aiCostearOptimo` `:8108`) and run them in CI on every push.
- **Multi-tenancy and productization**, only if resale is ever pursued:
  - A `tenants/{id}` data root and tenant-scoped rules.
  - Configuration tables for branding, machines, calendar, roles, resources, vendors, IVA and quote terms (replacing every literal in Criterion 1).
  - Provisioning, subscription billing, support tooling and accessibility.
- **Compliance package:** a privacy policy, AAIP registration review, international-transfer assessment for Google and Anthropic, a DPA with each, a data-retention policy, and redaction of personal data before sending to the AI.

## 6. Evidence index (file → function / lines)

| Finding | Location |
|---|---|
| Single data tree, no tenant | `firestore.rules:19`; `index.html:211`, `:215` (`ld`); `firebase-config.js:5` |
| Open rules / self-signup | `firestore.rules:22-24`; `index.html:185`, `:430-447` (`crearUsuario`) |
| Cosmetic roles | `index.html:689` (`puedeVerFinanzas`), `:692-695`, `:4112-4116` (`nav`) |
| People and vendors hardcoded | `index.html:321-326`, `:429-431`, `:678-683`, `:6820-6834`, `:7686-7690`, `:9849`, `:10000-10003` |
| Machines hardcoded | `index.html:2467` (`COT_MAQ_BASE`), `:8104`, `:1010`, `:2415`, `:4542`; `interpretar.js:29` |
| Branding hardcoded | `index.html:81`, `:147`, `:1818`, `:5643`, `:5927`, `:5941-5942`, `:10421`, `:10457`; `interpretar.js:24` |
| Calendar hardcoded | `index.html:6131-6133`, `:6190` |
| IVA / terms hardcoded | `index.html:3061`, `:7670`, `:7675`, `:8410`, `:8521`, `:10096` |
| Public price list | `index.html:906-907` (`COT_SEED`, `COT_CONFIG_DEFAULT`), `:925-932`, `:1578-1597` (`INSUMOS_SEED`), `:3743-3750` (`XEROX_OFICIAL`) |
| No invoicing / AR | `index.html:318` vs `:203-205` (`facturas`/`cobranzas` not persisted); grep AFIP = 0 |
| Balance includes IVA | `index.html:7503-7508`, `:7525` (`rBalMes`); `:8521`, `:10107` |
| Blob store / no live sync | `index.html:205`, `:258-273` (`sv`), `:498-506` (`activarSincronizacion`) |
| Timeout → default overwrite | `index.html:218` (`ld`), `:452-453` (`cargarDatos`), `:317-333` (defaults) |
| Backup (improved) / limits | `index.html:4186-4206` (`descargarBackup`), `:4228-4249`, `:4252-4272` (`restaurarBackup`), `:4275` (`wipeDatos`), `:231-234` |
| Counter transaction (improved) | `index.html:736-757` (`_reservarNumero`), `:758` (`nid`), `:775` (`nidCot`) |
| AI endpoint open | `interpretar.js:5`, `:15-21`, `:28-37`, `:85`; `index.html:7965` (`aiInterpretar`) |
| AI Etapa 2 implemented | `index.html:7948-8125` (`aiInterpretar`, `aiMatchPapel`, `aiCostearOptimo`) vs `PENDIENTES.md:9-12` |
| No VC / two hosts / drift | `.git/logs/HEAD` (1 commit 2026-07-11); `.git/FETCH_HEAD` (2026-07-17); `.firebase/hosting..cache`; `index.html:6-7`; `firebase.json` |
| Tests test a copy | `tests/pruebas.js:14`, `:26` (no `require` of app code) |
| No monitoring / silent catches | 83 `alert(`, 46 `catch(e){}` in `index.html`; e.g. `:233` |

---

## 7. Changes vs 2026-09-16 audit

| Area | Status | Evidence |
|---|---|---|
| Backup omits pricing catalog | **Improved / fixed** | `descargarBackup` builds from `[...COL_KEYS,...BLOB_KEYS]` (`:4191`) |
| Restore wipes unlisted collections | **Improved / fixed** | Only keys present in the file are restored (`:4264`) |
| `wipeDatos()` live | **Improved** | Requires code `'CONFIRMAR-BORRAR-TODO'`, no UI button (`:4273-4278`) |
| ID collisions under concurrency (max+1) | **Improved / fixed** | `runTransaction` on `gp/_counters` (`:736-757`); fallback still non-atomic (`:752-756`) |
| `_config` read-modify-write race | **Partly improved** | Per-field `updateDoc` (`:263`); whole-field last-writer-wins remains for plan and stock |
| AI flagship "half-built" (Etapa 2) | **Improved** | AI now maps paper and machine and costs the optimum (`:8108`) |
| External printers hardcoded | **Improved** | `cotConfig.maqExtra` user-configurable (`:2468-2506`) |
| Firestore rules (domain filter commented) | **Unchanged** | `firestore.rules` untouched since 2026-07-11 |
| Open AI endpoint | **Unchanged → worse exposure** | Same `ACAO:'*'`, no auth; heavier prompt, images and tool use (`interpretar.js`, edited 2026-10-01) |
| Client-side-only roles | **Unchanged** | `:689`, `:4112` |
| Single-tenant hardcoding | **Unchanged** | Criterion 1 |
| No scheduled backup / monitoring / LICENSE | **Unchanged** | No evidence of change |
| Tests re-implement code, no CI | **Unchanged (relatively worse)** | `tests/pruebas.js` last edited 2026-07-12; app +~1,800 lines since |
| Version control / rollback | **Worse** | Still 1 commit; git not installed; all work since July is unversioned |
| Deploy topology | **Worse** | Two live hosts (Firebase deploy 2026-10-01 plus Netlify); local file newer than the deploy; no version stamp |
| Monolith size | **Worse** | ~8,600 → 10,381 lines, 1.0 MB, 662 functions |
| Documentation | **Worse** | `PENDIENTES.md` (9/7/2026) now contradicts the code |
| *New findings this audit* | **New** | Blob-timeout overwrite (`:452-453`); 1 MiB `_config` ceiling; no live sync for plan and stock; cost price list in a public file; `rBalMes` revenue includes IVA; `facturas`/`cobranzas` not persisted; Ley 25.326 international transfer to Anthropic; `firebaseapp.com` host not redirected |

**Net:** domain and data-integrity code improved. Score: 3.4 → 3.3 overall. The business-risk posture went **sideways to slightly worse**, because the process gaps (version control, release, documentation, security configuration) were not addressed while the codebase grew about 20%.
