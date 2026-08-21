import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(raiz, '.env');
const usuariosPrivilegiados = new Set(['postgres', 'root', 'hans']);
const placeholders = new Set([
  'tu-clave-aqui',
  'cambia-esta-clave',
  'una-clave-larga',
  'clave_larga_nueva',
  'password',
  'admin',
]);

function fallo(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exitCode = 1;
}

function ok(mensaje) {
  console.log(`OK: ${mensaje}`);
}

function maskUrl(url) {
  const copia = new URL(url);
  if (copia.password) copia.password = '***';
  return copia.toString();
}

function parecePlaceholder(valor) {
  return placeholders.has(String(valor ?? '').trim().toLowerCase());
}

if (!fs.existsSync(envPath)) {
  fallo('No existe .env. Copia .env.example y completa los valores reales.');
  process.exit();
}

process.loadEnvFile(envPath);

for (const nombre of ['DATABASE_URL']) {
  if (!process.env[nombre]) fallo(`Falta ${nombre} en .env.`);
}

let dbUrl;
try {
  dbUrl = new URL(process.env.DATABASE_URL);
} catch {
  fallo('DATABASE_URL no es una URL valida.');
}

if (dbUrl) {
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol)) {
    fallo('DATABASE_URL debe empezar con postgres:// o postgresql://.');
  }
  if (!dbUrl.username) fallo('DATABASE_URL no tiene usuario.');
  if (!dbUrl.password) fallo('DATABASE_URL no tiene password.');
  if (!dbUrl.hostname) fallo('DATABASE_URL no tiene host.');
  if (!dbUrl.pathname || dbUrl.pathname === '/') fallo('DATABASE_URL no tiene base de datos.');

  if (usuariosPrivilegiados.has(decodeURIComponent(dbUrl.username).toLowerCase())) {
    fallo(`DATABASE_URL usa el usuario privilegiado "${decodeURIComponent(dbUrl.username)}". Usa un rol dedicado, por ejemplo nfc_admin.`);
  } else {
    ok(`DATABASE_URL usa un rol no privilegiado en la cadena: ${decodeURIComponent(dbUrl.username)}.`);
  }

  if (parecePlaceholder(decodeURIComponent(dbUrl.password))) {
    fallo('DATABASE_URL usa una clave de ejemplo. Cambiala por una clave real y larga en .env.');
  }

  if (process.env.PGUSER && process.env.PGUSER !== decodeURIComponent(dbUrl.username)) {
    fallo('PGUSER y el usuario de DATABASE_URL no coinciden.');
  }

  console.log(`DB: ${maskUrl(process.env.DATABASE_URL)}`);
}

const poolMax = Number(process.env.PG_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) {
  fallo('PG_POOL_MAX debe ser un entero entre 1 y 100.');
}

if (process.env.PGSSL && !['0', '1'].includes(process.env.PGSSL)) {
  fallo('PGSSL debe ser 0 o 1.');
}

if (process.env.PGPASSWORD && parecePlaceholder(process.env.PGPASSWORD.replace(/^['"]|['"]$/g, ''))) {
  fallo('PGPASSWORD usa una clave de ejemplo. Cambiala por una clave real y larga en .env.');
}

if (process.env.INITIAL_ADMIN_PASSWORD && parecePlaceholder(process.env.INITIAL_ADMIN_PASSWORD)) {
  fallo('INITIAL_ADMIN_PASSWORD usa una clave de ejemplo. Cambiala antes de crear el usuario inicial.');
}

if (process.argv.includes('--db') && dbUrl && process.exitCode !== 1) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const { rows } = await pool.query(`
      SELECT current_user, current_database(), rolsuper, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const rol = rows[0];
    ok(`Conexion a Postgres como ${rol.current_user} en ${rol.current_database}.`);
    if (rol.rolsuper || rol.rolcreatedb || rol.rolcreaterole) {
      fallo('El rol de la app tiene permisos altos (superuser/createdb/createrole). Usa scripts/db-create-admin.sql para bajarlo a permisos minimos.');
    } else {
      ok('El rol de la app no es superuser y no puede crear bases ni roles.');
    }
  } finally {
    await pool.end();
  }
}
