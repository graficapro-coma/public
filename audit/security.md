# Auditoría de Seguridad, Autenticación y Protección de Datos — Gráfica Pro

**Fecha:** re-auditoría post-correcciones · **Encuadre:** herramienta interna de COMA (no se vende).
**Método:** revisión del código actual con lente estricta de comprador.

## Puntaje general: **6,5 / 10** (antes: 2/10 · CRÍTICO)
**Nivel de riesgo de seguridad: BAJO-MEDIO** (antes: CRÍTICO)

---

## Rúbrica

| # | Criterio | Puntaje | Justificación / evidencia |
|---|---|---|---|
| 1 | Control de acceso al backend (Firestore) | 8/10 | **Reglas restrictivas publicadas y verificadas en consola** (`firestore.rules`): `match /gp/{document=**} { allow read, write: if request.auth != null }` y `match /{document=**} { allow ... if false }`. Nadie sin login lee/escribe. Era el hallazgo #1 crítico; resuelto. |
| 2 | Autenticación | 7/10 | Firebase Auth email/password (`initFirebase`, `onAuthStateChanged` ~L397); persistencia según "recordar sesión"; `doLogout()` ahora **limpia el estado en memoria** y cancela listeners. Falta: 2FA, política de contraseñas. |
| 3 | XSS almacenado | 7/10 | Se sanitiza el texto libre al guardar en `_sanitizeColeccion(k)` (quita `< >` de nombres, descripciones, notas, ítems) + helper `escHtml`. El vector principal (payload en nombre de cliente que se ejecuta en el navegador de todos) quedó cerrado a la entrada. Falta: dato legacy previo podría contener tags; el render sigue usando `innerHTML` (defensa en profundidad incompleta). |
| 4 | Confidencialidad por rol | 6/10 | `puedeVerFinanzas()` oculta y **bloquea** en `nav()` las páginas financieras (Análisis, Gastos, Balances) para roles operarios; el rol sale del prefijo del email. Limitación honesta: es control del lado del cliente — las reglas de Firestore no distinguen por rol, así que un operario técnico podría leer datos vía API. Aceptable para equipo interno de confianza; no lo sería para venta. |
| 5 | Integridad y borrado | 6/10 | Botón "Limpiar todo" **retirado** de la UI (solo invocable a propósito por consola con código). Integridad referencial: `delCli`/`delCot` bloquean si hay OTs asociadas. Falta: registro de auditoría (quién borró qué), papelera con restauración. |
| 6 | Respaldo / recuperación | 7/10 | Botón de **copia de seguridad** local (JSON) + **recordatorio semanal** automático (viernes 16 hs). Los datos viven en Firestore (nube). Falta: backup automático server-side (requiere plan Blaze). |
| 7 | Higiene de credenciales / transporte | 6/10 | Datos personales reales **quitados** del `seed()`. `.gitignore` excluye `firebase-config.js`. CSP agregado (bloquea plugins, restringe base-uri). La apiKey sigue en el config del cliente — **es pública por diseño en apps web de Firebase** y está cubierta por las reglas; correcto no restringirla (rompería el `file://`). |

---

## Riesgos que un comprador marcaría (con contexto interno)

1. **Autorización por rol solo en el cliente.** Las reglas de Firestore autorizan a cualquier usuario autenticado por igual; la separación gerencia/operario es visual. Para venta sería bloqueante; para uso interno de COMA con cuentas de confianza, es un riesgo aceptado.
2. **Sin registro de auditoría de borrados/cambios.** No se sabe quién borró o modificó un registro. Mitigado en parte por el backup semanal y el historial de Firestore.
3. **`innerHTML` en todo el render.** La sanitización en la entrada es el cinturón; falta el airbag (escapar también en la salida). Riesgo bajo tras el saneo.
4. **Sin 2FA ni política de contraseñas.**

## Quick wins
1. Aplicar `escHtml()` también en 3-4 puntos de render de mayor tráfico (nombres/descripciones) para defensa en profundidad. (S)
2. Registro simple de auditoría: al borrar, guardar `{quien, que, cuando}` en una colección `auditoria`. (S)
3. Activar exportación programada de Firestore si en algún momento se pasa a plan Blaze. (config)

## Problemas de fondo (refactor)
- Autorización real del lado del servidor (custom claims de Firebase + reglas por rol) si alguna vez se abre a usuarios no confiables o se comercializa.

## Veredicto de dominio
De **CRÍTICO a BAJO-MEDIO**. Para uso interno en COMA, la seguridad hoy es **razonable y suficiente**: la base está cerrada, la entrada saneada, los datos respaldados. Los pendientes (auditoría de borrados, roles server-side) son mejoras, no bloqueos.
