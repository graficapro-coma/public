# Auditoría de PERFORMANCE y ESCALABILIDAD — GraficaPro (COMA)

**Fecha:** 2026-07-11
**Alcance:** `GRAFICA PRO/index.html` (~5.000 líneas, SPA de un solo archivo + Firestore).
**Encuadre:** Herramienta **interna** de imprenta. Volumen real: pocos usuarios simultáneos (2-6), **decenas a cientos de OTs por mes**. NO es un SaaS masivo. La escalabilidad se evalúa contra ESE volumen y un horizonte de **2-3 años de datos acumulados**.

> **Nota:** esta auditoría reemplaza la versión previa (2026-07-10, que puntuaba 2/10 CRITICAL). Aquella evaluaba el código ANTES de dos mejoras hoy aplicadas: (1) guardado incremental en `sv()` con cache `_docJson` — ya no reescribe la colección entera en cada guardado; y (2) índices `Map` `_cliIndex`/`_provIndex` — eliminan el O(n) por lookup de `cNom`/`pNom`. Esos dos hallazgos, que eran los bloqueantes, están corregidos, y por eso el puntaje sube fuerte.

> Estimación de datos a 2-3 años usada como base: ~100-200 OTs/mes → **3.000-7.000 órdenes** acumuladas, más una cantidad similar de cotizaciones, y varios miles de fichas/gastos/remitos. Clientes/proveedores en el orden de cientos.

---

## Puntaje general: **7,0 / 10**

Para el volumen real de COMA, el sistema **aguanta cómodo hoy y sigue siendo usable a 2-3 años**, con lentitud creciente y localizada en un par de vistas concretas. Las dos mejoras aplicadas sacaron de encima los dos problemas más caros (cuota de escrituras de Firestore y lookups O(n)). Lo que queda son cuellos de botella de **renderizado** y **sincronización**: molestos y previsibles, pero no fatales a esta escala.

---

## Rúbrica (1-10)

| # | Criterio | Puntaje | Resumen |
|---|----------|:------:|---------|
| 1 | Escrituras a Firestore / guardado incremental (`sv`) | **9** | Corregido: solo escribe el doc que cambió. |
| 2 | Carga inicial y modelo de lectura (sin paginación/archivado) | **6** | Trae TODAS las colecciones enteras al abrir. |
| 3 | Sincronización en tiempo real (`activarSincronizacion` / `onSnapshot`) | **5** | Compara colecciones enteras con `JSON.stringify` y re-renderiza todo. |
| 4 | Renderizado y DOM (`render`, `innerHTML` total, sin virtualización) | **5** | Re-render total, pierde scroll; tablas OT/Cotizaciones sin paginar. |
| 5 | Búsqueda y filtrado (`updateOTResults`, `updateSegResults`) | **7** | Filtra arrays completos por tecla; barato al volumen real. |
| 6 | Lookups e indexación (`cNom`/`pNom`, `_cliIndex`/`_provIndex`) | **9** | Índices `Map` O(1) con invalidación por referencia/longitud. |
| 7 | `MutationObserver` global de fechas | **4** | Reformatea fechas recorriendo todo el DOM en cada cambio. |
| 8 | Agregaciones y cálculos por vista (`rDash`, `updateSegResults`, `rCalSemanal`, balances) | **6** | O(n) repetidos; acotados por filtrar entregadas/canceladas. |

---

### Justificación por criterio

**1. Guardado incremental — 9/10.**
`sv()` (líneas 300-341) compara cada ítem contra un cache JSON por documento (`window._docJson[k][sid]`) y **escribe solo los que cambiaron** (`if(js!==null&&cache[sid]===js)continue;`, 324). Los eliminados se detectan con `_knownIds` (307-313). Esto elimina el problema histórico de reescribir la colección entera en cada tecleo (el que disparaba el consumo de escrituras +2800%). Costo residual: cada `sk('ordenes')` recorre TODO el array comparando (O(n) con un `JSON.stringify` por ítem, 321-327). A 5.000 órdenes, tipear un importe hace ~5.000 `stringify` en memoria antes de decidir que solo 1 cambió — es CPU local, no cuota, del orden de pocas decenas de ms. Aceptable; por eso no es 10.

**2. Carga inicial / modelo de lectura — 6/10.**
`cargarDatos()` (506-539) hace `Promise.all` sobre TODAS las claves (`COL_KEYS`+`BLOB_KEYS`, 508-510) y trae cada colección **completa** (`ld()` hace `getDocs` de la colección entera). No hay paginación de servidor, ni archivado de OTs viejas, ni carga diferida por vista. A cientos de docs es instantáneo; a 5.000-7.000 órdenes + otras tantas cotizaciones son miles de documentos leídos en cada apertura. En lecturas de Firestore sigue siendo barato para pocos usuarios (no revienta cuota), pero el **tiempo de arranque** y la **RAM del navegador** crecen lineal con la historia. Sin archivado, cada año que pasa el arranque es más lento aunque el trabajo "vivo" sea el mismo puñado de OTs.

**3. Sincronización en tiempo real — 5/10.**
`activarSincronizacion()` (542-575) registra `onSnapshot` sobre 6 colecciones (`clientes, proveedores, cotizaciones, ordenes, fichas, gastos`). En cada callback:
- Reconstruye el array remoto completo (`snap.docs.map(...)`, 554).
- Hace `JSON.stringify(S[k])` **y** `JSON.stringify(docs)` (556-557) — serializa la colección ENTERA dos veces para comparar.
- Si difieren, reasigna `S[k]` y llama `render()` (567): re-render total de la página actual.

A 5.000 órdenes, cada escritura de **cualquier** usuario dispara en las demás pantallas dos serializaciones de un array de miles de objetos + un re-render completo. Son decenas de ms por evento; con dos personas cargando OTs en simultáneo se nota un "parpadeo"/lag. No es incorrecto funcionalmente, pero es el patrón menos escalable que queda. (`remitos` no está sincronizado en vivo, solo se carga al abrir.)

**4. Renderizado / DOM — 5/10.**
`render()` (885-890) hace `Q('pg').innerHTML=fns[curPg]()`: **reconstruye la página entera** en cada cambio. Se pierde el scroll, se pierde foco/estado de inputs no controlados, y se re-parsea un string HTML grande. No hay virtualización. Mitigante importante: las vistas más pesadas (Dashboard, Tablero de seguimiento) filtran `estado!=='entregada'&&estado!=='cancelada'` (1054, 1358), así que **solo renderizan trabajo vivo** (acotado) sin importar la historia. **Problema concreto:** las tablas de **Órdenes de trabajo** (`updateOTResults`, 1210) y **Cotizaciones** (`updateCotResults`, 1176) renderizan **TODAS las filas sin paginar**, a diferencia de Clientes/Proveedores que sí paginan (`PER=25`, línea 226; `updateCliTable` 896-912). Cuando `S.ordenes` llegue a miles, abrir "Órdenes de trabajo" sin filtro construirá un `<table>` de miles de filas (con `pasosContables` por fila) en un solo string — el primer lugar donde se va a sentir lento.

**5. Búsqueda y filtrado — 7/10.**
`updateOTResults`, `updateSegResults`, `updateCliTable`, `updateCotResults` filtran el array completo en cada pulsación de tecla (`oninput`), sin debounce ni índice de texto. Es O(n) por tecla. A cientos-miles de registros es fluido (filtrar 5.000 objetos en JS son <5 ms). Baja de 10 solo porque, combinado con el re-render total (criterio 4), tipear en la búsqueda de OT reconstruye toda la tabla en cada letra. Al volumen real: no molesta.

**6. Lookups / indexación — 9/10.**
`_cliIndex()`/`_provIndex()` (707-717) construyen un `Map` id→objeto y lo cachean, invalidándolo cuando cambia la referencia del array o su longitud. `cNom`/`pNom`/`cNomCorto`/`pNomCorto` (852-855) son ahora O(1). Esto elimina el O(n) por celda que antes hacía O(n²) cada tabla con nombres de cliente. Muy bien resuelto. Detalle menor: la invalidación por *longitud* no detecta una edición in-place sin cambio de largo, pero como el `Map` guarda **referencias** a los objetos, las ediciones de campos se reflejan igual. Correcto.

**7. `MutationObserver` global de fechas — 4/10.**
El IIFE de 3569-3595 instala un `MutationObserver` sobre `document.body` con `subtree:true, childList:true` (3586-3591) que, ante cada nodo agregado, corre un `TreeWalker` por todo el subárbol para reescribir `AAAA-MM-DD` → `DD/MM/AAAA`. Como `render()` reemplaza `innerHTML` con un bloque HTML grande, **cada re-render dispara el observer con toda la página como nodos nuevos**, y el TreeWalker recorre todos los nodos de texto de la vista recién pintada. Es trabajo O(nodos) *encima* de cada render, frágil (regex sobre texto visible) y caro justo en las vistas con tablas grandes. Es el peor patrón por relación costo/beneficio: un formateo cosmético que se paga en cada pintado.

**8. Agregaciones por vista — 6/10.**
- `rDash`/`updateDashResults` (1042): varios `S.ordenes.filter(...)` encadenados sobre el total (1054-1062), reducidos enseguida a `activas`. Acotado.
- `updateSegResults` (1352): filtra a activas y por fila evalúa `segMatch`/`pasosContables`; conjunto acotado a trabajo vivo. OK.
- `rCalSemanal` (2231): dentro del doble bucle de slots × 6 días hace `S.ordenes.find(o=>o.id===bl.otId)` (2263) — búsqueda lineal por celda ocupada; además `otsAct.filter(...)` y `planeadaAca` recorren órdenes/planificación varias veces por render. A miles de órdenes, pintar una semana hace muchas búsquedas lineales; no es crítico (los bloques por semana son pocos), pero es O(n) evitable con el mismo patrón `Map` que ya existe para clientes.
- Balances (`rBalMes`/`rBalAño`): agregan sobre colecciones completas; a 2-3 años son miles de registros sumados en JS — del orden de milisegundos, aceptable.

---

## Top 5 riesgos (de mayor a menor)

1. **Tablas de OT y Cotizaciones sin paginación** (`updateOTResults` 1210, `updateCotResults` 1176). **Primer lugar que se va a sentir lento**: al no filtrar por estado ni paginar, la vista "Órdenes de trabajo" completa construirá un string HTML de miles de `<tr>` una vez que crezca la historia. Clientes/Proveedores ya paginan; OT/Cotizaciones no.

2. **`MutationObserver` global + re-render total** (3586 + 885). Cada `render()` repinta toda la página y dispara un `TreeWalker` sobre todo el DOM nuevo. El costo se multiplica exactamente en las vistas grandes del riesgo #1. Además pierde scroll y foco en cada cambio (fricción de UX que empeora con el tamaño de la tabla).

3. **`onSnapshot` comparando colecciones enteras con `JSON.stringify`** (556-557). Con dos usuarios cargando en simultáneo, cada guardado ajeno serializa dos veces la colección completa y re-renderiza. A miles de órdenes genera lag perceptible en tiempo real y trabajo desperdiciado (re-render aunque el cambio no afecte la vista abierta).

4. **Carga completa de todas las colecciones al abrir, sin archivado** (`cargarDatos` 508-510). Tiempo de arranque y memoria crecen linealmente con TODA la historia, aunque el trabajo activo sea siempre chico. Sin archivado de OTs entregadas, cada año la app arranca más lenta.

5. **`sk('ordenes')` recorre y serializa todo el array en cada guardado** (`sv` 321-327). Ya no es problema de cuota (solo escribe lo cambiado), pero el barrido O(n) con un `JSON.stringify` por ítem se paga en CPU local en cada tecleo sobre una OT. Molesto recién a varios miles de órdenes.

---

## Top 3 quick wins (bajo esfuerzo, alto impacto)

1. **Paginar / limitar las tablas de OT y Cotizaciones** igual que ya se hace con Clientes/Proveedores (`PER=25`), o mostrar por defecto solo activas + buscador. Ataca directo el riesgo #1 con un patrón que ya existe en el código. *(Máximo impacto por menor esfuerzo.)*

2. **Acotar el `MutationObserver`**: en lugar de observar `document.body` con `subtree:true`, formatear las fechas al generar el HTML de cada render (o aplicarlo una sola vez al contenedor `#pg` recién pintado, sin observer permanente). Elimina un costo O(nodos) por cada render y quita fragilidad.

3. **Cortocircuitar el eco del propio usuario en `onSnapshot`**: usar `snap.docChanges()` y `snap.metadata.hasPendingWrites` para ignorar los ecos propios y aplicar solo los docs cambiados, evitando el doble `JSON.stringify` de la colección entera y el re-render total.

---

## Refactors (mayor esfuerzo, valor a mediano plazo)

- **Render con actualización parcial del DOM** en vez de `innerHTML` total: repintar solo `tbody`/filas afectadas. Conserva scroll y foco y elimina de raíz los riesgos #2 y #3. Es el cambio estructural más grande (hoy el patrón "todo por string" es el ADN de la app).
- **Archivado de OTs entregadas**: colección/estado "archivado" que no se carga al abrir, con vista bajo demanda. Mantiene arranque y RAM constantes sin importar los años de historia (ataca riesgo #4).
- **Virtualización de tablas** (render solo de filas visibles) para vistas que puedan crecer sin filtro. Solo si se descarta la paginación del quick win #1.
- **Índice `Map` id→orden** reutilizable (como `_cliIndex`) para eliminar los `S.ordenes.find(...)` en `rCalSemanal` y handlers.
- **Debounce en los buscadores** (`oninput`) para no re-renderizar en cada tecla.

---

## Evidencia (ubicaciones)

- Guardado incremental con cache por doc: `sv()` — **300-341** (comparación `cache[sid]===js`, 321-327).
- Índices de lookup O(1): `_cliIndex`/`_provIndex` — **707-717**; consumidores `cNom`/`pNom` — **852-855**.
- Carga completa de todas las colecciones al abrir: `cargarDatos()` — **506-539** (`Promise.all`, 508-510).
- Sincronización en vivo con `JSON.stringify` de colección entera + `render()`: `activarSincronizacion()` — **542-575** (comparación 556-558).
- Re-render total por `innerHTML`: `render()` — **885-890**.
- Tablas sin paginar: `updateOTResults` — **1210**; `updateCotResults` — **1176**. Contraste con paginación: `updateCliTable`/`updateProvTable` — **896-928**; `PER=25` — **226**.
- `MutationObserver` global de fechas + `TreeWalker`: IIFE — **3569-3595** (observer 3586-3591).
- Búsquedas lineales por tecla: `updateSegResults` — **1352-1407**; `updateDashResults` — **1042-1149**.
- O(n) por celda en calendario: `rCalSemanal` — **2231-2307** (`S.ordenes.find` en 2263).
- Colecciones: `COL_KEYS` — **282**; `BLOB_KEYS` — **284** (`remitos` no sincronizado en vivo).

---

## Veredicto

- **Puntaje general:** 7,0 / 10.
- **Nivel de riesgo de performance:** **Medium** (con tendencia a Low para el trabajo diario *vivo*; la nota Medium la aporta la degradación previsible de las vistas OT/Cotizaciones completas y el combo re-render + MutationObserver a medida que se acumula historia).
- **¿Aguanta el uso interno a 2-3 años?** **Sí, aguanta** — con pocos usuarios y cientos de OTs por mes seguirá siendo funcional; lo primero en sentirse lento serán las tablas completas de Órdenes y Cotizaciones y el arranque, todos resolubles con los tres quick wins (paginar, acotar el MutationObserver y filtrar el `onSnapshot`) sin tocar la arquitectura.
