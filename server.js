/* Servidor del inventario: sirve el front y expone la API protegida por contraseña.
   Nada del inventario sale sin una sesión válida. */

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { db, filaAProducto } from './db.js';

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
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

/* ---------- sesiones ---------- */

const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function limpiarSesiones() {
  db.prepare("DELETE FROM sesiones WHERE expira <= datetime('now')").run();
}
limpiarSesiones();
setInterval(limpiarSesiones, 60 * 60 * 1000).unref();

function crearSesion(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sesiones (token, usuario_id, expira)
              VALUES (?, ?, datetime('now', ?))`)
    .run(hashToken(token), usuarioId, `+${DIAS_SESION} days`);
  return token;
}

function usuarioDeCookie(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => {
      const i = c.indexOf('=');
      return i < 0 ? ['', ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }));
  const token = cookies[COOKIE];
  if (!token) return null;

  return db.prepare(`
    SELECT u.id, u.nombre, u.usuario, u.email, u.rol
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira > datetime('now')`).get(hashToken(token)) || null;
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
const MAX_INTENTOS = 8;
const VENTANA_MS = 15 * 60 * 1000;

function bloqueado(clave) {
  const r = intentos.get(clave);
  if (!r) return false;
  if (Date.now() > r.hasta) { intentos.delete(clave); return false; }
  return r.n >= MAX_INTENTOS;
}

function fallo(clave) {
  const r = intentos.get(clave);
  if (!r || Date.now() > r.hasta) intentos.set(clave, { n: 1, hasta: Date.now() + VENTANA_MS });
  else r.n++;
}

/* ---------- rutas públicas ---------- */

app.use('/assets', express.static(path.join(raiz, 'public', 'assets'), { maxAge: '1h' }));

app.get('/login', (req, res) => {
  if (usuarioDeCookie(req)) return res.redirect(req.query.next || '/');
  res.sendFile(path.join(raiz, 'public', 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const identidad = String(req.body?.usuario ?? '').trim();
  const password = String(req.body?.password ?? '');
  const clave = `${req.ip}|${identidad.toLowerCase()}`;

  if (bloqueado(clave)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  }
  if (!identidad || !password) {
    return res.status(400).json({ error: 'Escribe usuario y contraseña.' });
  }

  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? OR email = ?')
    .get(identidad, identidad);
  const ok = await bcrypt.compare(password, u?.password_hash ?? HASH_FALSO);

  if (!u || !ok) {
    fallo(clave);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  intentos.delete(clave);
  ponerCookie(res, crearSesion(u.id));
  res.json({ ok: true, usuario: { nombre: u.nombre, usuario: u.usuario, email: u.email } });
});

app.post('/api/logout', (req, res) => {
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  if (token) {
    db.prepare('DELETE FROM sesiones WHERE token = ?').run(hashToken(decodeURIComponent(token)));
  }
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ---------- de aquí en adelante, todo exige sesión ---------- */

app.use((req, res, next) => {
  const u = usuarioDeCookie(req);
  if (u) { req.usuario = u; return next(); }

  if (req.path.startsWith('/api/') || req.get('accept')?.includes('application/json')) {
    return res.status(401).json({ error: 'Sesión requerida', login: '/login' });
  }
  const destino = req.originalUrl && req.originalUrl !== '/' ? req.originalUrl : '';
  res.redirect('/login' + (destino ? `?next=${encodeURIComponent(destino)}` : ''));
});

app.get('/api/yo', (req, res) => res.json({ usuario: req.usuario }));

app.get('/api/productos', (req, res) => {
  const filas = db.prepare('SELECT * FROM productos ORDER BY id').all();
  res.json({
    config: { titulo: 'Inventario NFC', moneda: process.env.MONEDA || 'USD' },
    usuario: req.usuario,
    productos: filas.map(filaAProducto),
  });
});

app.get('/api/productos/:id', (req, res) => {
  const id = req.params.id;
  const fila = db.prepare(`SELECT * FROM productos
                           WHERE id = ? COLLATE NOCASE OR sku = ? COLLATE NOCASE`).get(id, id);
  if (!fila) return res.status(404).json({ error: 'Producto no encontrado', id });
  res.json({
    config: { titulo: 'Inventario NFC', moneda: process.env.MONEDA || 'USD' },
    usuario: req.usuario,
    producto: filaAProducto(fila),
  });
});

/* ---------- alta / edición / baja (solo rol admin) ---------- */

function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Tu usuario no puede editar el inventario.' });
  }
  next();
}

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

  const imagen = texto(body?.imagen, 500);
  if (imagen && !/^https?:\/\//i.test(imagen)) {
    return { error: 'La imagen debe ser una URL que empiece por http:// o https://' };
  }

  const extra = {};
  for (const [k, v] of Object.entries(body?.extra ?? {})) {
    const clave = String(k).trim().slice(0, 60);
    const valor = String(v ?? '').trim().slice(0, 200);
    if (clave && valor) extra[clave] = valor;
  }

  const datos = { nombre, imagen, stock, precio, extra: JSON.stringify(extra) };
  for (const c of CAMPOS_TEXTO) {
    if (c === 'nombre' || c === 'imagen') continue;
    datos[c] = texto(body?.[c], c === 'descripcion' || c === 'notas' ? 2000 : 200);
  }
  // Sello de última modificación, salvo que lo manden a mano.
  datos.actualizado = datos.actualizado
    || new Date().toISOString().slice(0, 10);

  return { datos };
}

app.post('/api/productos', soloAdmin, (req, res) => {
  const id = String(req.body?.id ?? '').trim();
  const { datos, error } = validarProducto(req.body, { id });
  if (error) return res.status(400).json({ error });

  if (db.prepare('SELECT 1 FROM productos WHERE id = ? COLLATE NOCASE').get(id)) {
    return res.status(409).json({ error: `Ya existe un producto con el ID ${id}.` });
  }

  db.prepare(`INSERT INTO productos (id, nombre, sku, categoria, descripcion, imagen, ubicacion,
                                     stock, precio, estado, actualizado, notas, extra)
              VALUES (:id, :nombre, :sku, :categoria, :descripcion, :imagen, :ubicacion,
                      :stock, :precio, :estado, :actualizado, :notas, :extra)`)
    .run({ id, ...datos });

  const fila = db.prepare('SELECT * FROM productos WHERE id = ?').get(id);
  res.status(201).json({ producto: filaAProducto(fila) });
});

app.put('/api/productos/:id', soloAdmin, (req, res) => {
  // El ID no se cambia: los tags ya grabados apuntan a él.
  const fila = db.prepare('SELECT * FROM productos WHERE id = ? COLLATE NOCASE').get(req.params.id);
  if (!fila) return res.status(404).json({ error: 'Producto no encontrado', id: req.params.id });

  const { datos, error } = validarProducto(req.body, {});
  if (error) return res.status(400).json({ error });

  db.prepare(`UPDATE productos SET nombre = :nombre, sku = :sku, categoria = :categoria,
                descripcion = :descripcion, imagen = :imagen, ubicacion = :ubicacion,
                stock = :stock, precio = :precio, estado = :estado,
                actualizado = :actualizado, notas = :notas, extra = :extra
              WHERE id = :id`)
    .run({ id: fila.id, ...datos });

  res.json({ producto: filaAProducto(db.prepare('SELECT * FROM productos WHERE id = ?').get(fila.id)) });
});

app.delete('/api/productos/:id', soloAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM productos WHERE id = ? COLLATE NOCASE').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ ok: true, id: req.params.id });
});

// Link corto para los tags: /p/P-001
app.get('/p/:id', (req, res) => res.redirect('/?id=' + encodeURIComponent(req.params.id)));

app.use(express.static(path.join(raiz, 'public')));

app.use((req, res) => res.status(404).sendFile(path.join(raiz, 'public', 'index.html')));

app.listen(PUERTO, () => {
  const usuarios = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (usuarios === 0) console.warn('⚠  No hay usuarios. Ejecuta: npm run seed');
  console.log(`Inventario en http://localhost:${PUERTO}  (${usuarios} usuario/s)`);
});
