# Gráfica Pro — Pendientes y hoja de ruta

Última actualización: 9/7/2026

## Pendientes (para más adelante)

1. **Material en la cotización.** Cargar el material a usar ya en la cotización (cuando se cotiza el papel ya se sabe qué material va). Que ese material baje solo: cotización → OT → módulo de Pedidos de papel (grilla prellenada, sin recargar ni riesgo de error).

2. **IA "Interpretar pedido" — activar y afinar.** Ya está armado el botón en la cotización + la función segura `netlify/functions/interpretar.js` (la clave va en variable de entorno, NO en el código). Falta:
   - Subir a GitHub: `index.html`, `netlify.toml` y `netlify/functions/interpretar.js`.
   - Crear clave en console.anthropic.com y cargarla en Netlify → Environment variables como `ANTHROPIC_API_KEY` (opcional `ANTHROPIC_MODEL`).
   - Etapa 2: que además de precargar los ítems, complete el **costeo** (máquina + papel exacto de las tablas + poses + procesos), no solo texto.

## Hecho

### Tablero de Seguimiento (9 etapas)
- Etapas: Diseño · CTP · Papel · Corte · Impresión · Terminación · Externos · Control · Entrega.
- **CTP en gris "N/A"** para trabajos digitales (Xerox): no se opera ni cuenta para el avance.
- **Papel y Corte** separados (antes "Papel/Guillotina").
- **Terminación y Externos** separados. Clic en el círculo abre una ventanita con todos los procesos de la OT para avanzar cada uno (interno/externo, con proveedor y fecha de retorno). La clasificación sale del detalle de la OT y se recalcula al guardar.
- **Variación de entrega:** al completar Entrega muestra días antes / en fecha / de atraso.

### Módulo Pedidos de papel (Producción)
- Grilla tipo Excel: OT · Cliente/Trabajo · Material · Gr · Formato · Cortes · Pliegos · Kg · Papelera · Pedido por · Estado.
- **Kg** = ancho × alto × gramaje × pliegos ÷ 10.000.000 (automático).
- **Pliegos grandes** auto desde la OT (pliegos a imprimir ÷ cortes), editables.
- **Cortes** sugeridos según formato grande vs. formato de máquina, editables.
- Datos precargados desde la OT y edición de ida y vuelta (se guarda también en la OT).
- Estados sincronizados con el tablero: **Comprado** (verde) → **Recibido** → y **Corte** por guillotina. Casilla **stock**.
- Impresión: **planilla de pedido por papelera** (con nota editable tipo "LLEGA EL MARTES" y total de Kg) y **cartel de pallet A4 apaisado** (logo COMA, recuadros de recepción, OT, cliente, trabajo, material, papelera).

## Notas técnicas
- Todo vive en `index.html` (app de una sola página, Firebase proyecto `graficapro-coma`).
- Las OT viejas se migran solas al recargar (no se pierde progreso). Google Drive guarda historial de versiones del archivo.
