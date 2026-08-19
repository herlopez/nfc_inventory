/* Base de datos SQLite (módulo node:sqlite, incluido en Node >= 22.5).
   No requiere instalar ni compilar nada. El archivo .db se crea solo. */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const RUTA_DB = process.env.DB_PATH
  ? path.resolve(raiz, process.env.DB_PATH)
  : path.join(raiz, 'inventario.db');

export const db = new DatabaseSync(RUTA_DB);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    usuario       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    rol           TEXT NOT NULL DEFAULT 'admin',
    creado        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    token      TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada     TEXT NOT NULL DEFAULT (datetime('now')),
    expira     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS productos (
    id          TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    sku         TEXT,
    categoria   TEXT,
    descripcion TEXT,
    imagen      TEXT,
    ubicacion   TEXT,
    stock       INTEGER,
    precio      REAL,
    estado      TEXT,
    actualizado TEXT,
    notas       TEXT,
    extra       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_productos_sku ON productos (sku);
  CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones (expira);
`);

/** Convierte una fila de productos al objeto que consume el front. */
export function filaAProducto(fila) {
  if (!fila) return null;
  const { extra, ...resto } = fila;
  let extraObj = {};
  try {
    extraObj = extra ? JSON.parse(extra) : {};
  } catch {
    extraObj = {};
  }
  return { ...resto, extra: extraObj };
}

export { RUTA_DB };
