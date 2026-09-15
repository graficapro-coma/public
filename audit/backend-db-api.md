# Auditoría de Backend / Base de Datos / Confiabilidad — Gráfica Pro

**Fecha:** re-auditoría post-correcciones · **Encuadre:** herramienta interna de COMA (no se vende).

## Puntaje general: **6,5 / 10** (antes: 2,5/10)
**Nivel de riesgo de datos: MEDIO** (antes: ALTO/CRÍTICO con 2 usuarios)

---

## Rúbrica

| # | Criterio | Puntaje | Evidencia |
|---|---|---|---|
| 1 | Generación de IDs | 8/10 | **Resuelto.** `uid()` genera un entero único a prueba de colisión (basado en tiempo + salt por cliente), dentro de `Number.MAX_SAFE_INTEGER`. Reemplazó a `Math.max(...ids)+1`, que daba el mismo id a dos usuarios simultáneos. El número visible (OT-0031) sigue secuencial; el id de documento ya no colisiona. |
| 2 | Escritura / consumo de cuota | 8/10 | **Resuelto.** `sv()` con cache `_docJson` escribe **solo el documento que cambió**. Antes reescribía la colección entera en cada guardado (el gráfico de Firestore mostró +2.871% de escrituras). El snapshot refresca el cache para no reescribir lo que vino de la nube. |
| 3 | Integridad referencial | 6/10 | `delCli`/`delCot` bloquean el borrado si hay OTs/cotizaciones asociadas (`_cotTieneOTs`). Falta: cascada o reasignación guiada; borrar una OT no limpia su planificación/análisis asociados. |
| 4 | Concurrencia multiusuario | 5/10 | `onSnapshot` reemplaza la colección local completa (last-writer-wins). Con IDs ya únicos, el caso grave (dos OTs pisándose) está resuelto; queda el caso fino de dos personas editando **el mismo** registro a la vez (gana el último). Aceptable para pocos usuarios; no ideal. |
| 5 | Validación de datos | 6/10 | Validación en cliente: cotización exige ítem con qty>0, montos no negativos (`savCot`), saneo de texto. **No hay validación server-side** más allá de "estar autenticado" (las reglas no validan forma de los datos). |
| 6 | Respaldo y recuperación | 7/10 | Backup manual (JSON) + recordatorio semanal + restauración (`restaurarBackup`). Falta backup automático server-side (plan Blaze). |
| 7 | Reglas / acceso | 8/10 | Reglas de Firestore restrictivas **publicadas** (deny-by-default, requiere auth). Confirmado en consola. |

---

## Riesgos (contexto interno)

1. **Edición concurrente del mismo registro (LWW).** Si dos personas abren la misma OT y guardan casi a la vez, gana el último. Poco frecuente con el equipo chico de COMA; conviene tenerlo en cuenta.
2. **Sin validación server-side.** Las reglas dejan escribir cualquier forma a un usuario autenticado. Un bug del cliente podría persistir datos malformados. Mitigado por la validación de cliente.
3. **Borrado de OT no limpia dependencias** (planificación/análisis de esa OT quedan huérfanos). Menor.
4. **Backup manual.** Depende de que alguien apriete el botón (ahora con recordatorio, pero sigue siendo manual).

## Quick wins
1. Al borrar una OT, limpiar también sus bloques de planificación y su `analCostos`. (S)
2. Merge de snapshot con `docChanges()` en vez de reemplazo total (mejora concurrencia y performance). (M)
3. Validaciones mínimas en las reglas de Firestore (tipos de campos clave). (S)

## Problemas de fondo
- Concurrencia real (transacciones/optimistic locking) si crece el número de usuarios simultáneos.
- Backup automático server-side (requiere Blaze).

## Veredicto de dominio
De ALTO a **MEDIO**. Los dos problemas que hacían la pérdida de datos casi inevitable (IDs colisionando + reescritura masiva) están **resueltos y verificados con tests**. Lo que queda (edición concurrente del mismo registro, backup manual) es tolerable para el volumen y la confianza de un equipo interno.
