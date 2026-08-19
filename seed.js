/* Carga inicial de la base de datos y gestión de usuarios.
 *
 *   npm run seed                                  -> crea el usuario inicial y los productos
 *   npm run usuario -- --usuario ana --nombre "Ana" --email a@x.com --password secreta
 *   npm run usuario -- --usuario hlopez --password nuevaClave     (cambia la contraseña)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const COSTO_BCRYPT = 12;

const USUARIO_INICIAL = {
  nombre: 'hernan',
  usuario: 'hlopez',
  email: 'herlopezm@gmail.com',
  password: '123123123',
};

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1]?.startsWith('--') ? true : a[++i];
  }
  return out;
}

export function guardarUsuario({ nombre, usuario, email, password, rol = 'admin' }) {
  const existente = db.prepare('SELECT * FROM usuarios WHERE usuario = ? OR email = ?')
    .get(usuario, email);
  const hash = bcrypt.hashSync(password, COSTO_BCRYPT);

  if (existente) {
    db.prepare(`UPDATE usuarios SET nombre = ?, usuario = ?, email = ?, password_hash = ?, rol = ?
                WHERE id = ?`)
      .run(nombre ?? existente.nombre, usuario ?? existente.usuario,
           email ?? existente.email, hash, rol ?? existente.rol, existente.id);
    // Al cambiar la contraseña se cierran las sesiones abiertas de ese usuario.
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(existente.id);
    return { accion: 'actualizado', usuario: usuario ?? existente.usuario };
  }

  db.prepare(`INSERT INTO usuarios (nombre, usuario, email, password_hash, rol)
              VALUES (?, ?, ?, ?, ?)`)
    .run(nombre, usuario, email, hash, rol);
  return { accion: 'creado', usuario };
}

function cargarProductos() {
  const ruta = path.join(raiz, 'data', 'productos.json');
  if (!fs.existsSync(ruta)) return 0;

  const { productos = [] } = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const insertar = db.prepare(`
    INSERT INTO productos (id, nombre, sku, categoria, descripcion, imagen, ubicacion,
                           stock, precio, estado, actualizado, notas, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);

  let n = 0;
  for (const p of productos) {
    const r = insertar.run(
      p.id, p.nombre, p.sku ?? null, p.categoria ?? null, p.descripcion ?? null,
      p.imagen ?? null, p.ubicacion ?? null,
      p.stock ?? null, p.precio ?? null, p.estado ?? null,
      p.actualizado ?? null, p.notas ?? null, JSON.stringify(p.extra ?? {}));
    n += r.changes;
  }
  return n;
}

const a = args();

if (a.usuario || a.password) {
  const base = db.prepare('SELECT * FROM usuarios WHERE usuario = ? OR email = ?')
    .get(a.usuario ?? '', a.email ?? '');
  if (!a.password) {
    console.error('Falta --password');
    process.exit(1);
  }
  if (!base && !(a.nombre && a.email)) {
    console.error('Usuario nuevo: se requieren --nombre, --usuario, --email y --password');
    process.exit(1);
  }
  const r = guardarUsuario({
    nombre: a.nombre ?? base?.nombre,
    usuario: a.usuario ?? base?.usuario,
    email: a.email ?? base?.email,
    password: a.password,
    rol: a.rol ?? base?.rol ?? 'admin',
  });
  console.log(`Usuario ${r.usuario} ${r.accion}.`);
} else {
  const ya = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (ya === 0) {
    guardarUsuario(USUARIO_INICIAL);
    console.log(`Usuario inicial creado: ${USUARIO_INICIAL.usuario} / ${USUARIO_INICIAL.email}`);
    console.log('   Contraseña: la de la carga inicial. Cámbiala con:');
    console.log('   npm run usuario -- --usuario hlopez --password TU_NUEVA_CLAVE');
  } else {
    console.log(`Ya hay ${ya} usuario(s); no se toca ninguno.`);
  }

  const n = cargarProductos();
  const total = db.prepare('SELECT COUNT(*) AS n FROM productos').get().n;
  console.log(`Productos: ${n} nuevo(s), ${total} en total.`);
}
