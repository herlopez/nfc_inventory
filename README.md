# nfc_inventory

Inventario por NFC/QR con acceso por contraseña.
Cada tag guarda un link con un ID; el servidor pide sesión y luego muestra la ficha del producto.

```text
https://tusitio.com/?id=P-001   →   login  →   ficha del producto P-001
```

Node + Express + PostgreSQL (driver `pg`).

## Arrancar

```bash
npm install
cp .env.example .env      # y pon ahí tu DATABASE_URL
npm run check:env         # valida que no uses root/hans/postgres en la cadena
npm run seed              # crea las tablas, el usuario inicial y los productos de ejemplo
npm start                 # http://localhost:3000
```

Si la base todavía no existe, créala una vez: `createdb nfc` (o `CREATE DATABASE nfc;` desde psql).
Las tablas las crea la app sola en cada arranque, con `CREATE TABLE IF NOT EXISTS`.

Usuario inicial: si la tabla `usuarios` está vacía, `npm run seed` lo crea desde estas variables
del `.env` y guarda la contraseña cifrada con bcrypt:

```env
INITIAL_ADMIN_NAME="Admin"
INITIAL_ADMIN_USER=admin
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD="una-clave-larga"
```

## Usuarios

```bash
# cambiar la contraseña (cierra las sesiones abiertas de ese usuario)
npm run usuario -- --usuario hlopez --password NUEVA_CLAVE

# dar de alta a otra persona
npm run usuario -- --nombre "Ana Ruiz" --usuario aruiz --email ana@empresa.com --password su_clave
```

## Estructura

| Archivo | Qué hace |
| --- | --- |
| [server.js](server.js) | Express: login, sesiones, API y archivos estáticos. |
| [db.js](db.js) | Pool de Postgres y esquema (`usuarios`, `sesiones`, `productos`, `imagenes`). |
| [seed.js](seed.js) | Carga inicial y alta/cambio de contraseña de usuarios. |
| [scripts/validate-env.js](scripts/validate-env.js) | Revisa que `.env` tenga `DATABASE_URL` válida y que no use un rol privilegiado. |
| [scripts/db-create-admin.sql](scripts/db-create-admin.sql) | SQL para crear/ajustar el rol dedicado de la app en Postgres. |
| [public/login.html](public/login.html) | Formulario de acceso. |
| [public/index.html](public/index.html) | Ficha del producto; sin `id` muestra el listado. |
| [public/admin.html](public/admin.html) | Alta, edición y borrado de productos. |
| [public/generar.html](public/generar.html) | Genera el link, el QR descargable y graba el tag NFC. |
| [public/assets/app.js](public/assets/app.js) | Lee el ID del link y pinta la ficha desde la API. |
| [data/productos.json](data/productos.json) | Solo semilla inicial; el dato vivo está en la base. |
| [.env.example](.env.example) | Plantilla de configuración. El `.env` real no se sube a git. |

## Cómo funciona el acceso

- La contraseña se guarda con **bcrypt** (coste 12), nunca en claro.
- Al entrar se crea una sesión de 30 días; la cookie es `httpOnly` + `SameSite=Lax` y en la base se guarda solo el **hash** del token, así que ni con la base en la mano se pueden reusar sesiones.
- Tras 8 intentos fallidos contra un usuario (o 30 desde una misma IP) en 15 minutos, se responde `429`.
- Todo lo que no sea `/login` y `/assets` exige sesión: sin cookie, las páginas redirigen al login y la API responde `401`.
- Si abres el link de un tag sin sesión, tras entrar vuelves solo a la ficha que escaneaste (`/login?next=…`).
- Todas las respuestas llevan CSP, `nosniff`, `X-Frame-Options: DENY` y `Referrer-Policy`.
- Todas las consultas van parametrizadas (`$1..$n`): no se concatena SQL en ningún sitio.

## API

| Ruta | Qué devuelve |
| --- | --- |
| `POST /api/login` | `{usuario, password}` → cookie de sesión. |
| `POST /api/logout` | Cierra la sesión actual. |
| `GET /api/yo` | Usuario de la sesión. |
| `GET /api/productos` | Inventario completo. |
| `GET /api/productos/:id` | Un producto, buscando por `id` o por `sku`. |
| `POST /api/productos` | Alta. `409` si el ID ya existe. Solo rol `admin`. |
| `PUT /api/productos/:id` | Edición (reemplaza todos los campos). Solo rol `admin`. |
| `DELETE /api/productos/:id` | Baja. Solo rol `admin`. |
| `GET /api/productos/:id/imagen` | La foto, con `ETag` y caché privada. |
| `POST /api/productos/:id/imagen` | Sube la foto: cuerpo binario + `Content-Type`. Solo rol `admin`. |
| `DELETE /api/productos/:id/imagen` | Quita la foto. Solo rol `admin`. |
| `GET /p/:id` | Link corto para tags → redirige a `/?id=…`. |

## Agregar y editar productos

Desde el navegador, en **`/admin.html`** (botón *+ Nuevo producto* en el listado, o *Editar* en cada ficha):
alta, edición, borrado, campos extra dinámicos y sugerencias de categoría/ubicación ya usadas.

- El **ID no se puede cambiar** después de crearlo: los tags ya grabados apuntan a él.
- `actualizado` se sella solo con la fecha de cada guardado.
- Campos: `id`, `nombre`, `sku`, `categoria`, `descripcion`, `imagen` (URL), `ubicacion`, `stock`,
  `precio`, `estado`, `notas` y los `extra` que quieras. Los vacíos no se muestran en la ficha.
- Estados con color: `disponible` (verde) · `prestado`, `reservado`, `mantenimiento` (ámbar) ·
  `agotado`, `dañado`, `perdido` (rojo).

### Foto

Botón **Tomar / elegir foto**: desde el móvil abre la cámara. La imagen se reduce a 1600 px y se
convierte a JPEG **en el navegador** antes de subirla (respetando la orientación EXIF), así que una
foto de 4 MB acaba pesando ~200 KB. Se guarda en la tabla `imagenes` como `bytea`, y se sirve por
`/api/productos/:id/imagen` solo con sesión iniciada. Admite JPEG, PNG y WebP hasta 5 MB; el
servidor comprueba los bytes de cabecera, no solo el `Content-Type`. Si prefieres enlazar una foto
que ya está en internet, usa el campo *…o una imagen por URL*; la foto subida tiene prioridad.

### Roles

`admin` (el de por defecto) lee y edita; `lector` solo lee — la API le responde `403` a cualquier
escritura y la interfaz le esconde los botones de edición.

```bash
npm run usuario -- --nombre "Ana Ruiz" --usuario aruiz --email ana@empresa.com --password su_clave --rol lector
```

## Grabar los tags

1. Entra a `/generar.html` **desde el teléfono** (Chrome en Android) con la sesión iniciada.
2. Confirma la URL base, elige el producto.
3. **Escribir en tag NFC** → acerca el tag. Alternativa: app *NFC Tools* → Write → URL.
4. Para QR: **Descargar QR** e imprímelo.

El tag solo guarda la URL, así que puedes cambiar precios, stock o ubicación sin volver a grabar nada.

## Publicar

Ya no sirve GitHub Pages: hace falta un host que ejecute Node (Render, Railway, Fly.io, un VPS).
Sube el repo, configura el arranque como `npm install && npm run seed && npm start` y en el `.env`
del servidor pon `COOKIE_SECURE=1` y `TRUST_PROXY=1`.

`TRUST_PROXY=1` hace que la IP del cliente se lea de `X-Forwarded-For`. Actívalo **solo** si de
verdad hay un proxy delante; si no, cualquiera puede falsear su IP y saltarse el freno de intentos.

Como la base es Postgres, no hay problema de disco efímero. Si el servidor exige TLS
(Neon, Supabase, RDS), pon `PGSSL=1`.

## Configuración

Ver [.env.example](.env.example): `PORT`, `SESSION_DIAS`, `COOKIE_SECURE`, `TRUST_PROXY`,
`MONEDA`, `DATABASE_URL`, `PGSSL`, `PG_POOL_MAX` y las variables `INITIAL_ADMIN_*`.

Para validar sin revelar secretos:

```bash
npm run check:env
```

Si la red donde corre el comando tiene acceso a Postgres, también valida permisos reales del rol:

```bash
npm run check:env:db
```

El usuario de la app en `DATABASE_URL` debe ser dedicado, por ejemplo `nfc_admin`, no `hans`,
`postgres` ni `root`.

## Rol de base de datos

Ejecuta esto una vez con un usuario administrador de Postgres para crear o ajustar el rol de la app:

```bash
psql "postgresql://USUARIO_ADMIN@HOST:5432/postgres" \
  -v db_name=nfc \
  -v app_user=nfc_admin \
  -v app_password='CLAVE_LARGA_NUEVA' \
  -f scripts/db-create-admin.sql
```

Después deja el `.env` así, usando esa clave nueva:

```env
PGUSER=nfc_admin
DATABASE_URL="postgresql://nfc_admin:CLAVE_LARGA_NUEVA@HOST:5432/nfc"
```

## Respaldo

```bash
pg_dump "$DATABASE_URL" -Fc -f respaldo-nfc.dump    # incluye las fotos
pg_restore -d "$DATABASE_URL" respaldo-nfc.dump
```
