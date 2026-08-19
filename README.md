# nfc_inventory

Inventario por NFC/QR con acceso por contraseña.
Cada tag guarda un link con un ID; el servidor pide sesión y luego muestra la ficha del producto.

```text
https://tusitio.com/?id=P-001   →   login  →   ficha del producto P-001
```

Node + Express + SQLite (`node:sqlite`, incluido en Node ≥ 22.5: no hay que compilar nada).

## Arrancar

```bash
npm install
npm run seed     # crea el usuario inicial y carga los productos de ejemplo
npm start        # http://localhost:3000
```

Usuario inicial (queda en la tabla `usuarios`, con la contraseña cifrada con bcrypt):

| nombre | usuario | email | contraseña |
| --- | --- | --- | --- |
| hernan | `hlopez` | `herlopezm@gmail.com` | `123123123` |

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
| [db.js](db.js) | Esquema SQLite (`usuarios`, `sesiones`, `productos`). |
| [seed.js](seed.js) | Carga inicial y alta/cambio de contraseña de usuarios. |
| [public/login.html](public/login.html) | Formulario de acceso. |
| [public/index.html](public/index.html) | Ficha del producto; sin `id` muestra el listado. |
| [public/admin.html](public/admin.html) | Alta, edición y borrado de productos. |
| [public/generar.html](public/generar.html) | Genera el link, el QR descargable y graba el tag NFC. |
| [public/assets/app.js](public/assets/app.js) | Lee el ID del link y pinta la ficha desde la API. |
| [data/productos.json](data/productos.json) | Solo semilla inicial; el dato vivo está en la base. |
| `inventario.db` | La base. No se sube a git. |

## Cómo funciona el acceso

- La contraseña se guarda con **bcrypt** (coste 12), nunca en claro.
- Al entrar se crea una sesión de 30 días; la cookie es `httpOnly` + `SameSite=Lax` y en la base se guarda solo el **hash** del token, así que ni con la base en la mano se pueden reusar sesiones.
- Tras 8 intentos fallidos en 15 minutos, ese usuario/IP recibe `429` durante un rato.
- Todo lo que no sea `/login` y `/assets` exige sesión: sin cookie, las páginas redirigen al login y la API responde `401`.
- Si abres el link de un tag sin sesión, tras entrar vuelves solo a la ficha que escaneaste (`/login?next=…`).

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

Ojo con SQLite en hosts de disco efímero (Render free): monta un disco persistente y apunta
`DB_PATH` ahí, o la base se borra en cada despliegue.

## Configuración

Ver [.env.example](.env.example): `PORT`, `SESSION_DIAS`, `COOKIE_SECURE`, `TRUST_PROXY`, `DB_PATH`, `MONEDA`.
