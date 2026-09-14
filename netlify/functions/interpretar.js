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
  if (!pedido.trim()) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Falta el texto del pedido' }) };

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
- procesos: terminaciones detectadas (troquelado, laminado, stamping, plegado, etc.).
- Si un dato no está en el pedido, poné tu mejor sugerencia técnica (un humano revisa y aprueba todo). No inventes datos del cliente (nombre, CUIT, etc.).`;

  // Structured output vía "tool use": la IA devuelve datos con este molde exacto (JSON garantizado).
  const tool = {
    name: 'cargar_cotizacion',
    description: 'Carga los datos interpretados del pedido del cliente en la cotización.',
    input_schema: {
      type: 'object',
      properties: {
        tipoTrabajo: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              descripcion: { type: 'string' },
              cantidades: { type: 'array', items: { type: 'number' } },
              medidaAbierta: { type: 'object', properties: { ancho: { type: 'number' }, alto: { type: 'number' } } },
              medidaCerrada: { type: 'string' },
              material: { type: 'string' },
              gramaje: { type: 'number' },
              colores: { type: 'string' },
              maquina: { type: 'string' },
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
        model, max_tokens: 2500, system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'cargar_cotizacion' },
        messages: [{ role: 'user', content: pedido }]
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
