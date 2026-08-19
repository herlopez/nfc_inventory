/* Lee el ID que llega en el link (NFC / QR) y pinta la ficha del producto.
   Los datos vienen de la API, que solo responde con la sesión iniciada.
   Formas soportadas:
     /?id=P-001   (recomendada)     /?p=P-001
     /#P-001                        /p/P-001
*/

const API = '/api/productos';

let esAdmin = false; // se ajusta con el usuario que devuelve la API

function leerId() {
  const q = new URLSearchParams(location.search);
  const id = q.get('id') || q.get('p') || q.get('producto') || location.hash.slice(1);
  return (id || '').trim();
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function claseEstado(estado) {
  const e = (estado || '').toLowerCase();
  if (['disponible', 'ok', 'nuevo', 'activo'].includes(e)) return 'ok';
  if (['prestado', 'reservado', 'mantenimiento', 'bajo'].includes(e)) return 'warn';
  if (['agotado', 'baja', 'dañado', 'perdido'].includes(e)) return 'bad';
  return 'warn';
}

function precio(valor, moneda) {
  if (valor === undefined || valor === null || valor === '') return null;
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency: moneda || 'USD' }).format(valor);
  } catch {
    return `${valor} ${moneda || ''}`.trim();
  }
}

function vistaProducto(p, config) {
  const img = p.imagen
    ? `<img class="hero" src="${esc(p.imagen)}" alt="${esc(p.nombre)}" onerror="this.remove()">`
    : `<div class="hero-fallback">${esc(String(p.id).slice(0, 3).toUpperCase())}</div>`;

  const celdas = [
    ['ID', `<code class="id-chip">${esc(p.id)}</code>`],
    ['SKU', p.sku],
    ['Ubicación', p.ubicacion],
    ['Stock', p.stock !== undefined && p.stock !== null ? `${p.stock} u.` : null],
    ['Precio', precio(p.precio, config.moneda)],
    ['Actualizado', p.actualizado],
    ...Object.entries(p.extra || {})
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  return `
    <article class="card">
      ${img}
      <div class="card-body">
        ${p.categoria ? `<p class="eyebrow">${esc(p.categoria)}</p>` : ''}
        <h2 class="nombre">${esc(p.nombre)}</h2>
        <p class="sub">
          ${p.estado ? `<span class="badge ${claseEstado(p.estado)}">${esc(p.estado)}</span>` : ''}
        </p>
        ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ''}
        <dl class="grid">
          ${celdas.map(([k, v]) => `<div class="cell"><dt>${esc(k)}</dt><dd>${k === 'ID' ? v : esc(v)}</dd></div>`).join('')}
        </dl>
        ${p.notas ? `<p class="notas">${esc(p.notas)}</p>` : ''}
        <div class="acciones">
          <button class="btn primary" id="compartir">Compartir</button>
          <button class="btn" id="copiar">Copiar link</button>
          ${esAdmin ? `<a class="btn" href="/admin.html?id=${encodeURIComponent(p.id)}">Editar</a>` : ''}
          <a class="btn" href="/">Ver todo</a>
        </div>
      </div>
    </article>`;
}

function vistaLista(productos, titulo, mensaje) {
  return `
    <article class="card">
      <div class="card-body" style="border-bottom:1px solid var(--line)">
        <h2 class="nombre" style="font-size:20px">${esc(titulo)}</h2>
        <p class="sub" style="margin:0">${esc(mensaje)}</p>
        ${esAdmin ? `<div class="acciones" style="margin-top:14px">
          <a class="btn primary" href="/admin.html">+ Nuevo producto</a>
        </div>` : ''}
      </div>
      <ul class="lista">
        ${productos.map(p => `
          <li><a href="?id=${encodeURIComponent(p.id)}">
            <span>${esc(p.nombre)}</span>
            <span class="id">${esc(p.id)}</span>
          </a></li>`).join('')}
      </ul>
    </article>`;
}

function vistaError(id, productos) {
  return `
    <article class="card">
      <div class="msg">
        <div class="big">🔍</div>
        <h2>Producto no encontrado</h2>
        <p>No existe ningún producto con el ID <code class="id-chip">${esc(id)}</code>.</p>
        <a class="btn primary" href="/">Ver el inventario</a>
      </div>
    </article>
    ${productos.length ? vistaLista(productos, 'Inventario', `${productos.length} productos registrados`) : ''}`;
}

function conectarAcciones(p) {
  const url = location.href;
  const compartir = document.getElementById('compartir');
  const copiar = document.getElementById('copiar');

  compartir?.addEventListener('click', async () => {
    const datos = { title: p.nombre, text: `${p.nombre} (${p.id})`, url };
    if (navigator.share) {
      try { await navigator.share(datos); } catch { /* cancelado */ }
    } else {
      copiarAlPortapapeles(url, compartir);
    }
  });

  copiar?.addEventListener('click', () => copiarAlPortapapeles(url, copiar));
}

async function copiarAlPortapapeles(texto, boton) {
  try {
    await navigator.clipboard.writeText(texto);
    const antes = boton.textContent;
    boton.textContent = '¡Copiado!';
    setTimeout(() => { boton.textContent = antes; }, 1600);
  } catch {
    prompt('Copia el link:', texto);
  }
}

/** Manda al login conservando el destino, para volver a la ficha tras entrar. */
function irAlLogin() {
  const destino = location.pathname + location.search + location.hash;
  location.replace('/login?next=' + encodeURIComponent(destino));
}

/** Pide a la API; si la sesión venció, redirige al login. */
async function pedir(url) {
  const res = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (res.status === 401) { irAlLogin(); return null; }
  return res;
}

function pintarSesion(usuario) {
  if (!usuario) return;
  esAdmin = usuario.rol === 'admin';
  document.getElementById('quien').textContent = usuario.nombre || usuario.usuario;

  const salir = document.getElementById('salir');
  salir.hidden = false;
  salir.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.replace('/login');
  });
}

async function main() {
  const app = document.getElementById('app');
  const id = leerId();

  let res;
  try {
    res = await pedir(id ? `${API}/${encodeURIComponent(id)}` : API);
    if (!res) return; // redirigiendo al login
  } catch {
    app.innerHTML = `
      <article class="card"><div class="msg">
        <div class="big">⚠️</div>
        <h2>Sin conexión con el servidor</h2>
        <p>Arranca el servidor con <code class="id-chip">npm start</code> y recarga.</p>
      </div></article>`;
    return;
  }

  // ID que no existe: mostramos el aviso y, de paso, el inventario completo.
  if (res.status === 404) {
    const lista = await pedir(API);
    if (!lista) return;
    const data = lista.ok ? await lista.json() : {};
    pintarSesion(data.usuario);
    app.innerHTML = vistaError(id, data.productos || []);
    return;
  }

  if (!res.ok) {
    app.innerHTML = `
      <article class="card"><div class="msg">
        <div class="big">⚠️</div>
        <h2>Error del servidor</h2>
        <p>La API respondió ${res.status}.</p>
      </div></article>`;
    return;
  }

  const data = await res.json();
  const config = data.config || {};
  pintarSesion(data.usuario);

  if (config.titulo) document.getElementById('titulo').textContent = config.titulo;

  if (!id) {
    const productos = data.productos || [];
    app.innerHTML = vistaLista(productos, config.titulo || 'Inventario',
      `${productos.length} producto${productos.length === 1 ? '' : 's'} registrado${productos.length === 1 ? '' : 's'}`);
    return;
  }

  const p = data.producto;
  document.title = `${p.nombre} · ${p.id}`;
  app.innerHTML = vistaProducto(p, config);
  conectarAcciones(p);
}

main();
