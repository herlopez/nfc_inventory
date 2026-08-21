/* Carga inicial de la base y gestión de usuarios.
 *
 *   npm run seed                                  -> crea el usuario inicial y los productos
 *   npm run usuario -- --usuario ana --nombre "Ana" --email a@x.com --password secreta
 *   npm run usuario -- --usuario hlopez --password nuevaClave     (cambia la contraseña)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, q, uno, inicializar } from './db.js';

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

export async function guardarUsuario({ nombre, usuario, email, password, rol = 'admin' }) {
  const existente = await uno(
    'SELECT * FROM usuarios WHERE lower(usuario) = lower($1) OR lower(email) = lower($2)',
    [usuario ?? '', email ?? '']);
  const hash = bcrypt.hashSync(password, COSTO_BCRYPT);

  if (existente) {
    await q(`UPDATE usuarios SET nombre = $1, usuario = $2, email = $3, password_hash = $4, rol = $5
             WHERE id = $6`,
      [nombre ?? existente.nombre, usuario ?? existente.usuario, email ?? existente.email,
       hash, rol ?? existente.rol, existente.id]);
    // Cambiar la contraseña cierra las sesiones abiertas de ese usuario.
    await q('DELETE FROM sesiones WHERE usuario_id = $1', [existente.id]);
    return { accion: 'actualizado', usuario: usuario ?? existente.usuario };
  }

  await q(`INSERT INTO usuarios (nombre, usuario, email, password_hash, rol)
           VALUES ($1, $2, $3, $4, $5)`, [nombre, usuario, email, hash, rol]);
  return { accion: 'creado', usuario };
}

async function cargarProductos() {
  const ruta = path.join(raiz, 'data', 'productos.json');
  if (!fs.existsSync(ruta)) return 0;

  const { productos = [] } = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  let n = 0;

  for (const p of productos) {
    const r = await q(
      `INSERT INTO productos (id, nombre, sku, categoria, descripcion, imagen, ubicacion,
                              stock, precio, estado, actualizado, notas, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.nombre, p.sku ?? null, p.categoria ?? null, p.descripcion ?? null,
       p.imagen ?? null, p.ubicacion ?? null, p.stock ?? null, p.precio ?? null,
       p.estado ?? null, p.actualizado ?? null, p.notas ?? null,
       JSON.stringify(p.extra ?? {})]);
    n += r.rowCount;
  }
  return n;
}

async function main() {
  await inicializar();
  const a = args();

  if (a.usuario || a.password) {
    if (!a.password) throw new Error('Falta --password');

    const base = await uno(
      'SELECT * FROM usuarios WHERE lower(usuario) = lower($1) OR lower(email) = lower($2)',
      [a.usuario ?? '', a.email ?? '']);

    if (!base && !(a.nombre && a.email)) {
      throw new Error('Usuario nuevo: se requieren --nombre, --usuario, --email y --password');
    }

    const r = await guardarUsuario({
      nombre: a.nombre ?? base?.nombre,
      usuario: a.usuario ?? base?.usuario,
      email: a.email ?? base?.email,
      password: a.password,
      rol: a.rol ?? base?.rol ?? 'admin',
    });
    console.log(`Usuario ${r.usuario} ${r.accion}.`);
    return;
  }

  const { count } = await uno('SELECT COUNT(*)::int AS count FROM usuarios');
  if (count === 0) {
    await guardarUsuario(USUARIO_INICIAL);
    console.log(`Usuario inicial creado: ${USUARIO_INICIAL.usuario} / ${USUARIO_INICIAL.email}`);
    console.log('   Cámbiale la contraseña con:');
    console.log('   npm run usuario -- --usuario hlopez --password TU_NUEVA_CLAVE');
  } else {
    console.log(`Ya hay ${count} usuario(s); no se toca ninguno.`);
  }

  const nuevos = await cargarProductos();
  const { total } = await uno('SELECT COUNT(*)::int AS total FROM productos');
  console.log(`Productos: ${nuevos} nuevo(s), ${total} en total.`);
}

main()
  .catch(e => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
