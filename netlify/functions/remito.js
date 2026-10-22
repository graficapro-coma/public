// Función serverless de Netlify: avisa por mail a administración cada entrega confirmada desde el celular
// (entregado / parcial / no entregado), con la foto del remito firmado como adjunto.
// La foto NO se guarda en ningún lado: pasa por acá y se va en el mail.
//
// Variables de entorno (Netlify → Site configuration → Environment variables):
//  - GMAIL_USER         = la cuenta que envía (ej. remito.coma@gmail.com)
//  - GMAIL_APP_PASSWORD = "contraseña de aplicación" de esa cuenta Gmail (16 letras; NO la contraseña normal)
//  - MAIL_DESTINO       = a quién llega (por defecto administracion@coma-grupoimpresor.com.ar; varios separados por coma)
//
// SEGURIDAD: igual que la IA — solo usuarios logueados en Gráfica Pro (token de Firebase), solo desde el propio sitio,
// el destinatario lo fija Netlify (no el navegador) y el texto del mail se arma acá con campos acotados.
const tls = require('tls');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBknhCg3HU7x1qa1hEgpSpt8yeA3QSBf9g'; // clave web pública de Firebase (no es secreta)
const ORIGENES = (process.env.ALLOWED_ORIGINS || 'https://graficapro-coma.netlify.app,http://localhost:5177,http://localhost:8888')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 5 * 1024 * 1024;   // 5 MB en total
const MAX_FOTO = 4 * 1024 * 1024;   // ~3 MB de imagen (base64)

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
    return u.email;
  } catch (e) { return null; }
}

// ---- Mail ----
const txt = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, n);
const largo = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').replace(/[<>]/g, '').trim().slice(0, n);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const enc = s => '=?UTF-8?B?' + b64(s) + '?=';
const lineas76 = s => s.replace(/.{1,76}/g, '$&\r\n');

function armarMail({ from, to, asunto, html, texto, foto }) {
  const b = 'gp_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const alt = b + '_alt';
  let m = '';
  m += 'From: ' + enc('Gráfica Pro · Entregas') + ' <' + from + '>\r\n';
  m += 'To: ' + to.join(', ') + '\r\n';
  m += 'Subject: ' + enc(asunto) + '\r\n';
  m += 'Date: ' + new Date().toUTCString().replace('GMT', '+0000') + '\r\n';
  m += 'MIME-Version: 1.0\r\n';
  m += 'Content-Type: multipart/mixed; boundary="' + b + '"\r\n\r\n';
  m += '--' + b + '\r\nContent-Type: multipart/alternative; boundary="' + alt + '"\r\n\r\n';
  m += '--' + alt + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + lineas76(b64(texto));
  m += '--' + alt + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + lineas76(b64(html));
  m += '--' + alt + '--\r\n';
  if (foto) {
    m += '--' + b + '\r\nContent-Type: ' + foto.mediaType + '; name="' + foto.nombre + '"\r\n';
    m += 'Content-Disposition: attachment; filename="' + foto.nombre + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n';
    m += lineas76(foto.data);
  }
  m += '--' + b + '--\r\n';
  return m;
}

// Conversación SMTP sobre un socket ya abierto (TLS directo al 465 de Gmail). Sin librerías externas.
function smtpConversacion(sock, { user, pass, from, to, raw }) {
  return new Promise((resolve, reject) => {
    let buf = '', esperando = null, fin = false;
    const timer = setTimeout(() => terminar(new Error('El servidor de mail no respondió a tiempo')), 25000);
    function terminar(err) {
      if (fin) return; fin = true; clearTimeout(timer);
      try { sock.end(); } catch (e) {}
      err ? reject(err) : resolve();
    }
    sock.setEncoding('utf8');
    sock.on('data', d => {
      buf += d;
      // Respuesta completa: última línea "NNN texto" (las intermedias son "NNN-texto")
      const ls = buf.split('\r\n').filter(Boolean);
      const ult = ls[ls.length - 1] || '';
      if (!/\r\n$/.test(buf) || !/^\d{3} /.test(ult)) return;
      const cod = +ult.slice(0, 3); buf = '';
      if (esperando) { const f = esperando; esperando = null; f(cod, ult); }
    });
    sock.on('error', e => terminar(e));
    sock.on('close', () => terminar(new Error('Se cortó la conexión con el servidor de mail')));
    const esperar = () => new Promise(r => { esperando = (c, l) => r({ c, l }); });
    const paso = async (cmd, ok) => {
      const p = esperar();
      if (cmd != null) sock.write(cmd + '\r\n');
      const { c, l } = await p;
      if (!ok.includes(c)) throw new Error('SMTP ' + l.slice(0, 120));
    };
    (async () => {
      await paso(null, [220]);
      await paso('EHLO graficapro', [250]);
      await paso('AUTH LOGIN', [334]);
      await paso(Buffer.from(user).toString('base64'), [334]);
      await paso(Buffer.from(pass).toString('base64'), [235]);
      await paso('MAIL FROM:<' + from + '>', [250]);
      for (const t of to) await paso('RCPT TO:<' + t + '>', [250, 251]);
      await paso('DATA', [354]);
      // Las líneas que empiezan con punto se duplican (regla de SMTP)
      await paso(raw.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
      try { sock.write('QUIT\r\n'); } catch (e) {}
      terminar();
    })().catch(e => terminar(e));
  });
}

async function enviarMail(datos) {
  const sock = tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
  return smtpConversacion(sock, datos);
}

const TIPOS = { total: 'ENTREGADO', parcial: 'ENTREGA PARCIAL', no: 'NO SE ENTREGÓ' };

function armarContenido(d, por) {
  const tipo = TIPOS[d.tipo];
  const filas = [
    ['OT', d.ot], ['Cliente', d.cliente], ['Trabajo', d.descripcion],
    ['Resultado', tipo],
    d.tipo === 'parcial' ? ['Cantidad entregada', d.cant + (d.cantTotal ? ' de ' + d.cantTotal : '') + (d.acumulado ? ' (acumulado ' + d.acumulado + ')' : '')] : null,
    d.tipo === 'total' && d.cantTotal ? ['Cantidad', d.cantTotal] : null,
    d.tipo === 'no' ? ['Motivo', d.motivo] : null,
    d.recibio ? ['Recibió', d.recibio] : null,
    d.direccion ? ['Dirección', d.direccion] : null,
    d.flete ? ['Flete', d.flete] : null,
    d.obs ? ['Observaciones', d.obs] : null,
    ['Fecha y hora', d.fechaHora],
    ['Confirmó', (d.quien ? d.quien + ' · ' : '') + por],
    ['Foto del remito', d.conFoto ? 'adjunta' : 'sin foto']
  ].filter(Boolean).filter(f => String(f[1] || '').trim());
  const color = d.tipo === 'total' ? '#1a7f37' : (d.tipo === 'parcial' ? '#c47d16' : '#a32d2d');
  const asunto = tipo + ' · ' + d.ot + ' · ' + d.cliente;
  const texto = filas.map(f => f[0] + ': ' + f[1]).join('\n');
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">'
    + '<div style="font-size:18px;font-weight:bold;color:' + color + ';margin-bottom:10px">' + esc(tipo) + ' · ' + esc(d.ot) + '</div>'
    + '<table style="border-collapse:collapse">' + filas.map(f => '<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">' + esc(f[0]) + '</td><td style="padding:4px 0;white-space:pre-wrap">' + esc(f[1]) + '</td></tr>').join('') + '</table>'
    + '<div style="margin-top:14px;font-size:11px;color:#999">Enviado automáticamente por Gráfica Pro. La foto no queda guardada en el sistema: este mail es el respaldo.</div></div>';
  return { asunto, texto, html };
}

exports.handler = async (event) => {
  const hdr = event.headers || {};
  const origin = hdr.origin || hdr.Origin || '';
  const H = { 'Content-Type': 'application/json', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin && ORIGENES.includes(origin)) H['Access-Control-Allow-Origin'] = origin;
  const resp = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Método no permitido' });
  if (origin && !ORIGENES.includes(origin)) return resp(403, { error: 'Origen no permitido' });
  if ((event.body || '').length > MAX_BODY) return resp(413, { error: 'La foto es demasiado grande.' });

  const auth = hdr.authorization || hdr.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const por = await usuarioValido(token);
  if (!por) return resp(401, { error: 'No autorizado: volvé a iniciar sesión en Gráfica Pro.' });

  const user = process.env.GMAIL_USER, pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) return resp(500, { error: 'Falta configurar GMAIL_USER y GMAIL_APP_PASSWORD en Netlify.' });
  const to = String(process.env.MAIL_DESTINO || 'administracion@coma-grupoimpresor.com.ar').split(',').map(s => s.trim()).filter(s => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)).slice(0, 5);
  if (!to.length) return resp(500, { error: 'MAIL_DESTINO no es un mail válido.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return resp(400, { error: 'JSON inválido' }); }
  const d = {
    tipo: ['total', 'parcial', 'no'].includes(b.tipo) ? b.tipo : '',
    ot: txt(b.ot, 30), cliente: txt(b.cliente, 120), descripcion: txt(b.descripcion, 200),
    cant: txt(b.cant, 20), cantTotal: txt(b.cantTotal, 20), acumulado: txt(b.acumulado, 20),
    motivo: txt(b.motivo, 120), recibio: txt(b.recibio, 80), direccion: txt(b.direccion, 200), flete: txt(b.flete, 60),
    quien: txt(b.quien, 60), obs: largo(b.obs, 800), fechaHora: txt(b.fechaHora, 40)
  };
  if (!d.tipo || !d.ot) return resp(400, { error: 'Faltan datos de la entrega.' });

  let foto = null;
  const f = b.foto;
  if (f) {
    const okMedia = ['image/jpeg', 'image/png', 'image/webp'];
    if (typeof f.data !== 'string' || !okMedia.includes(f.mediaType) || f.data.length > MAX_FOTO || !/^[A-Za-z0-9+/=]+$/.test(f.data))
      return resp(413, { error: 'La foto es demasiado grande o de un formato no admitido.' });
    const ext = f.mediaType === 'image/png' ? 'png' : (f.mediaType === 'image/webp' ? 'webp' : 'jpg');
    foto = { data: f.data, mediaType: f.mediaType, nombre: ('remito_' + d.ot + '_' + new Date().toISOString().slice(0, 10)).replace(/[^\w.-]+/g, '_') + '.' + ext };
  }
  d.conFoto = !!foto;

  const c = armarContenido(d, por);
  try {
    await enviarMail({ user, pass, from: user, to, raw: armarMail({ from: user, to, asunto: c.asunto, html: c.html, texto: c.texto, foto }) });
  } catch (e) {
    console.error('remito: error al enviar', e && e.message);
    const authErr = /SMTP 5(35|34)/.test(String(e && e.message));
    return resp(502, { error: authErr ? 'Gmail rechazó el usuario o la contraseña de aplicación (revisá GMAIL_USER / GMAIL_APP_PASSWORD en Netlify).' : 'No se pudo enviar el mail. Probá de nuevo en un rato.' });
  }
  return resp(200, { ok: true, a: to });
};

// Para las pruebas locales
exports._test = { armarMail, smtpConversacion, armarContenido };
