// Función serverless de Netlify: interpreta el pedido de un cliente con Claude (Anthropic)
// y devuelve un JSON estructurado para pre-cargar la cotización.
// La clave NUNCA está en el código: se lee de la variable de entorno ANTHROPIC_API_KEY (Netlify → Environment variables).
exports.handler = async (event) => {
  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: JSON.stringify({ error: 'Método no permitido' }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: H, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY en Netlify (Environment variables).' }) };
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

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

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1800, system, messages: [{ role: 'user', content: pedido }] })
    });
    const data = await r.json();
    if (!r.ok) return { statusCode: 502, headers: H, body: JSON.stringify({ error: (data && data.error && data.error.message) || 'Error de la IA' }) };
    let txt = (data.content && data.content[0] && data.content[0].text) || '';
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = JSON.parse(m ? m[0] : txt); } catch (e) { return { statusCode: 502, headers: H, body: JSON.stringify({ error: 'La IA no devolvió un JSON válido', raw: txt.slice(0, 500) }) }; }
    return { statusCode: 200, headers: H, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
