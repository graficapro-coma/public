# Auditoría de Producto / Riesgo de Negocio / Readiness — Gráfica Pro

**Fecha:** re-auditoría post-correcciones · **Encuadre:** herramienta INTERNA de COMA, desarrollada a medida por el dueño (25 años de oficio) con asistencia. **No se vende.**

## Doble puntaje (según la vara)
- **Como herramienta interna para COMA: 7,5 / 10 — GO.** Lista para el uso diario, con las salvedades de abajo.
- **Como producto para vender a terceros: 4 / 10 — NO-GO.** Faltaría multi-tenancy, roles server-side, soporte, documentación, licencia, etc.

Se responde con las dos varas porque la consigna pide la lente de comprador, pero la realidad del proyecto es la primera.

---

## Rúbrica (lente interna COMA)

| # | Criterio | Puntaje | Evidencia |
|---|---|---|---|
| 1 | Ajuste al problema real (product-market fit interno) | 10/10 | Hecho por quien conoce el oficio; cada pantalla responde a un paso real de la imprenta. Encaja como un guante. |
| 2 | Cobertura funcional | 9/10 | Comercial (clientes, cotizaciones con variantes), producción (OT, seguimiento semaforizado, preprensa/CTP, planificación con drag&drop, externos con retorno), análisis (rentabilidad OT×OT con aprobación contable/gerencia, tiempos, balances). Muy completo. |
| 3 | Continuidad / bus factor | 6/10 | **Mejoró:** código en git (repo privado), backup con recordatorio, desarrollo asistido. Riesgo residual: un solo autor y un monolito sin tests formales. Documentar el sistema ayudaría. |
| 4 | Seguridad y datos | 7/10 | Reglas de Firestore cerradas, entrada saneada, roles básicos, backup. Suficiente para interno (ver security.md). |
| 5 | Confiabilidad operativa | 7/10 | IDs sin colisión, guardado eficiente, integridad referencial, indicador de guardado con reintento, fallback ante fallo de la API del dólar. |
| 6 | Cumplimiento (datos personales, Ley 25.326) | 6/10 | Se quitaron datos reales del código. Al manejar CUITs/contactos de clientes conviene una política mínima de tratamiento de datos y accesos. Riesgo bajo en uso interno. |
| 7 | Costo y dependencia | 8/10 | Plan Spark (gratis) alcanza para el volumen. Dependencia de Firebase (lock-in) aceptable. Sin costos ocultos. |

---

## Riesgos de negocio (contexto interno)

1. **Bus factor.** Si mañana el autor no está, retomar el monolito sin documentación es difícil. Mitigado por git + backup, no eliminado. **Acción sugerida:** un documento técnico corto + mantener el hábito de commits.
2. **Edición concurrente del mismo registro** (ver backend). Poco frecuente en COMA.
3. **Dependencia de un solo proveedor cloud** (Firebase). Aceptable.
4. **Sin tests formales:** cambios futuros pueden introducir regresiones. Mitigado por git (revertir) y pruebas puntuales.

## Quick wins de negocio
1. Documento de 2 páginas: "cómo está armado el sistema, cómo hago backup, cómo vuelvo atrás una versión con git". Baja el bus factor drásticamente. (S)
2. Definir y cargar las cuentas de usuario por rol reales (gerencia/admin/operarios) para que la separación de vistas financieras opere. (S)
3. Establecer la rutina: backup semanal (ya tiene recordatorio) + commit tras cada cambio. (proceso)

## Qué debe estar antes de "lanzar" internamente (ya está)
- Base cerrada (reglas) ✅ · IDs seguros ✅ · guardado eficiente ✅ · backup ✅ · versionado ✅. **Se puede usar en producción interna hoy.**

## Qué puede esperar
- Refactor de arquitectura, responsive/tablet, tests formales, auditoría de borrados.

## Veredicto de dominio
**GO como herramienta interna.** Es un caso claro de software a medida que resuelve muy bien el problema de su dueño. El valor está en el conocimiento del oficio volcado en el producto. Los "peros" de la lente de comprador (monolito, sin tests, roles en cliente) son reales pero no bloquean el uso interno; son la hoja de ruta de mejora continua.
