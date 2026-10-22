// Función serverless de Netlify: interpreta el pedido de un cliente con Claude (Anthropic)
// y devuelve un JSON estructurado para pre-cargar la cotización.
// La clave NUNCA está en el código: se lee de la variable de entorno ANTHROPIC_API_KEY (Netlify → Environment variables).
//
// SEGURIDAD (para que nadie de afuera pueda usar la IA a costa de COMA):
//  - Solo responde a usuarios LOGUEADOS en Gráfica Pro: el navegador manda el token de Firebase y acá se verifica con Google.
//  - Opcional: ALLOWED_EMAILS (Netlify → Environment variables) = lista de mails separados por coma que pueden usar la IA.
//  - Solo acepta llamadas desde el propio sitio (ALLOWED_ORIGINS, por defecto graficapro-coma.netlify.app y pruebas locales).
//  - Topes de tamaño (texto, imágenes, contexto) y tiempo máximo de espera. Los errores no muestran detalles internos.
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBknhCg3HU7x1qa1hEgpSpt8yeA3QSBf9g'; // clave web pública de Firebase (no es secreta)
const ORIGENES = (process.env.ALLOWED_ORIGINS || 'https://graficapro-coma.netlify.app,http://localhost:5177,http://localhost:8888')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 6 * 1024 * 1024;       // 6 MB en total
const MAX_IMG = 2 * 1024 * 1024;        // ~1,5 MB por imagen (base64)

// Verifica el token de Firebase del usuario (devuelve el mail si es válido, o null)
async function usuarioValido(token) {
  if (!token) return null;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_API_KEY), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const u = d && Array.isArray(d.users) && d.users[0];
    if (!u || !u.email || u.disabled) return null;
    const lista = String(process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (lista.length && !lista.includes(String(u.email).toLowerCase())) return null;
    return u.email;
  } catch (e) { return null; }
}
// Listas del contexto: solo textos, cantidad y largo acotados (no se puede meter un texto gigante en las instrucciones)
const lista = (v, n, largo) => (Array.isArray(v) ? v : []).slice(0, n).map(x => String(x == null ? '' : x).slice(0, largo));

exports.handler = async (event) => {
  const hdr = event.headers || {};
  const origin = hdr.origin || hdr.Origin || '';
  const H = { 'Content-Type': 'application/json', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin && ORIGENES.includes(origin)) H['Access-Control-Allow-Origin'] = origin;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: JSON.stringify({ error: 'Método no permitido' }) };
  // Llamadas desde otro sitio: rechazadas (las del propio sitio vienen con su origen o sin origen)
  if (origin && !ORIGENES.includes(origin)) return { statusCode: 403, headers: H, body: JSON.stringify({ error: 'Origen no permitido' }) };
  if ((event.body || '').length > MAX_BODY) return { statusCode: 413, headers: H, body: JSON.stringify({ error: 'El pedido es demasiado grande (máx. 6 MB). Achicá las imágenes.' }) };

  // Solo usuarios logueados en Gráfica Pro
  const auth = hdr.authorization || hdr.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const email = await usuarioValido(token);
  if (!email) return { statusCode: 401, headers: H, body: JSON.stringify({ error: 'No autorizado: volvé a iniciar sesión en Gráfica Pro.' }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: H, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY en Netlify (Environment variables).' }) };
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'JSON inválido' }) }; }
  const pedido = String(body.pedido || '').slice(0, 8000);
  const c0 = (body.contexto && typeof body.contexto === 'object') ? body.contexto : {};
  const ctx = {
    tiposTrabajo: lista(c0.tiposTrabajo, 60, 60),
    maquinas: lista(c0.maquinas, 20, 40),
    maquinasExtra: (Array.isArray(c0.maquinasExtra) ? c0.maquinasExtra : []).slice(0, 10).map(m => ({ nombre: String((m && m.nombre) || '').slice(0, 40), a: +(m && m.a) || 0, b: +(m && m.b) || 0 })),
    materiales: lista(c0.materiales, 80, 80),
    laminados: lista(c0.laminados, 40, 60),
    procesos: lista(c0.procesos, 60, 60),
    estructuras: (Array.isArray(c0.estructuras) ? c0.estructuras : []).slice(0, 20).map(e => ({
      familia: String((e && e.familia) || '').slice(0, 40), tipoTrabajo: String((e && e.tipoTrabajo) || '').slice(0, 40),
      items: (Array.isArray(e && e.items) ? e.items : []).slice(0, 15).map(it => ({ nombre: String((it && it.nombre) || '').slice(0, 40), tipo: String((it && it.tipo) || '').slice(0, 20), opcional: !!(it && it.opcional), nota: String((it && it.nota) || '').slice(0, 80) }))
    }))
  };
  // Imágenes opcionales (captura de Excel, foto de una tabla, etc.)
  const okMedia = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const imagenes = (Array.isArray(body.imagenes) ? body.imagenes : [])
    .filter(im => im && typeof im.data === 'string' && okMedia.includes(im.mediaType) && im.data.length <= MAX_IMG)
    .slice(0, 4);
  if (Array.isArray(body.imagenes) && body.imagenes.length && !imagenes.length)
    return { statusCode: 413, headers: H, body: JSON.stringify({ error: 'Las imágenes son demasiado grandes o de un formato no admitido (JPG, PNG, GIF, WEBP; máx. 1,5 MB cada una).' }) };
  if (!pedido.trim() && !imagenes.length) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Falta el texto del pedido o una imagen' }) };

  const system = `Sos el asistente de una imprenta argentina (COMA Grupo Impresor). Te paso el pedido de un cliente (mail, WhatsApp o texto suelto) y devolvés SOLO un JSON válido, sin texto extra ni markdown, con esta forma exacta:
{"tipoTrabajo": "string", "items": [{"nombre": "string", "descripcion": "string", "cantidades": [numero], "medidaAbierta": {"ancho": numero, "alto": numero}, "medidaCerrada": "string", "material": "string", "gramaje": numero, "colores": "string", "maquina": "string", "procesos": ["string"]}]}

Reglas:
- tipoTrabajo: elegí uno de ${JSON.stringify(ctx.tiposTrabajo || [])} (el que mejor encaje). Si ninguno encaja, poné el más parecido.
- maquina: una de ${JSON.stringify(ctx.maquinas || [])}. Criterio: tiradas chicas o urgentes = Xerox (digital); pliego grande o tiradas grandes = SM74; intermedio = SM52.${(Array.isArray(ctx.maquinasExtra) && ctx.maquinasExtra.length) ? ' Además hay imprentas/máquinas externas: ' + ctx.maquinasExtra.map(m => String(m.nombre || '') + (m.b && m.a ? ' (pliego hasta ' + m.b + 'x' + m.a + ' cm)' : '')).join(', ') + '; sugerilas cuando el pliego no entra en las propias (ej. pliego 70x100) o la tirada es muy grande. El sistema igual compara el costo en todas y elige la más económica.' : ''}
- material y gramaje: sugerí lo habitual del rubro (ej.: estuches/tarjetones = Cartulina TX 250/300g; folletos/dípticos = Ilustración 150g; etiquetas = autoadhesivo). Materiales frecuentes: ${JSON.stringify(ctx.materiales || [])}.
- colores: formato "4/4", "4/1", "4/0", etc.
- medidaAbierta en cm (la que va a máquina, desplegada). medidaCerrada como texto (folleto "21x30"; bolsa/estuche "alto x ancho x fuelle/prof", ej. "20x20x10").
- cantidades: incluí TODAS las que pida el cliente (si pide varias tiradas, ponelas todas en el array).
- OPCIONES / ALTERNATIVAS: si el cliente pide cotizar opciones distintas del MISMO producto (colores "4/0 y 4/4", papeles o gramajes "200 y 250 g", acabado "mate o brillo", medidas, con o sin laminado…), devolvé UN ÍTEM POR CADA COMBINACIÓN de esas opciones, y cada ítem con TODAS las cantidades pedidas. Ej.: "4/0 y 4/4, Ilus 200 y 250 g, x 200/500" = 4 ítems (4/0 200 g · 4/4 200 g · 4/0 250 g · 4/4 250 g), cada uno con cantidades [200, 500]. En cada ítem, "colores", "material" y "gramaje" van con el valor de ESA opción (nunca "200/250" ni "4/0 o 4/4"), y el "nombre" lleva el producto + la opción para distinguirlos (ej. "Flyer Evento Golf 2026 · 4/0 · Ilus 200 g"); la "descripcion" también describe solo esa opción. Esto NO contradice la regla de abajo: las opciones son productos alternativos, no partes de un mismo producto.
- descripcion: una sola línea, clara y completa, como la escribiría un impresor: cantidad, medida, colores, material y terminaciones.
- LAMINADO / PLASTIFICADO: si el pedido menciona laminado, plastificado, OPP, soft touch, mate o brillo, va en el campo "laminado" (NO en procesos). Elegí el más parecido de este catálogo: ${JSON.stringify(ctx.laminados || [])}. Poné laminado.frenteYDorso=true si dice "f/d", "frente y dorso" o "ambas caras"; false si es solo frente.
- procesos: terminaciones detectadas. Mapeá al más parecido de este catálogo: ${JSON.stringify(ctx.procesos || [])}. Sinónimos importantes: "plegado" = "trazado" = "hendido" = "doblez" (es un proceso de doblado/plegado); "troquel"/"troquelado" = troquelado; "encolado"/"pegado" = pegado; "abrochado" = encuadernación abrochada; "anillado"/"espiralado" = anillado.
- PRODUCTO = UN SOLO ÍTEM: devolvé UN ítem de venta por producto terminado que compra el cliente. NUNCA dividas un trabajo compuesto (revista/catálogo, bolsa, estuche, block...) en varios ítems. Sus partes (tapa, interior, cuerpo, fondo, troquel, abrochado, armado, pegado...) son parte del COSTEO interno de ese único ítem, NO ítems de venta separados. Las terminaciones y el encuadernado (abrochado, doblado, troquelado, pegado, anillado...) van en "procesos". En "familia" poné el nombre de la familia SOLO si el producto ES de esa familia (una agenda no es una carpeta, un block no es una revista); si no encaja claramente, dejalo vacío. Catálogo de composiciones internas (te sirve de guía de qué lleva cada trabajo, NO para crear ítems): ${JSON.stringify(ctx.estructuras || [])}.
- REVISTA / CATÁLOGO: es UN solo ítem. Si la tapa y el interior van en el MISMO papel y gramaje (self-cover), tratala como una sola pieza: material = ese papel, gramaje = ese gramaje, colores = los de impresión (ej. "4/4"), y el abrochado/encuadernado en "procesos". Sólo si la tapa va en un papel o gramaje DISTINTO al interior, aclaralo en la descripción (ej. "tapa Ilus 300g / interior Ilus 150g"). Las páginas siempre son múltiplo de 4.
- PAGINADO (revista/catálogo): además completá el objeto "revista" con tapaPags (normalmente 4), intPags (cantidad de páginas interiores que pide el cliente), tapaColores e intColores (ej. "4/4"). El sistema usa esto para armar solo los pliegos: la tapa es 1 pliego y el interior sale de las páginas (cada hoja A3 plegada = 4 páginas A4, y en la SM74 entran 2 hojas por pliego; ej. 24 páginas → 6 hojas → 3 pliegos). No calcules vos los pliegos, solo pasá las páginas. Si tapa e interior van en papel o gramaje distinto, completá tapaMaterial/tapaGramaje e intMaterial/intGramaje (ej. tapa Ilustración 130 / interior Ilustración 115). Poné siempre medidaCerrada (ej. "14,85x21"). El abrochado/acaballado va en procesos como "abrochado" (no es puntillado).
- IMÁGENES / TABLAS: si viene una imagen (captura de Excel, foto, planilla), leela con cuidado. Si es una tabla, CADA FILA es un ítem separado: creá un item por cada fila (aunque sean muchos y muy parecidos, no los agrupes ni los resumas). Respetá las columnas (producto, medida, material, cantidad, colores, proceso). Transcribí números y medidas tal cual figuran. Si una fila tiene varias cantidades, poné todas en "cantidades".
- INSTRUCCIÓN GENERAL + IMAGEN: cuando el texto del usuario da una indicación general (ej. "todos estos en autoadhesivo con medio corte") y la imagen trae la lista, aplicá esa indicación a TODOS los ítems de la imagen (mismo material/proceso/máquina), salvo que una fila diga explícitamente otra cosa. El texto manda sobre lo que falte en la tabla. "medio corte" o "kiss cut" en autoadhesivo es un proceso.
- Si un dato no está en el pedido, poné tu mejor sugerencia técnica (un humano revisa y aprueba todo). No inventes datos del cliente (nombre, CUIT, etc.).`;

  // Structured output vía "tool use": la IA devuelve datos con este molde exacto (JSON garantizado).
  const tool = {
    name: 'cargar_cotizacion',
    description: 'Carga los datos interpretados del pedido del cliente en la cotización.',
    input_schema: {
      type: 'object',
      properties: {
        tipoTrabajo: { type: 'string' },
        familia: { type: 'string', description: 'Familia/estructura del catálogo si aplica (ej. Bolsa, Estuche, Revista). Vacío si es un producto simple.' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              descripcion: { type: 'string' },
              rol: { type: 'string', enum: ['pieza', 'insumo', 'proceso', 'manoobra'], description: 'Rol del item dentro de la estructura de la familia.' },
              cantidades: { type: 'array', items: { type: 'number' } },
              medidaAbierta: { type: 'object', properties: { ancho: { type: 'number' }, alto: { type: 'number' } } },
              medidaCerrada: { type: 'string' },
              material: { type: 'string' },
              gramaje: { type: 'number' },
              colores: { type: 'string' },
              maquina: { type: 'string' },
              laminado: { type: 'object', properties: { tipo: { type: 'string' }, frenteYDorso: { type: 'boolean' } } },
              revista: { type: 'object', description: 'Solo para revista/catálogo/cuaderno: paginado para armar los pliegos.', properties: { tapaPags: { type: 'number' }, intPags: { type: 'number' }, tapaColores: { type: 'string' }, intColores: { type: 'string' }, tapaMaterial: { type: 'string' }, tapaGramaje: { type: 'number' }, intMaterial: { type: 'string' }, intGramaje: { type: 'number' } } },
              procesos: { type: 'array', items: { type: 'string' } }
            },
            required: ['nombre', 'descripcion', 'cantidades']
          }
        }
      },
      required: ['items']
    }
  };

  // Tiempo máximo de espera de la IA (si no, la pantalla quedaba "Interpretando…" indefinidamente)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 8000, system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'cargar_cotizacion' },
        messages: [{ role: 'user', content: [
          ...imagenes.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })),
          { type: 'text', text: pedido.trim() || 'Interpretá el pedido del cliente a partir de la(s) imagen(es) adjunta(s) (por ejemplo una tabla de Excel con cantidades, medidas y materiales).' }
        ] }]
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn('Anthropic', r.status, data && data.error && data.error.type); // el detalle queda en el log de Netlify, no se muestra
      return { statusCode: 502, headers: H, body: JSON.stringify({ error: r.status === 429 ? 'La IA está saturada o se alcanzó el límite de uso. Probá en unos minutos.' : 'La IA no pudo procesar el pedido. Probá de nuevo.' }) };
    }
    if (data.stop_reason === 'max_tokens') return { statusCode: 502, headers: H, body: JSON.stringify({ error: 'El pedido es muy largo para procesarlo de una vez: dividilo en partes.' }) };
    const block = (data.content || []).find(c => c && c.type === 'tool_use');
    if (!block || !block.input) return { statusCode: 502, headers: H, body: JSON.stringify({ error: 'La IA no devolvió datos estructurados' }) };
    // Garantizar que items siempre sea una lista (el front recorre data.items)
    const out = block.input || {};
    if (!Array.isArray(out.items)) out.items = (out.items && typeof out.items === 'object') ? [out.items] : [];
    return { statusCode: 200, headers: H, body: JSON.stringify(out) };
  } catch (e) {
    console.warn('interpretar', e && e.name, e && e.message);
    if (e && e.name === 'AbortError') return { statusCode: 504, headers: H, body: JSON.stringify({ error: 'La IA tardó demasiado. Probá de nuevo o dividí el pedido.' }) };
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: 'Error interno al interpretar el pedido.' }) };
  } finally {
    clearTimeout(timer);
  }
};
