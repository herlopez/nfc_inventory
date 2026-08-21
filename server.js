/* Servidor del inventario: sirve el front y expone la API protegida por contraseña.
   Nada del inventario sale sin una sesión válida. */

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { q, uno, todos, inicializar, filaAProducto, pool } from './db.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

const PUERTO = Number(process.env.PORT) || 3000;
const DIAS_SESION = Number(process.env.SESSION_DIAS) || 30;
const COOKIE_SEGURA = process.env.COOKIE_SECURE === '1';
const COOKIE = 'sid';

// Hash de descarte: se compara contra él cuando el usuario no existe, para que
// un atacante no distinga "usuario inválido" de "contraseña inválida" por el tiempo.
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', 12);

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

/* ---------- cabeceras de seguridad ---------- */

// Las páginas llevan <script> y style= en línea, así que 'unsafe-inline' es
// necesario; aun así la CSP corta marcos, objetos, base-uri y conexiones fuera
// del propio origen. Las imágenes admiten https: porque el campo `imagen`
// puede apuntar a cualquier foto externa, y jsdelivr sirve la librería del QR.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set('Content-Security-Policy', CSP);
  res.set('X-Content-Type-Options', 'nosniff');   // que nadie adivine el tipo de las fotos
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');      // no filtrar IDs de producto a terceros
  if (COOKIE_SEGURA) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

/* ---------- sesiones ---------- */

const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

async function limpiarSesiones() {
  try {
    await q('DELETE FROM sesiones WHERE expira <= now()');
  } catch (e) {
    console.error('No se pudieron limpiar las sesiones:', e.message);
  }
}
setInterval(limpiarSesiones, 60 * 60 * 1000).unref();

async function crearSesion(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sesiones (token, usuario_id, expira)
           VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), usuarioId, DIAS_SESION]);
  return token;
}

function leerCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => {
      const i = c.indexOf('=');
      if (i < 0) return ['', ''];
      let valor = c.slice(i + 1).trim();
      try { valor = decodeURIComponent(valor); } catch { /* se deja tal cual */ }
      return [c.slice(0, i).trim(), valor];
    }));
}

async function usuarioDeCookie(req) {
  const token = leerCookies(req)[COOKIE];
  if (!token) return null;

  return await uno(`
    SELECT u.id, u.nombre, u.usuario, u.email, u.rol
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = $1 AND s.expira > now()`, [hashToken(token)]);
}

function ponerCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SEGURA,
    maxAge: DIAS_SESION * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/* ---------- freno a la fuerza bruta ---------- */

const intentos = new Map(); // clave -> { n, hasta }
const MAX_INTENTOS = 8;   // por usuario concreto
const MAX_POR_IP = 30;    // por IP, contra el rociado de muchos usuarios
const VENTANA_MS = 15 * 60 * 1000;

function bloqueado(clave, max) {
  const r = intentos.get(clave);
  if (!r) return false;
  if (Date.now() > r.hasta) { intentos.delete(clave); return false; }
  return r.n >= max;
}

function fallo(clave) {
  const r = intentos.get(clave);
  if (!r || Date.now() > r.hasta) intentos.set(clave, { n: 1, hasta: Date.now() + VENTANA_MS });
  else r.n++;
}

// El Map no puede crecer sin límite: se purga lo ya vencido cada cierto tiempo.
setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of intentos) if (ahora > v.hasta) intentos.delete(k);
}, VENTANA_MS).unref();

/* ---------- rutas públicas ---------- */

app.use('/assets', express.static(path.join(raiz, 'public', 'assets'), { maxAge: '1h' }));

/** Solo admite destinos internos: evita que ?next= mande a otro sitio. */
const destinoSeguro = v =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/';

app.get('/login', async (req, res) => {
  if (await usuarioDeCookie(req)) return res.redirect(destinoSeguro(req.query.next));
  res.sendFile(path.join(raiz, 'public', 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const identidad = String(req.body?.usuario ?? '').trim();
  const password = String(req.body?.password ?? '');
  const clave = `${req.ip}|${identidad.toLowerCase()}`;
  const claveIp = `ip|${req.ip}`;

  if (bloqueado(clave, MAX_INTENTOS) || bloqueado(claveIp, MAX_POR_IP)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  }
  if (!identidad || !password) {
    return res.status(400).json({ error: 'Escribe usuario y contraseña.' });
  }

  const u = await uno(
    'SELECT * FROM usuarios WHERE lower(usuario) = lower($1) OR lower(email) = lower($1)',
    [identidad]);
  const ok = await bcrypt.compare(password, u?.password_hash ?? HASH_FALSO);

  if (!u || !ok) {
    fallo(clave);
    fallo(claveIp);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  intentos.delete(clave);
  ponerCookie(res, await crearSesion(u.id));
  res.json({ ok: true, usuario: { nombre: u.nombre, usuario: u.usuario, email: u.email } });
});

app.post('/api/logout', async (req, res) => {
  const token = leerCookies(req)[COOKIE];
  if (token) await q('DELETE FROM sesiones WHERE token = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ---------- de aquí en adelante, todo exige sesión ---------- */

app.use(async (req, res, next) => {
  const u = await usuarioDeCookie(req);
  if (u) { req.usuario = u; return next(); }

  if (req.path.startsWith('/api/') || req.get('accept')?.includes('application/json')) {
    return res.status(401).json({ error: 'Sesión requerida', login: '/login' });
  }
  const destino = req.originalUrl && req.originalUrl !== '/' ? req.originalUrl : '';
  res.redirect('/login' + (destino ? `?next=${encodeURIComponent(destino)}` : ''));
});

app.get('/api/yo', (req, res) => res.json({ usuario: req.usuario }));

const config = () => ({ titulo: 'Inventario NFC', moneda: process.env.MONEDA || 'USD' });

/* La foto subida no vive en la columna `imagen` (esa guarda URLs externas):
   se sirve por su propia ruta, con la versión en la query para romper la caché. */
const urlFoto = (id, version) =>
  `/api/productos/${encodeURIComponent(id)}/imagen?v=${version}`;

const conFoto = (producto, version) =>
  ({ ...producto, foto: version ? urlFoto(producto.id, version) : null });

app.get('/api/productos', async (req, res) => {
  const filas = await todos('SELECT * FROM productos ORDER BY id');
  const versiones = new Map(
    (await todos('SELECT producto_id, version FROM imagenes')).map(r => [r.producto_id, r.version]));

  res.json({
    config: config(),
    usuario: req.usuario,
    productos: filas.map(f => conFoto(filaAProducto(f), versiones.get(f.id))),
  });
});

app.get('/api/productos/:id', async (req, res) => {
  const fila = await uno(
    'SELECT * FROM productos WHERE lower(id) = lower($1) OR lower(sku) = lower($1)',
    [req.params.id]);
  if (!fila) return res.status(404).json({ error: 'Producto no encontrado', id: req.params.id });

  const v = await uno('SELECT version FROM imagenes WHERE producto_id = $1', [fila.id]);
  res.json({
    config: config(),
    usuario: req.usuario,
    producto: conFoto(filaAProducto(fila), v?.version),
  });
});

/* ---------- foto del producto ---------- */

const MIMES = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  'image/webp': null, // se comprueba aparte: "RIFF"…"WEBP"
};
const MAX_FOTO = 5 * 1024 * 1024;

/** No basta el Content-Type: comprobamos que los primeros bytes sean los de una imagen. */
function pareceImagen(buf, mime) {
  if (mime === 'image/webp') {
    return buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  const firma = MIMES[mime];
  return firma ? firma.every((b, i) => buf[i] === b) : false;
}

app.get('/api/productos/:id/imagen', async (req, res) => {
  const fila = await uno(
    'SELECT mime, bytes, version FROM imagenes WHERE lower(producto_id) = lower($1)',
    [req.params.id]);
  if (!fila) return res.status(404).json({ error: 'Ese producto no tiene foto.' });

  res.set('Content-Type', fila.mime);
  res.set('ETag', `"${fila.version}"`);
  // Privada: la cachea el navegador de quien tiene sesión, nunca un proxy compartido.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.get('if-none-match') === `"${fila.version}"`) return res.status(304).end();
  res.send(fila.bytes);
});

/* ---------- alta / edición / baja (solo rol admin) ---------- */

function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Tu usuario no puede editar el inventario.' });
  }
  next();
}

app.post('/api/productos/:id/imagen',
  soloAdmin,
  express.raw({ type: Object.keys(MIMES), limit: MAX_FOTO }),
  async (req, res) => {
    const producto = await uno('SELECT id FROM productos WHERE lower(id) = lower($1)',
      [req.params.id]);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const mime = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.isBuffer(req.body) ? req.body : null;

    // El tipo se mira antes que el cuerpo: con un Content-Type no admitido
    // express.raw ni siquiera lo lee, y el error debe decir por qué.
    if (!(mime in MIMES)) {
      return res.status(415).json({ error: 'Formato no admitido: usa JPEG, PNG o WebP.' });
    }
    if (!buf || buf.length === 0) {
      return res.status(400).json({ error: 'Manda la imagen en el cuerpo, con su Content-Type.' });
    }
    if (!pareceImagen(buf, mime)) {
      return res.status(400).json({ error: 'El archivo no es una imagen válida.' });
    }

    const version = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
    await q(`INSERT INTO imagenes (producto_id, mime, bytes, version)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (producto_id) DO UPDATE
             SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes,
                 version = EXCLUDED.version, creada = now()`,
      [producto.id, mime, buf, version]);

    res.status(201).json({ foto: urlFoto(producto.id, version), bytes: buf.length });
  });

app.delete('/api/productos/:id/imagen', soloAdmin, async (req, res) => {
  const r = await q('DELETE FROM imagenes WHERE lower(producto_id) = lower($1)', [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Ese producto no tiene foto.' });
  res.json({ ok: true });
});

const CAMPOS_TEXTO = ['nombre', 'sku', 'categoria', 'descripcion', 'imagen',
                      'ubicacion', 'estado', 'actualizado', 'notas'];

/** Normaliza y valida el cuerpo; devuelve { datos } o { error }. */
function validarProducto(body, { id }) {
  const texto = (v, max) => {
    const s = String(v ?? '').trim();
    return s === '' ? null : s.slice(0, max);
  };

  if (id !== undefined) {
    // El ID va impreso en los tags: solo caracteres seguros en una URL.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
      return { error: 'El ID solo admite letras, números, punto, guion y guion bajo (máx. 64).' };
    }
  }

  const nombre = texto(body?.nombre, 200);
  if (!nombre) return { error: 'El nombre es obligatorio.' };

  const num = (v, entero) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = entero ? Number.parseInt(v, 10) : Number(v);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return n;
  };

  const stock = num(body?.stock, true);
  if (Number.isNaN(stock)) return { error: 'El stock debe ser un número entero de 0 en adelante.' };

  const precio = num(body?.precio, false);
  if (Number.isNaN(precio)) return { error: 'El precio debe ser un número de 0 en adelante.' };
  if (precio !== null && precio > 99_999_999) {
    return { error: 'El precio es demasiado grande.' };
  }

  const imagen = texto(body?.imagen, 500);
  if (imagen && !/^https?:\/\//i.test(imagen)) {
    return { error: 'La imagen debe ser una URL que empiece por http:// o https://' };
  }

  const extra = {};
  for (const [k, v] of Object.entries(body?.extra ?? {})) {
    const clave = String(k).trim().slice(0, 60);
    const valor = String(v ?? '').trim().slice(0, 200);
    if (clave && valor && Object.keys(extra).length < 30) extra[clave] = valor;
  }

  const datos = { nombre, imagen, stock, precio, extra: JSON.stringify(extra) };
  for (const c of CAMPOS_TEXTO) {
    if (c === 'nombre' || c === 'imagen') continue;
    datos[c] = texto(body?.[c], c === 'descripcion' || c === 'notas' ? 2000 : 200);
  }
  // Sello de última modificación, salvo que lo manden a mano.
  datos.actualizado = datos.actualizado || new Date().toISOString().slice(0, 10);

  return { datos };
}

const VALORES = d => [d.nombre, d.sku, d.categoria, d.descripcion, d.imagen, d.ubicacion,
                      d.stock, d.precio, d.estado, d.actualizado, d.notas, d.extra];

app.post('/api/productos', soloAdmin, async (req, res) => {
  const id = String(req.body?.id ?? '').trim();
  const { datos, error } = validarProducto(req.body, { id });
  if (error) return res.status(400).json({ error });

  if (await uno('SELECT 1 FROM productos WHERE lower(id) = lower($1)', [id])) {
    return res.status(409).json({ error: `Ya existe un producto con el ID ${id}.` });
  }

  const { rows } = await q(
    `INSERT INTO productos (id, nombre, sku, categoria, descripcion, imagen, ubicacion,
                            stock, precio, estado, actualizado, notas, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     RETURNING *`, [id, ...VALORES(datos)]);

  res.status(201).json({ producto: conFoto(filaAProducto(rows[0]), null) });
});

app.put('/api/productos/:id', soloAdmin, async (req, res) => {
  // El ID no se cambia: los tags ya grabados apuntan a él.
  const actual = await uno('SELECT id FROM productos WHERE lower(id) = lower($1)', [req.params.id]);
  if (!actual) return res.status(404).json({ error: 'Producto no encontrado', id: req.params.id });

  const { datos, error } = validarProducto(req.body, {});
  if (error) return res.status(400).json({ error });

  const { rows } = await q(
    `UPDATE productos SET nombre = $2, sku = $3, categoria = $4, descripcion = $5,
       imagen = $6, ubicacion = $7, stock = $8, precio = $9, estado = $10,
       actualizado = $11, notas = $12, extra = $13::jsonb
     WHERE id = $1 RETURNING *`, [actual.id, ...VALORES(datos)]);

  const v = await uno('SELECT version FROM imagenes WHERE producto_id = $1', [actual.id]);
  res.json({ producto: conFoto(filaAProducto(rows[0]), v?.version) });
});

app.delete('/api/productos/:id', soloAdmin, async (req, res) => {
  const r = await q('DELETE FROM productos WHERE lower(id) = lower($1)', [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ ok: true, id: req.params.id });
});

// Link corto para los tags: /p/P-001
app.get('/p/:id', (req, res) => res.redirect('/?id=' + encodeURIComponent(req.params.id)));

app.use(express.static(path.join(raiz, 'public')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.status(404).sendFile(path.join(raiz, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El contenido enviado es demasiado grande.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

/* ---------- arranque ---------- */

try {
  await inicializar();
  await limpiarSesiones();
} catch (e) {
  console.error('No se pudo conectar a PostgreSQL:', e.message);
  console.error('Revisa DATABASE_URL en .env');
  process.exit(1);
}

const { total } = await uno('SELECT COUNT(*)::int AS total FROM usuarios');
if (total === 0) console.warn('⚠  No hay usuarios. Ejecuta: npm run seed');

const servidor = app.listen(PUERTO, () => {
  console.log(`Inventario en http://localhost:${PUERTO}  (${total} usuario/s, PostgreSQL)`);
});

for (const señal of ['SIGINT', 'SIGTERM']) {
  process.on(señal, () => servidor.close(() => pool.end().then(() => process.exit(0))));
}
