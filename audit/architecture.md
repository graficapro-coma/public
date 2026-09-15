# Auditoría de Arquitectura y Mantenibilidad — Gráfica Pro

**Fecha:** re-auditoría post-correcciones · **Encuadre:** herramienta interna de COMA (no se vende).

## Puntaje general: **4 / 10** (antes: 2/10)
**Nivel de deuda técnica: ALTO** (antes: CRÍTICO)

> La suba es modesta y honesta: la **arquitectura de fondo no cambió** (sigue siendo un monolito de un archivo). Lo que mejoró es la **red de contención alrededor**: control de versiones (git/GitHub), backup, y un mantenedor activo. Como pieza de ingeniería sigue siendo frágil; como herramienta interna con soporte continuo, es manejable.

---

## Rúbrica

| # | Criterio | Puntaje | Evidencia |
|---|---|---|---|
| 1 | Estructura y modularidad | 2/10 | ~5.000 líneas (CSS+HTML+JS) en un solo `index.html`, ~300 funciones globales, sin módulos, sin bundler, sin entry point (arranca con `init();` suelto). Sin cambios respecto a la auditoría previa. |
| 2 | Gestión de estado | 3/10 | Objeto global `S` + ~25 variables globales de UI. Se agregaron índices `Map` (`_cliIndex`, `_provIndex`) — una mejora puntual, no estructural. |
| 3 | Capa de vista | 3/10 | `render()` reemplaza todo por `innerHTML`; ~270 `onclick` inline. Sin cambios de fondo, aunque las vistas ahora están **unificadas** (patrón de tabla clickeable consistente), lo que reduce variantes a mantener. |
| 4 | Modelo de datos | 4/10 | Sigue clasificando pasos por regex sobre nombres en castellano (`SEG_COLS`, `segMatch`). Se agregaron migraciones idempotentes (`migrarPreprensa2Etapas`). IDs ahora robustos (`uid()`, ver backend-db-api). |
| 5 | Duplicación (DRY) | 3/10 | Persisten familias casi idénticas (`avP`/`avPN`/`avPIdx`; grillas de costos ficha/OT/análisis). No se consolidaron. |
| 6 | Tooling / versionado / respaldo | 5/10 | **Mejora real: ahora hay git + GitHub (repo privado) y backup con recordatorio.** Sigue sin tests automatizados en el repo (aunque se usan pruebas ad-hoc en Node al desarrollar) ni CI ni linter. |
| 7 | Extensibilidad / bus factor | 4/10 | El sistema de undo por monkey-patching de `sk()`/`render()` sigue siendo frágil. **Bus factor mitigado**: código versionado, respaldado y co-desarrollado con asistencia continua; ya no "vive solo en Drive". |

---

## Riesgos (con contexto interno)

1. **Monolito de un archivo sin tests.** Cada cambio grande toca un archivo enorme; el riesgo de romper algo sin querer es real. Mitigado por git (se puede volver atrás) y por pruebas puntuales al desarrollar.
2. **Modelo de negocio inferido por regex sobre texto.** Renombrar máquinas/pasos puede reclasificar datos históricos. Es una decisión de diseño a vigilar.
3. **Duplicación de lógica.** Un cambio en "avanzar paso" o en "grilla de costos" hay que replicarlo en 2-3 lugares.
4. **Undo por parcheo en runtime.** Un refactor legítimo puede romper el deshacer sin aviso.

## Quick wins
1. Separar CSS y JS del HTML en archivos propios (sin bundler todavía) — baja la fricción de leer/editar. (M)
2. Unificar `avP*` en una sola función y las 3 grillas de costos en una. (M)
3. Un README técnico corto que documente las secciones del archivo y las funciones clave (ayuda al bus factor). (S)

## Problemas de fondo (refactor mayor, Fase 2)
- Materializar el modelo de datos (guardar `columna`/`tipo` como campos, no inferirlos por regex).
- Migrar a módulos + build system; render incremental en vez de `innerHTML` total.
- Suite de tests formal.

## Veredicto de dominio
Deuda técnica **ALTA pero ya no CRÍTICA**. Para venta seguiría siendo un problema serio; para COMA como herramienta interna viva y respaldada, es **sostenible** — se puede seguir agregando funciones con cuidado, y ahora con git cada versión es reversible.
