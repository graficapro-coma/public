# Product / Business-Risk / Launch-Readiness Audit — Gráfica Pro

**Lens:** Acquisition due diligence. The buyer wants reasons **not** to buy. Evidence-based, brutally honest.
**Scope:** Product, business risk and launch-readiness only (security/perf/backend covered in sibling reports; referenced where they create business risk).
**Reviewer stance:** Independent. This report deliberately does **not** adopt the "internal tool, 7.5/10, GO" framing of the existing `README.md`/`product-launch-readiness` drafts. As a *tradeable asset*, the honest verdict is far lower, and the brief asks for the buyer's lens.

---

## Overall: 3.4 / 10 — NO-GO as an acquisition

Gráfica Pro is an excellent piece of **bespoke internal software** and a poor **acquisition target**. What makes it valuable to COMA — 25 years of print-shop know-how hard-wired into every screen — is exactly what makes it near-unsellable to anyone else: the domain knowledge is fused into a single-tenant, single-author, undocumented 8–9k-line HTML file. A buyer is not buying a product; they are buying one company's tool plus a rewrite.

If the acquisition thesis is "buy it, resell it to other print shops," that thesis fails on the evidence below. If the thesis is "acqui-hire the know-how and rebuild," the code is a liability, not an asset.

---

## Rubric

| # | Criterion | Score | Basis |
|---|-----------|:---:|-------|
| 1 | Multi-tenancy / resale value | **2/10** | Single-tenant to the bone; resale = rewrite |
| 2 | Business continuity / bus factor & docs | **3/10** | One author, one monolith, no architecture doc, single git commit |
| 3 | Vendor lock-in, cost & API-abuse exposure | **4/10** | Firebase lock-in acceptable; **open AI function is an uncapped cost hole** |
| 4 | Data ownership, PII & legal/compliance | **3/10** | Client CUIT/prices; no privacy policy, terms, DPA, or license |
| 5 | Reliability / support / monitoring / backup | **3/10** | No monitoring, no error tracking, no SLA, no automated server backup |
| 6 | Feature completeness vs roadmap | **6/10** | Strong, deep core; flagship AI feature half-built |
| 7 | Launch readiness: QA, deploy, rollback | **3/10** | Deploy-on-commit to prod, misleading tests, one-commit history |
| 8 | IP provenance & third-party licensing | **5/10** | Libraries MIT-ish; AI-generated-code provenance undocumented |

**Weighted overall: 3.4 / 10.** Criteria 1, 2, 5 and 7 are the deal-blockers for a buyer.

---

## 1. Multi-tenancy / resale value — 2/10

The app is not multi-tenant; it is not even parameterised for a second company. The company, its vendors, its staff and its fleet are literals in the code:

- **Firestore project & routing hardcoded:** `firebase-config.js` (`projectId: "graficapro-coma"`); `index.html:7` redirects `graficapro-coma.web.app` → `graficapro-coma.netlify.app`.
- **Vendor/resource names as string literals:** `index.html:5945-5949` — `findProv('COMA - IMPRESION')`, `'COMA - CHAPAS'`, `'COMA - GUILLOTINA'`, `'COMA - STOCK'`, `'COMA - FLETE'`. Delivery fleet enumerated by **person/vendor name**: `['Coma','Edu','Walter','Torreflet']` (`tests/pruebas.js:121`, mirrored in the app). Default cost resources `'CTP Coma'`, `'Guillotina Coma'`, `'Stock Coma'` (`index.html` `_defFijos`; `tests/pruebas.js:112`).
- **Branding baked in:** `index.html:4156` renders a literal `COMA` logo fallback; quote print title `Cotización ${c.num} - COMA` (`index.html:8471`).
- **Machine park hardcoded to COMA's presses:** SM52 / SM74 / Xerox logic throughout (`netlify/functions/interpretar.js:29`, cost tables labelled "Cotizador offset SM52 / SM74", `index.html:992`).
- **Roles = personal first names in a regex:** `puedeVerFinanzas` keys on `/gerencia|admin|contab|direccion|esteban|juanpablo/` (`tests/pruebas.js:65`); `crearUsuario` gates on `email === 'esteban-gerencia'` and `ADMIN_EMAIL='esteban@graficapro.com'` (`index.html:413-415`).

**Consequence:** Selling to a second print shop requires ripping out and re-parameterising branding, vendors, fleet, machines, roles, and the entire cost model — i.e. a rewrite of the data model, which `action-plan.md:3.4` itself lists as un-started ("Materializar el modelo de datos (campos en vez de regex)"). There is no tenant boundary in the data (`firestore.rules` scopes everything under one `/gp/**` tree). Resale value of the code as-is ≈ zero; value is in the know-how, not the asset.

## 2. Business continuity / bus factor & documentation — 3/10

- **One author, one file.** `.git/logs/HEAD` shows a **single commit** — "Initial commit" by `graficapro-coma <info@agflorida.com.ar>`, 2026-07-11. There is no development history. The "version control = rollback" mitigation claimed in `README.md` and `action-plan.md` is hollow: with one commit there is nothing to roll back **to**.
- **No architecture/README/onboarding doc.** The only root doc is `PENDIENTES.md` (a roadmap, not a system map). `action-plan.md:2.6` lists "2-page technical doc" as still **to-do**. The `audit/` folder is reviewer-generated, not author documentation, and is excluded from hosting (`firebase.json` ignore) — it will not travel with the product as user-facing docs.
- **~8–9k-line single HTML file** mixing markup, styles-in-JS, business logic and Firebase wiring. `action-plan.md` Phase 3 (split CSS/JS, introduce a build, modularise) is entirely un-started.
- **Repo is non-functional standalone:** `firebase-config.js` is git-ignored (`.gitignore:2`), so a buyer cloning the repo receives an app that will not boot without out-of-band config and a Firebase project ownership transfer.

**Knowledge-transfer risk to a buyer: HIGH.** A new engineer inherits an undocumented monolith with no commit history and one person's mental model.

## 3. Vendor lock-in, cost & API-abuse exposure — 4/10

- **Anthropic API cost hole (material).** `netlify/functions/interpretar.js` is a **public, unauthenticated** endpoint: `Access-Control-Allow-Origin: '*'` (`:5`), no auth token, no origin allow-list, **no rate limiting**, accepts up to **4 images** and **8000 chars** with `max_tokens: 8000` (`:15,:21,:82`). Anyone who discovers `https://graficapro-coma.netlify.app/.netlify/functions/interpretar` can drive unbounded spend on the owner's Anthropic key. For a buyer this is an open-ended, unmetered liability.
- **Netlify credit plan (per brief: 300 credits, 15/deploy)** → ~20 deploys before exhaustion, and deploys are triggered on commit (§7). Function invocations also draw down. No cost alerting evident.
- **Firebase lock-in** is real but tolerable at this scale (Spark free tier suffices for ~4 users); however scaling to multiple tenants would hit free-tier limits and the incremental-save architecture, not the free tier, is what currently keeps quota usage sane.
- **Third-party runtime dependencies without fallback:** Tabler icons via `cdn.jsdelivr.net` (`index.html:20`), Firebase SDK via `gstatic.com` (`index.html:183-185`), FX rate via `dolarapi.com` (`index.html:965`). No SRI hashes, no self-hosted copies; a CDN outage degrades the app. FX has a manual fallback (good), the others do not.

## 4. Data ownership, PII & legal/compliance — 3/10

- **PII handled:** client `razón social`, **CUIT**, IVA condition, contact/locality (`index.html:7792`, `index.html:8515`, search placeholders `index.html:3176`), plus commercial-sensitive pricing/cost tables.
- **No privacy policy, no terms of service, no data-processing agreement, no cookie/consent handling** anywhere in the tree (glob of `*.md`/`*.html` finds none). Under Argentina's **Ley 25.326** (personal data), a productised/resold version would need a data-treatment policy and registration; even internally this is thin (the sibling compliance note self-scores 6/10).
- **Authorization is client-side only.** `firestore.rules:22-24` grants read/write to **any** authenticated user; the email-domain restriction is **commented out**. Since email/password auth is enabled (`index.html:185,394`) and the Firebase apiKey is public, a self-registered account can plausibly read/write the **entire** database (all clients, CUITs, prices) — role separation exists only in the UI. For a buyer weighing data-confidentiality warranties, this is a red flag.
- **No audit trail** of who created/changed/deleted records (`action-plan.md:2.4` still to-do) — problematic for any data-governance representation.

## 5. Reliability / support / monitoring / backup — 3/10

- **No monitoring or error tracking** of any kind (no Sentry/analytics/logging; grep finds none). Errors surface only as `alert()` dialogs to the end user (e.g. `index.html:430`). A buyer has zero operational visibility.
- **No SLA, no support process, no runbook.**
- **No automated server-side backup.** `audit/SEGURIDAD-PENDIENTE.md:27-31` states plainly "Hoy no hay copia de seguridad" for Firestore and lists scheduled exports as a **manual, un-done** console task. Continuity depends on the user remembering a weekly manual JSON download (`BKUP/` contains a single export dated 2026-07-17) plus Google Drive file versioning. A single deletion/corruption between manual backups is unrecoverable.

## 6. Feature completeness vs roadmap — 6/10

Genuinely the strongest area. The core commercial→production→analysis workflow is deep and coherent (quoting with variants, OT/work-order tracking, 9-stage semaphore board, CTP/prepress, paper ordering, external processes with return dates, OT-level profitability with dual approval). This is real, hard-won functionality.

**But the flagship differentiator is half-built.** `PENDIENTES.md:9-12`: the AI "Interpretar pedido" feature still requires the user to create/configure the Anthropic key, and **"Etapa 2"** (having the AI complete the actual costing, not just prefill text) is **not done**. Roadmap item 1 (material flow-through quote→OT→paper module) is also pending. For a buyer, the marketed "AI-powered quoting" is a demo, not a shipped capability.

## 7. Launch readiness: QA, deploy, rollback — 3/10

- **Deploy-on-commit straight to production.** `netlify.toml` publishes the repo root; there is no staging site, no preview-gate, no QA environment. Any commit that builds is live for all users.
- **Tests give false confidence.** `tests/pruebas.js` exists (contradicting "no tests"), but it **re-implements** the functions it tests inline (`uid` `:14`, `sanTxt` `:26`, `_pagina` `:33`, cost/poses logic, etc.) rather than importing them from `index.html`. It validates a *copy* of the logic, so it cannot catch a regression in the actual shipped code. `action-plan.md:3.5` lists a formal test suite + CI as un-started. There is **no CI** running even this file.
- **Rollback plan = git**, but with a single commit there is effectively no rollback (§2). The real safety net is Google Drive file history — an informal, manual mechanism.

## 8. IP provenance & third-party licensing — 5/10

- **Embedded libraries:** Tabler Icons 2.44.0 (MIT) and Firebase JS SDK 10.12.0 (Apache-2.0) — permissive, low licensing risk, but pulled from CDNs at runtime with **no local vendored copy and no license notices** retained in the repo.
- **AI-generated-code provenance is undocumented.** The app is explicitly "developed with assistance" (`README.md`/audit framing). For an acquisition, the buyer's counsel will want representations about authorship, license of any generated snippets, and that no third-party/confidential code was incorporated. Nothing in the repo addresses this. No `LICENSE` file exists, so the ownership/transfer terms of the codebase itself are unstated.

---

## Top risks blocking approval (for a buyer)

1. **Not a product — a single-tenant fixture (Rubric 1).** Resale requires a rewrite; the asset's value is the owner's know-how, which does not transfer with the code.
2. **Open, unmetered AI endpoint (Rubric 3).** `interpretar.js` is public with `ACAO:'*'`, no auth, no rate limit — an uncapped cost/abuse liability the buyer inherits on day one.
3. **Bus factor + no history/docs (Rubric 2).** One author, one 8–9k-line file, one git commit, no architecture doc. Knowledge-transfer risk is severe and only partially mitigated.
4. **Data confidentiality hole (Rubric 4).** Firestore rules grant any authenticated user full read/write; authorization is UI-only; no audit trail; PII (CUIT) + pricing exposed.
5. **No operational safety net (Rubric 5/7).** No monitoring, no automated backup, deploy-straight-to-prod, and tests that test a copy of the code rather than the code.

## Quick wins (cheap, would materially de-risk)

- **Lock down `interpretar.js`:** restrict `Access-Control-Allow-Origin` to the app origin, require a shared secret/Firebase ID token, add rate limiting. (Removes risk #2.)
- **Uncomment the email-domain condition in `firestore.rules:23`** and disable open email/password self-signup. (Closes the worst of risk #4.)
- **Enable Firestore scheduled backups** (console task in `SEGURIDAD-PENDIENTE.md:27`). (Closes the backup gap.)
- **Write the 2-page architecture/runbook doc** (`action-plan.md:2.6`) and start committing regularly. (Reduces bus factor immediately.)
- **Add a `LICENSE` and a short AI-provenance statement** for due-diligence hygiene.
- Add a deploy alert / cost alert on Netlify + Anthropic billing.

## Deeper strategic issues (cannot be "quick-won")

- **Data model is implicit/regex-driven** (roles by name-matching, stage columns by regex on labels). Productising or multi-tenanting requires materialising it into real fields (`action-plan.md:3.4`) — a project, not a patch.
- **Monolith with no module/build/test boundary** blocks safe change velocity and onboarding; refactor is Phase 3, un-started.
- **Tests test a fork of the logic** — the entire QA story needs rebuilding against the real code with CI, or it is worse than no tests (it implies coverage that does not exist).
- **No tenancy layer, no admin/provisioning, no billing** — the gap between "our tool" and "a SaaS someone can buy" is the majority of a product build.

---

## Verdict

**As an acquisition / resell target: NO-GO (3.4/10).** The buyer inherits a rewrite, a bus-factor of one, an open cost liability, and no operational safety net; the marketed AI feature is half-built.

**Caveat for honesty:** as **COMA's own internal tool**, this same evidence supports a much kinder read (the sibling reports' ~6.5–7.5 "GO for internal use" is defensible once the quick-wins above are done). The two verdicts are not in conflict — they answer different questions. The acquisition question is the one posed here, and the answer is no.
