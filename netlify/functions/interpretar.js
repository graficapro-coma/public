// Función serverless de Netlify: interpreta el pedido de un cliente con Claude (Anthropic)
// y devuelve un JSON estructurado para pre-cargar la cotización.
// La clave NUNCA está en el código: se lee de la variable de entorno ANTHROPIC_API_KEY (Netlify → Environment variables).
exports.handler = async (event) => {
  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: JSON.stringify({ error: 'Método no permitido' }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: H, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY en Netlify (Environment variables).' }) };
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'JSON inválido' }) }; }
  const pedido = String(body.pedido || '').slice(0, 8000);
  const ctx = body.contexto || {};
  // Imágenes opcionales (captura de Excel, foto de una tabla, etc.)
  const okMedia = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const imagenes = (Array.isArray(body.imagenes) ? body.imagenes : [])
    .filter(im => im && typeof im.data === 'string' && okMedia.includes(im.mediaType))
    .slice(0, 4);
  if (!pedido.trim() && !imagenes.length) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Falta el texto del pedido o una imagen' }) };

  const system = `Sos el asistente de una imprenta argentina (COMA Grupo Impresor). Te paso el pedido de un cliente (mail, WhatsApp o texto suelto) y devolvés SOLO un JSON válido, sin texto extra ni markdown, con esta forma exacta:
{"tipoTrabajo": "string", "items": [{"nombre": "string", "descripcion": "string", "cantidades": [numero], "medidaAbierta": {"ancho": numero, "alto": numero}, "medidaCerrada": "string", "material": "string", "gramaje": numero, "colores": "string", "maquina": "string", "procesos": ["string"]}]}

Reglas:
- tipoTrabajo: elegí uno de ${JSON.stringify(ctx.tiposTrabajo || [])} (el que mejor encaje). Si ninguno encaja, poné el más parecido.
- maquina: una de ${JSON.stringify(ctx.maquinas || [])}. Criterio: tiradas chicas o urgentes = Xerox (digital); pliego grande o tiradas grandes = SM74; intermedio = SM52.
- material y gramaje: sugerí lo habitual del rubro (ej.: estuches/tarjetones = Cartulina TX 250/300g; folletos/dípticos = Ilustración 150g; etiquetas = autoadhesivo). Materiales frecuentes: ${JSON.stringify(ctx.materiales || [])}.
- colores: formato "4/4", "4/1", "4/0", etc.
- medidaAbierta en cm (la que va a máquina, desplegada). medidaCerrada como texto (folleto "21x30"; bolsa/estuche "alto x ancho x fuelle/prof", ej. "20x20x10").
- cantidades: incluí TODAS las que pida el cliente (si pide varias tiradas, ponelas todas en el array).
- descripcion: una sola línea, clara y completa, como la escribiría un impresor: cantidad, medida, colores, material y terminaciones.
- LAMINADO / PLASTIFICADO: si el pedido menciona laminado, plastificado, OPP, soft touch, mate o brillo, va en el campo "laminado" (NO en procesos). Elegí el más parecido de este catálogo: ${JSON.stringify(ctx.laminados || [])}. Poné laminado.frenteYDorso=true si dice "f/d", "frente y dorso" o "ambas caras"; false si es solo frente.
- procesos: terminaciones detectadas. Mapeá al más parecido de este catálogo: ${JSON.stringify(ctx.procesos || [])}. Sinónimos importantes: "plegado" = "trazado" = "hendido" = "doblez" (es un proceso de doblado/plegado); "troquel"/"troquelado" = troquelado; "encolado"/"pegado" = pegado; "abrochado" = encuadernación abrochada; "anillado"/"espiralado" = anillado.
- PRODUCTO = UN SOLO ÍTEM: devolvé UN ítem de venta por producto terminado que compra el cliente. NUNCA dividas un trabajo compuesto (revista/catálogo, bolsa, estuche, block...) en varios ítems. Sus partes (tapa, interior, cuerpo, fondo, troquel, abrochado, armado, pegado...) son parte del COSTEO interno de ese único ítem, NO ítems de venta separados. Las terminaciones y el encuadernado (abrochado, doblado, troquelado, pegado, anillado...) van en "procesos". En "familia" poné el nombre de la familia si el pedido encaja con este catálogo de composiciones internas (te sirve de guía de qué lleva cada trabajo, NO para crear ítems): ${JSON.stringify(ctx.estructuras || [])}.
- REVISTA / CATÁLOGO: es UN solo ítem. Si la tapa y el interior van en el MISMO papel y gramaje (self-cover), tratala como una sola pieza: material = ese papel, gramaje = ese gramaje, colores = los de impresión (ej. "4/4"), y el abrochado/encuadernado en "procesos". Sólo si la tapa va en un papel o gramaje DISTINTO al interior, aclaralo en la descripción (ej. "tapa Ilus 300g / interior Ilus 150g"). Las páginas siempre son múltiplo de 4.
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
              procesos: { type: 'array', items: { type: 'string' } }
            },
            required: ['nombre', 'descripcion', 'cantidades']
          }
        }
      },
      required: ['items']
    }
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
    const data = await r.json();
    if (!r.ok) return { statusCode: 502, headers: H, body: JSON.stringify({ error: (data && data.error && data.error.message) || 'Error de la IA' }) };
    const block = (data.content || []).find(c => c && c.type === 'tool_use');
    if (!block || !block.input) return { statusCode: 502, headers: H, body: JSON.stringify({ error: 'La IA no devolvió datos estructurados' }) };
    return { statusCode: 200, headers: H, body: JSON.stringify(block.input) };
  } catch (e) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
