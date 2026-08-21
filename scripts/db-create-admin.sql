\set ON_ERROR_STOP on

-- Ejecutar conectado con un usuario administrador de Postgres, por ejemplo:
-- psql "postgresql://USUARIO_ADMIN@HOST:5432/postgres" ^
--   -v db_name=nfc ^
--   -v app_user=nfc_admin ^
--   -v app_password='CAMBIA_ESTA_CLAVE' ^
--   -f scripts/db-create-admin.sql
--
-- El rol resultante puede usar la app, pero no es superusuario, no crea DBs
-- y no crea otros roles.

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_user'
)\gexec

ALTER ROLE :"app_user"
  WITH LOGIN
  PASSWORD :'app_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

ALTER DATABASE :"db_name" OWNER TO :"app_user";
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";

\connect :"db_name"

GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";

SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'app_user')
FROM pg_tables
WHERE schemaname = 'public'\gexec

SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', schemaname, sequencename, :'app_user')
FROM pg_sequences
WHERE schemaname = 'public'\gexec

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
