/* Capa de base de datos: PostgreSQL vía el driver pg.
   La conexión sale de DATABASE_URL (ver .env). */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const raiz = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(raiz, '.env'))) process.loadEnvFile(path.join(raiz, '.env'));

// pg devuelve numeric como string para no perder precisión; aquí el precio
// se muestra como número, así que lo convertimos al leerlo.
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en .env (postgresql://usuario:clave@host:5432/base)');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Muchos Postgres gestionados exigen TLS; con PGSSL=1 se activa.
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', err => console.error('Error inesperado en el pool de Postgres:', err.message));

/** Consulta suelta. Devuelve el resultado completo de pg. */
export const q = (texto, params = []) => pool.query(texto, params);

/** Primera fila o null. */
export async function uno(texto, params = []) {
  const { rows } = await pool.query(texto, params);
  return rows[0] ?? null;
}

/** Todas las filas. */
export async function todos(texto, params = []) {
  const { rows } = await pool.query(texto, params);
  return rows;
}

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre        text NOT NULL,
    usuario       text NOT NULL,
    email         text NOT NULL,
    password_hash text NOT NULL,
    rol           text NOT NULL DEFAULT 'admin',
    creado        timestamptz NOT NULL DEFAULT now()
  );

  -- Únicos sin distinguir mayúsculas, que es como se escribe un usuario al entrar.
  CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_usuario ON usuarios (lower(usuario));
  CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email   ON usuarios (lower(email));

  CREATE TABLE IF NOT EXISTS sesiones (
    token      text PRIMARY KEY,
    usuario_id integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada     timestamptz NOT NULL DEFAULT now(),
    expira     timestamptz NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ix_sesiones_expira ON sesiones (expira);

  CREATE TABLE IF NOT EXISTS productos (
    id          text PRIMARY KEY,
    nombre      text NOT NULL,
    sku         text,
    categoria   text,
    descripcion text,
    imagen      text,
    ubicacion   text,
    stock       integer,
    precio      numeric(12,2),
    estado      text,
    actualizado text,
    notas       text,
    extra       jsonb NOT NULL DEFAULT '{}'::jsonb
  );

  -- Evita que convivan 'P-001' y 'p-001': los tags no distinguen mayúsculas.
  CREATE UNIQUE INDEX IF NOT EXISTS ux_productos_id ON productos (lower(id));
  CREATE INDEX IF NOT EXISTS ix_productos_sku ON productos (lower(sku));

  -- Una foto por producto. Guardarla en la base deja el respaldo en un solo sitio.
  CREATE TABLE IF NOT EXISTS imagenes (
    producto_id text PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
    mime        text NOT NULL,
    bytes       bytea NOT NULL,
    version     text NOT NULL,
    creada      timestamptz NOT NULL DEFAULT now()
  );
`;

/** Crea las tablas que falten. Es idempotente: se puede llamar en cada arranque. */
export async function inicializar() {
  await pool.query(ESQUEMA);
}

/** Normaliza una fila de productos para el front. */
export function filaAProducto(fila) {
  if (!fila) return null;
  const { extra, ...resto } = fila;
  return { ...resto, extra: extra && typeof extra === 'object' ? extra : {} };
}
