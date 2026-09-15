# Re-auditoría de preparación — Gráfica Pro (COMA)

**Fecha:** re-auditoría post-correcciones.
**Encuadre real:** herramienta **interna** de COMA, desarrollada a medida por el dueño (25 años de oficio) con asistencia. **No se vende.**
**Método:** 6 dominios auditados con lente estricta de comprador; el veredicto se interpreta en el contexto real de uso interno.
**Comparación:** contra la primera auditoría (que dio **2,5/10 · NO-GO**) para medir el progreso tras los arreglos.

---

## Puntaje global

- **Como herramienta interna para COMA: 6,4 / 10 → GO.**
- **Como producto para vender a terceros: ~4 / 10 → NO-GO** (no es el objetivo).

| Dimensión | Antes | Ahora | Riesgo actual |
|---|---|---|---|
| Seguridad / datos | 2 | **6,5** | BAJO-MEDIO |
| Backend / base de datos | 2,5 | **6,5** | MEDIO |
| Performance / escalabilidad | 2 | **7,0** | MEDIO (Bajo en uso diario) |
| Frontend / UX | 4,5 | **6,0** | MEDIO |
| Arquitectura / mantenibilidad | 2 | **4,0** | ALTO |
| Producto (uso interno) | 3 | **7,5** | — |

### Niveles de riesgo consolidados (antes → ahora)
- **Seguridad:** CRÍTICO → **BAJO-MEDIO**
- **Datos / backend:** ALTO → **MEDIO**
- **Performance:** CRÍTICO → **MEDIO** (Bajo para el trabajo vivo)
- **Mantenibilidad:** CRÍTICO → **ALTO**

---

## Recomendación: **GO para uso interno en COMA**

El sistema pasó de "no usar en producción" a "**usable en producción interna hoy**". Los cuatro problemas que en la primera auditoría hacían inevitable la pérdida de datos o la fuga de información están **resueltos y verificados**:

1. Base de Firestore **cerrada** (reglas publicadas: solo usuarios autenticados).
2. **IDs sin colisión** entre usuarios concurrentes (`uid()`).
3. **Guardado incremental** (se acabó la reescritura masiva que disparaba la cuota).
4. **XSS almacenado** cerrado por saneo de entrada.

Sumado a: roles básicos, integridad referencial, validación de formularios, **backup con recordatorio semanal**, y **control de versiones (git/GitHub)**.

Lo que queda es hoja de ruta de mejora, no bloqueo: deuda técnica del monolito, responsive/tablet, tests formales, auditoría de borrados.

---

## Top 10 temas restantes (por severidad, contexto interno)

1. **Deuda técnica del monolito** — 5.000 líneas en un archivo, sin tests formales. (arquitectura)
2. **Bus factor** — un solo autor; mitigado por git + backup, no eliminado. (producto)
3. **Edición concurrente del mismo registro** (last-writer-wins). (backend)
4. **Sin auditoría de borrados/cambios** (quién hizo qué). (seguridad)
5. **Autorización por rol solo en cliente** (las reglas no distinguen rol). (seguridad)
6. **Tablas de OT/Cotizaciones sin paginación** — primer punto que se sentirá lento con los años. (performance)
7. **Render total por `innerHTML`** — pierde scroll; fricción diaria. (frontend)
8. **Backup manual** (con recordatorio, pero depende del clic). (backend)
9. **Sin responsive/tablet** — no sirve fuera del escritorio. (frontend)
10. **MutationObserver global de fechas** — frágil y algo caro. (performance)

## Top 10 mejoras por ROI

1. Preservar el scroll en `render()`. (frontend, S)
2. Documento técnico de 2 páginas (baja bus factor). (producto, S)
3. Paginar OT/Cotizaciones con el patrón `PER=25` existente. (performance, S)
4. Al borrar OT, limpiar su planificación/análisis. (backend, S)
5. Registro de auditoría de borrados. (seguridad, S)
6. `escHtml()` en el render de nombres/descripciones (defensa en profundidad). (seguridad, S)
7. Cargar las cuentas de usuario por rol reales. (producto, S)
8. Merge de snapshot con `docChanges()`. (backend/performance, M)
9. Unificar `avP*` y las 3 grillas de costos. (arquitectura, M)
10. `aria-label` en botones-ícono. (frontend, S)

## Qué debe estar antes de usar en producción interna → **YA ESTÁ**
Reglas cerradas · IDs seguros · guardado eficiente · backup · versionado. **Se puede usar hoy.**

## Qué puede esperar
Refactor a módulos/tests · responsive · auditoría de borrados · concurrencia fina · backup automático server-side.

---

## Archivos
`README.md` (este) · `architecture.md` (4) · `security.md` (6,5) · `performance.md` (7) · `backend-db-api.md` (6,5) · `frontend-ux.md` (6) · `product-launch-readiness.md` (7,5 interno) · `action-plan.md` · `SEGURIDAD-PENDIENTE.md`.

## Conclusión en una línea
De **NO-GO a GO para uso interno**: los riesgos críticos se cerraron y verificaron. Lo que resta es evolución ordenada de una herramienta que ya resuelve, y muy bien, el problema real de COMA.
