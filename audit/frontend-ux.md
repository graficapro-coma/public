# Auditoría Frontend / UX / Gestión de Estado — Gráfica Pro

**Fecha:** re-auditoría post-correcciones · **Encuadre:** herramienta interna de COMA, usada en escritorio por dueño, jefe de taller, operarios y administración.

## Puntaje general: **6 / 10** (antes: 4,5/10)
**Nivel de riesgo de mantenibilidad frontend: MEDIO** (antes: ALTO)

---

## Rúbrica

| # | Criterio | Puntaje | Evidencia |
|---|---|---|---|
| 1 | Consistencia visual y de interacción | 8/10 | **Vistas unificadas**: todos los módulos usan tabla con fila clickeable + hover (`tr.rlink`). Botón triangular CMY (ver/editar/eliminar) consistente en toda la app. Fechas siempre DD/MM/AAAA. |
| 2 | Flujos de trabajo del oficio | 9/10 | Cobertura excelente del proceso real: cotización con variantes → OT → preprensa/CTP → impresión → terminación/externos con retorno → entrega → rentabilidad. Tablero semaforizado con filtros por puesto (Pend. preprensa/corte/impresión). Es el punto más fuerte del sistema. |
| 3 | Feedback y prevención de errores | 6/10 | Indicador Guardando/Guardado con reintento; validación de formularios (no se guarda cotización vacía ni montos negativos); modales con X + Escape + clic afuera; se quitó el botón catastrófico "Limpiar todo". Falta: los errores fuera del guardado van a `console`; abuso de `alert/confirm/prompt` nativos. |
| 4 | Gestión de estado / render | 5/10 | `render()` reconstruye todo por `innerHTML` y **pierde el scroll**; algunos `oninput`/`onchange` que llaman a render pueden mover el foco/cursor. Las búsquedas usan actualización dirigida (bien). |
| 5 | Accesibilidad | 2/10 | Sin ARIA, sin navegación por teclado real, íconos-botón solo con `title`, contraste del amarillo del triángulo. Poco relevante para uso interno en desktop, pero es una carencia objetiva. |
| 6 | Responsive / tablet de taller | 3/10 | Sin media queries de layout, sidebar fija, tablas anchas con scroll horizontal, drag&drop de planificación no táctil. En la PC del taller funciona bien; en una tablet, no. |
| 7 | Confiabilidad de la vista | 6/10 | El formateo global de fechas por MutationObserver funciona pero es frágil. La app asume desktop y conexión estable. |

---

## Riesgos (contexto interno)

1. **No sirve en tablet/celular** (sin responsive, drag&drop no táctil). Si en el taller se quiere usar una tablet, hoy no va.
2. **Pérdida de scroll en cada render.** En tablas largas, tras marcar un paso la vista salta arriba. Fricción diaria menor pero real.
3. **Accesibilidad y teclado inexistentes.** Todo se opera con mouse.
4. **Errores silenciosos.** Si algo falla fuera del guardado, el usuario no se entera (queda en consola).

## Quick wins
1. Preservar `scrollTop` en `render()` (guardar y restaurar la posición del contenedor). Alto impacto diario, bajo esfuerzo. (S)
2. `aria-label` en los botones-ícono y en el triángulo CMY. (S)
3. Reemplazar 2-3 `alert()` de error por un cartelito no bloqueante. (S)

## Problemas de fondo
- Responsive real + interacción táctil para tablet (si se decide usarla en planta).
- Render incremental para no perder scroll/foco (ligado al refactor de arquitectura).

## Veredicto de dominio
De 4,5 a **6**. Para el equipo interno de COMA en escritorio, la experiencia es **buena y consistente**: se entiende, es coherente y cubre el oficio con profundidad. Las debilidades (accesibilidad, responsive) pesan poco en ese uso; la única fricción cotidiana notable es la pérdida de scroll, que es un quick win.
