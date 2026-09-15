# Seguridad — pasos que requieren tu mano (consola de Firebase)

Estos 4 puntos NO se pueden hacer desde el código: hay que entrar a la consola de Firebase / Google. Son los que faltan para cerrar la Fase 0 de seguridad. Tardan ~20 minutos en total.

## 1. Publicar las reglas de Firestore  ⭐ (lo más importante)

Ya dejé el archivo `firestore.rules` en la carpeta del sistema. Falta publicarlo:

1. Entrá a https://console.firebase.google.com y elegí el proyecto **graficapro-coma**.
2. Menú izquierdo → **Firestore Database** → pestaña **Reglas (Rules)**.
3. Borrá lo que haya y pegá el contenido de `firestore.rules`.
4. **Publicar**.

Sin esto, cualquier persona con la apiKey (que está en el código) puede leer y borrar toda la base sin login. Con esto, solo usuarios logueados pueden entrar. Si querés más candado todavía, en el archivo hay una línea comentada para limitar además al dominio `@coma-grupoimpresor.com.ar`.

## 2. Rotar la apiKey de Firebase

La apiKey de un proyecto web de Firebase no es un secreto en sí misma (siempre viaja al navegador), pero como estuvo en un archivo que se compartió, conviene regenerarla:

1. Google Cloud Console → https://console.cloud.google.com → proyecto graficapro-coma.
2. **APIs y servicios → Credenciales**.
3. Ubicá la API key del navegador → **Restringir clave**: limitala a los dominios/orígenes donde corre la app (o a la Firestore API). Si preferís, creá una nueva y reemplazá el valor en `firebase-config.js`.

La verdadera protección la dan las **reglas de Firestore** (punto 1), no la apiKey.

## 3. Activar backups automáticos de Firestore

Hoy no hay copia de seguridad: un borrado o una corrupción no tienen vuelta atrás.

1. En la consola de Firebase → Firestore → **Copias de seguridad (Backups)**, o
2. Google Cloud → Firestore → **Exportaciones programadas (Scheduled exports)** a un bucket de Cloud Storage (por ejemplo, diaria).

## 4. Poner el código bajo control de versiones (git)

Hoy el sistema vive en Google Drive: cualquier cambio pisa al anterior sin historial ni forma de volver atrás.

1. Instalá Git y creá un repositorio privado (GitHub/GitLab) con la carpeta `GRAFICA PRO`.
2. Agregá un `.gitignore` que excluya `firebase-config.js` (para no versionar credenciales).
3. Commit inicial y de ahí en más, un commit por cada cambio. Así cada versión queda guardada y es reversible.

---

### Lo que YA quedó arreglado en el código (no requiere tu intervención)

- Botón "Limpiar todo" retirado del panel (ya no se puede borrar todo con un clic).
- IDs internos a prueba de colisión entre usuarios (dos personas creando OTs a la vez ya no se pisan).
- Guardado incremental: solo se escribe a Firestore el documento que cambió (adiós al gasto de cuota por tecla).
- Sanitización de entradas y escapado en pantallas (cierre de XSS almacenado).
- Validación de formularios (no se guardan cotizaciones vacías ni montos negativos).
- Integridad referencial (no se puede borrar un cliente/cotización con OTs asociadas).
- Datos reales de clientes/proveedores quitados del código de ejemplo (`seed`).
- Balances y análisis ocultables por rol; CSP + persistencia de sesión; limpieza de estado al cerrar sesión.
