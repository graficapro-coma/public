# Plan de acción — Gráfica Pro (actualizado post-correcciones)

Encuadre: herramienta interna de COMA. Esfuerzo: **XS** <1h · **S** 1-4h · **M** 1-3 días · **L** 1-2 sem.

---

## ✅ FASE 0 y 1 — COMPLETADAS (lo que bloqueaba usar en producción)

| Ítem | Estado |
|---|---|
| Reglas de Firestore restrictivas (deny-by-default + auth) | ✅ publicadas y verificadas en consola |
| IDs internos a prueba de colisión (`uid()`) | ✅ hecho + tests |
| Guardado incremental por documento (`sv` + `_docJson`) | ✅ hecho + tests |
| Quitar botón "Limpiar todo" del panel | ✅ hecho |
| Saneo de entrada / cierre de XSS (`_sanitizeColeccion`) | ✅ hecho + tests |
| Validación de formularios (cotización, montos) | ✅ hecho |
| Integridad referencial al borrar (cliente/cotización) | ✅ hecho |
| Roles: ocultar/bloquear finanzas a operarios | ✅ hecho |
| CSP + limpieza de estado en logout | ✅ hecho |
| Datos reales fuera del `seed()` | ✅ hecho |
| Backup local + recordatorio semanal (viernes 16 hs) | ✅ hecho + tests |
| Control de versiones (git + GitHub privado) | ✅ hecho |

**Resultado:** riesgo de seguridad CRÍTICO→BAJO-MEDIO; riesgo de datos ALTO→MEDIO. Sistema **usable en producción interna**.

---

## FASE 2 — Mejoras de robustez y comodidad (cuando haya tiempo)

| # | Acción | Esfuerzo | Dominio |
|---|---|---|---|
| 2.1 | Preservar `scrollTop` en `render()` (no saltar arriba al marcar un paso) | S | frontend |
| 2.2 | Paginar OT y Cotizaciones con el patrón `PER=25` ya existente | S | performance |
| 2.3 | Al borrar una OT, limpiar su planificación y su `analCostos` | S | backend |
| 2.4 | Registro de auditoría de borrados `{quien, que, cuando}` | S | seguridad |
| 2.5 | `escHtml()` en render de nombres/descripciones (defensa en profundidad) | S | seguridad |
| 2.6 | Documento técnico de 2 páginas (mapa del archivo + cómo backup/git) | S | producto |
| 2.7 | Cargar las cuentas de usuario por rol reales del equipo | S | producto |
| 2.8 | Merge de snapshot con `docChanges()` (concurrencia + performance) | M | backend |

## FASE 3 — Deuda técnica de fondo (proyecto, solo si se decide invertir)

| # | Acción | Esfuerzo |
|---|---|---|
| 3.1 | Separar CSS/JS del HTML; introducir build simple | M |
| 3.2 | Unificar `avP*` y las 3 grillas de costos | M |
| 3.3 | Render incremental (no `innerHTML` total) | L |
| 3.4 | Materializar el modelo de datos (campos en vez de regex) | M |
| 3.5 | Suite de tests formal + CI | L |
| 3.6 | Responsive real + interacción táctil (tablet de taller) | L |

---

## Rutina recomendada (proceso, no código)

- **Backup:** semanal, viernes (el sistema ya te lo recuerda). Guardar el `.json` en Drive o pendrive.
- **Git:** un commit tras cada cambio, con nota corta de qué cambió. Así toda versión es reversible.
- **Usuarios:** dar de alta las cuentas reales por rol para que la separación de vistas financieras funcione.

## Reconocimiento
La cobertura del oficio es el activo real y no debe perderse en ningún refactor: cotización con variantes, OT, preprensa/CTP, impresión, terminación/externos con retorno, entrega, rentabilidad con doble aprobación, tiempos y balances. Eso es lo difícil de construir y está muy bien logrado.
