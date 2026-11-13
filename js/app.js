// =====================================================================
// Interfaz de la app: login, menú y pantallas.
// Cada pantalla es una función show...() que dibuja HTML dentro de #view.
// =====================================================================

import * as api from './api.js';
import { EDIT_MINUTES } from './config.js';

const app = document.getElementById('app');
const EDIT_MS = EDIT_MINUTES * 60 * 1000;

const state = {
  me: null,            // perfil del usuario conectado
  profiles: [],        // todos los usuarios
  categories: [],      // las 4 categorías
  happenings: [],      // acontecimientos cargados
  complaints: [],      // reclamos generales
  histFilter: 'todos', // filtro del historial
};

const STATUS_LABEL = {
  abierto: 'En votación', aceptado: 'Aceptado', rechazado: 'Rechazado', resuelto: 'Resuelto',
};


// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

// Escapa texto para meterlo en HTML sin riesgo (evita inyección de código)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => new Date(iso).toLocaleString('es', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

// Tiempo restante: "5h 20m" si queda más de una hora, si no "12:34"
function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const pts = (n) => `${n > 0 ? '+' : ''}${n}`;

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = `toast ${isError ? 'error' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Ejecuta una acción y muestra el error si falla
async function run(fn) {
  try { await fn(); } catch (e) { toast(e.message, true); }
}

const view = () => document.getElementById('view');
const currentTab = () => location.hash.slice(1) || 'tabla';


// ---------------------------------------------------------------------
// Formulario en ventana emergente (se usa para todo)
//   fields: [{ name, label, type: 'text'|'password'|'number'|'select'|'textarea',
//              value, options: [{value,label}], required, attrs }]
// ---------------------------------------------------------------------

function fieldHtml(f) {
  const req = f.required ? 'required' : '';
  const label = `<span>${esc(f.label)}</span>`;
  if (f.type === 'select') {
    const opts = f.options.map((o) =>
      `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<label>${label}<select name="${f.name}" ${req}>${opts}</select></label>`;
  }
  if (f.type === 'textarea') {
    return `<label>${label}<textarea name="${f.name}" rows="4" maxlength="1000" ${req}>${esc(f.value)}</textarea></label>`;
  }
  return `<label>${label}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value)}" ${req} ${f.attrs || ''}></label>`;
}

function formModal({ title, fields, submitLabel = 'Guardar', onSubmit }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <form class="card modal-box">
      <h3>${esc(title)}</h3>
      ${fields.map(fieldHtml).join('')}
      <p class="error"></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;
  document.body.appendChild(wrap);

  const form = wrap.querySelector('form');
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
      close();
    } catch (err) {
      form.querySelector('.error').textContent = err.message;
      btn.disabled = false;
    }
  };
}


// ---------------------------------------------------------------------
// Arranque, login y menú
// ---------------------------------------------------------------------

async function start() {
  const session = await api.getSession();
  if (!session) return renderLogin();

  try {
    state.me = await api.getMyProfile(session.user.id);
  } catch {
    state.me = null;
  }
  if (!state.me?.active) {
    await api.logout();
    return renderLogin('Tu usuario no está habilitado. Habla con el admin.');
  }

  renderShell();
  route();
}

function renderLogin(msg = '') {
  state.me = null;
  app.innerHTML = `
    <div class="login">
      <form class="card" id="login-form">
        <div class="logo">🏆</div>
        <h1>Tabla Anual 2027</h1>
        <label><span>Usuario</span>
          <input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required></label>
        <label><span>Contraseña</span>
          <input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary block" type="submit">Entrar</button>
        <p class="error">${esc(msg)}</p>
      </form>
    </div>`;

  const form = document.getElementById('login-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { username, password } = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api.login(username, password);
      await start();
    } catch (err) {
      form.querySelector('.error').textContent = err.message;
      btn.disabled = false;
    }
  };
}

const TABS = {
  tabla:     { icon: '🏆', label: 'Tabla',     show: showTabla },
  historial: { icon: '📜', label: 'Historial', show: showHistorial },
  reclamos:  { icon: '📣', label: 'Reclamos',  show: showReclamos },
  admin:     { icon: '⚙️', label: 'Admin',     show: showAdmin, adminOnly: true },
};

function renderShell() {
  const tabs = Object.entries(TABS).filter(([, t]) => !t.adminOnly || state.me.is_admin);

  app.innerHTML = `
    <header class="topbar">
      <span class="brand">🏆 Tabla Anual 2027</span>
      <span class="me">${esc(state.me.display_name)}
        <button class="btn link" id="logout">Salir</button></span>
    </header>
    <main id="view"></main>
    <nav class="tabs">
      ${tabs.map(([id, t]) =>
        `<a href="#${id}" data-tab="${id}"><span class="icon">${t.icon}</span>${t.label}</a>`).join('')}
    </nav>`;

  document.getElementById('logout').onclick = async () => {
    await api.logout();
    location.hash = '';
    renderLogin();
  };
}

async function route() {
  if (!state.me) return;
  let tab = currentTab();
  if (!TABS[tab] || (TABS[tab].adminOnly && !state.me.is_admin)) tab = 'tabla';

  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === tab));

  const el = view();
  if (!el.innerHTML) el.innerHTML = '<p class="muted center">Cargando…</p>';
  await run(() => TABS[tab].show(el));
}

window.addEventListener('hashchange', () => { if (view()) view().innerHTML = ''; route(); });

// Al volver a la app (por ejemplo, desde otra app del móvil) se refrescan los datos
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me && !document.querySelector('.modal')) route();
});


// ---------------------------------------------------------------------
// Pantalla: Tabla de puntos
// ---------------------------------------------------------------------

async function showTabla(el) {
  await api.closeDue();
  const rows = await api.getLeaderboard();
  const medals = ['🥇', '🥈', '🥉'];

  el.innerHTML = `
    <div class="view-head"><h2>Tabla de puntos</h2></div>
    <ol class="ranking">
      ${rows.map((r, i) => `
        <li class="card rank-row ${r.id === state.me.id ? 'mine' : ''}">
          <span class="pos">${medals[i] ?? i + 1}</span>
          <span class="name">${esc(r.display_name)}
            <small>${r.accepted} aceptados · ${r.pending} en votación</small></span>
          <span class="pts">${r.points}<small>pts</small></span>
        </li>`).join('')}
    </ol>`;
}


// ---------------------------------------------------------------------
// Pantalla: Historial de acontecimientos
// ---------------------------------------------------------------------

async function showHistorial(el) {
  await api.closeDue();
  const [profiles, categories, happenings] = await Promise.all([
    api.getProfiles(), api.getCategories(), api.getHappenings(),
  ]);
  state.profiles = profiles;
  state.categories = categories;
  state.happenings = happenings;
  drawHistorial(el);
}

function drawHistorial(el) {
  const filters = [['todos', 'Todos'], ['abierto', 'En votación'], ['aceptado', 'Aceptados'],
                   ['rechazado', 'Rechazados'], ['para-mi', 'Para mí']];
  const f = state.histFilter;
  const list = state.happenings.filter((h) =>
    f === 'todos' || (f === 'para-mi' ? h.to_user === state.me.id : h.status === f));

  el.innerHTML = `
    <div class="view-head">
      <h2>Historial</h2>
      <button class="btn primary" data-action="new">+ Nuevo</button>
    </div>
    <div class="filters">
      ${filters.map(([k, l]) =>
        `<button class="chip ${f === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    ${list.length ? list.map(happeningCard).join('') : '<p class="muted center">No hay acontecimientos aquí.</p>'}`;

  el.onclick = (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { state.histFilter = chip.dataset.filter; drawHistorial(el); return; }

    const b = e.target.closest('[data-action]');
    if (!b) return;
    const h = state.happenings.find((x) => x.id === Number(b.dataset.id));
    const reload = () => showHistorial(el);

    switch (b.dataset.action) {
      case 'new': happeningForm(); break;
      case 'edit': happeningForm(h); break;
      case 'defense': defenseForm(h); break;
      case 'delete':
        if (confirm('¿Borrar este acontecimiento?')) {
          run(async () => { await api.deleteHappening(h.id); toast('Acontecimiento borrado'); await reload(); });
        }
        break;
      case 'like':
      case 'dislike': {
        const value = b.dataset.action === 'like';
        const mine = h.votes.find((v) => v.voter_id === state.me.id);
        b.disabled = true;
        run(async () => {
          // Tocar otra vez el mismo voto lo quita
          if (mine && mine.value === value) await api.removeVote(h.id, state.me.id);
          else await api.vote(h.id, state.me.id, value);
          await reload();
        });
        break;
      }
      case 'approve':
      case 'reject': {
        const accept = b.dataset.action === 'approve';
        if (confirm(`¿${accept ? 'Aprobar' : 'Rechazar'} y cerrar la votación ahora?`)) {
          run(async () => { await api.adminCloseHappening(h.id, accept); toast('Votación cerrada'); await reload(); });
        }
        break;
      }
    }
  };
}

function happeningCard(h) {
  const now = Date.now();
  const editUntil = new Date(h.created_at).getTime() + EDIT_MS;
  const closes = new Date(h.closes_at).getTime();
  const open = h.status === 'abierto' && now < closes;
  const isSender = h.from_user === state.me.id;
  const isRecipient = h.to_user === state.me.id;
  const canEdit = open && isSender && now < editUntil;

  const likes = h.votes.filter((v) => v.value);
  const dislikes = h.votes.filter((v) => !v.value);
  const names = (vs) => vs.map((v) => esc(v.voter?.display_name)).join(', ');
  const myVote = h.votes.find((v) => v.voter_id === state.me.id);

  // Línea de estado / tiempo
  let timeInfo;
  if (open) timeInfo = `Cierra en <b data-closes="${closes}">${fmtLeft(closes - now)}</b>`;
  else if (h.status === 'abierto') timeInfo = 'Cerrando…';
  else timeInfo = `Cerrado ${fmtDate(h.closed_at)}${h.closed_by ? ` por ${esc(h.closer?.display_name ?? 'admin')}` : ''}`;

  // Botones
  let actions = '';
  if (open) {
    if (isRecipient) {
      actions += `<button class="btn small" data-action="defense" data-id="${h.id}">${h.defense ? 'Editar descargo' : 'Escribir descargo'}</button>`;
    } else {
      actions += `
        <button class="btn vote-yes ${myVote?.value === true ? 'chosen' : ''}" data-action="like" data-id="${h.id}">👍 Like</button>
        <button class="btn vote-no ${myVote?.value === false ? 'chosen' : ''}" data-action="dislike" data-id="${h.id}">👎 No like</button>`;
    }
    if (canEdit) {
      actions += `
        <span class="muted note">Puedes editar durante <b data-until="${editUntil}">${fmtLeft(editUntil - now)}</b></span>
        <button class="btn small" data-action="edit" data-id="${h.id}">Editar</button>
        <button class="btn small danger" data-action="delete" data-id="${h.id}">Borrar</button>`;
    }
    if (state.me.is_admin) {
      actions += `
        <span class="admin-row">
          <button class="btn small ok" data-action="approve" data-id="${h.id}">✓ Aprobar ya</button>
          <button class="btn small danger" data-action="reject" data-id="${h.id}">✗ Rechazar ya</button>
        </span>`;
    }
  }
  if (state.me.is_admin && !canEdit) {
    actions += `<button class="btn small danger ghost" data-action="delete" data-id="${h.id}">Borrar</button>`;
  }

  return `
    <article class="card claim ${isRecipient ? 'to-me' : ''}">
      <div class="claim-head">
        <span class="from-to"><small>De</small> <b>${esc(h.sender?.display_name)}</b>
          <small>para</small> <b>${esc(h.recipient?.display_name)}</b></span>
        <span class="badge ${h.status}">${STATUS_LABEL[h.status]}</span>
      </div>
      <div class="claim-event">${esc(h.category?.name)} <span class="pts-tag">${pts(h.points)}</span></div>
      <p class="claim-desc">${esc(h.comment)}</p>
      ${h.defense ? `
        <div class="defense">
          <small>Descargo de ${esc(h.recipient?.display_name)}</small>
          <p>${esc(h.defense)}</p>
        </div>` : ''}
      <div class="claim-meta">
        <span>${fmtDate(h.created_at)}</span>
        <span>${timeInfo}</span>
      </div>
      <div class="votes-line">
        <span>👍 ${likes.length}${likes.length ? ` <small>${names(likes)}</small>` : ''}</span>
        <span>👎 ${dislikes.length}${dislikes.length ? ` <small>${names(dislikes)}</small>` : ''}</span>
      </div>
      ${actions ? `<div class="claim-actions">${actions}</div>` : ''}
    </article>`;
}

function happeningForm(h) {
  const others = state.profiles.filter((p) => p.active && p.id !== state.me.id);
  if (!others.length) return toast('Todavía no hay otros usuarios', true);

  formModal({
    title: h ? 'Editar acontecimiento' : 'Nuevo acontecimiento',
    submitLabel: h ? 'Guardar' : 'Cargar acontecimiento',
    fields: [
      {
        name: 'to_user', label: 'Para', type: 'select', required: true, value: h?.to_user,
        options: others.map((p) => ({ value: p.id, label: p.display_name })),
      },
      {
        name: 'category_id', label: 'Categoría', type: 'select', required: true, value: h?.category_id,
        options: state.categories.map((c) => ({ value: c.id, label: `${c.name} (${pts(c.points)})` })),
      },
      { name: 'comment', label: 'Comentarios: ¿qué pasó?', type: 'textarea', required: true, value: h?.comment ?? '' },
    ],
    onSubmit: async (v) => {
      const data = { to_user: v.to_user, category_id: v.category_id, comment: v.comment.trim() };
      if (!data.comment) throw new Error('Escribe un comentario');
      if (h) await api.updateHappening(h.id, data);
      else await api.createHappening(data);
      toast(h ? 'Acontecimiento actualizado' : 'Acontecimiento cargado');
      await showHistorial(view());
    },
  });
}

function defenseForm(h) {
  formModal({
    title: 'Tu descargo',
    submitLabel: 'Guardar descargo',
    fields: [{ name: 'defense', label: 'Cuenta tu versión (los demás pueden cambiar su voto)', type: 'textarea', value: h.defense ?? '' }],
    onSubmit: async (v) => {
      await api.saveDefense(h.id, v.defense.trim());
      toast('Descargo guardado');
      await showHistorial(view());
    },
  });
}

// Cuentas regresivas (cada segundo)
let refreshing = false;
setInterval(() => {
  let expired = false;
  document.querySelectorAll('[data-until], [data-closes]').forEach((b) => {
    const left = Number(b.dataset.until || b.dataset.closes) - Date.now();
    if (left <= 0) expired = true;
    else b.textContent = fmtLeft(left);
  });
  // Si terminó un plazo, se recarga el historial para mostrar el estado correcto
  if (expired && !refreshing && currentTab() === 'historial' && !document.querySelector('.modal')) {
    refreshing = true;
    run(() => showHistorial(view())).finally(() => { refreshing = false; });
  }
}, 1000);


// ---------------------------------------------------------------------
// Pantalla: Reclamos generales sobre el sistema
// ---------------------------------------------------------------------

async function showReclamos(el) {
  state.complaints = await api.getComplaints();
  const list = state.complaints;

  el.innerHTML = `
    <div class="view-head">
      <h2>Reclamos</h2>
      <button class="btn primary" data-action="new">+ Nuevo</button>
    </div>
    <p class="muted intro">Quejas, ideas o problemas con la app. El admin los responde aquí.</p>
    ${list.length ? list.map((c) => `
      <article class="card claim">
        <div class="claim-head">
          <b>${esc(c.author?.display_name)}</b>
          <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
        </div>
        <p class="claim-desc body">${esc(c.body)}</p>
        ${c.response ? `<div class="defense"><small>Respuesta del admin</small><p>${esc(c.response)}</p></div>` : ''}
        <div class="claim-meta"><span>${fmtDate(c.created_at)}</span>
          ${c.resolved_at ? `<span>Resuelto ${fmtDate(c.resolved_at)}</span>` : ''}</div>
        ${(state.me.is_admin || (c.user_id === state.me.id && c.status === 'abierto')) ? `
          <div class="claim-actions">
            ${state.me.is_admin ? `<button class="btn small" data-action="answer" data-id="${c.id}">Responder</button>` : ''}
            <button class="btn small danger ghost" data-action="delete" data-id="${c.id}">Borrar</button>
          </div>` : ''}
      </article>`).join('') : '<p class="muted center">No hay reclamos.</p>'}`;

  const reload = () => showReclamos(el);

  el.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const c = state.complaints.find((x) => x.id === Number(b.dataset.id));

    switch (b.dataset.action) {
      case 'new':
        formModal({
          title: 'Nuevo reclamo', submitLabel: 'Enviar',
          fields: [{ name: 'body', label: '¿Qué quieres reclamar o proponer?', type: 'textarea', required: true }],
          onSubmit: async (v) => {
            if (!v.body.trim()) throw new Error('Escribe algo');
            await api.createComplaint(v.body.trim());
            toast('Reclamo enviado');
            await reload();
          },
        });
        break;
      case 'answer':
        formModal({
          title: 'Responder reclamo',
          fields: [
            { name: 'status', label: 'Estado', type: 'select', value: c.status,
              options: [{ value: 'abierto', label: 'Abierto' }, { value: 'resuelto', label: 'Resuelto' }] },
            { name: 'response', label: 'Respuesta', type: 'textarea', value: c.response ?? '' },
          ],
          onSubmit: async (v) => {
            await api.adminAnswerComplaint(c.id, { status: v.status, response: v.response.trim() });
            toast('Reclamo actualizado');
            await reload();
          },
        });
        break;
      case 'delete':
        if (confirm('¿Borrar este reclamo?')) {
          run(async () => { await api.deleteComplaint(c.id); toast('Reclamo borrado'); await reload(); });
        }
        break;
    }
  };
}


// ---------------------------------------------------------------------
// Pantalla: Admin (usuarios y categorías)
// ---------------------------------------------------------------------

async function showAdmin(el) {
  const [profiles, categories] = await Promise.all([api.getProfiles(), api.getCategories()]);

  el.innerHTML = `
    <div class="view-head">
      <h2>Usuarios</h2>
      <button class="btn primary" data-action="new-user">+ Nuevo</button>
    </div>
    ${profiles.map((p) => `
      <div class="card row-item ${p.active ? '' : 'inactive'}">
        <div class="row-info">
          <b>${esc(p.display_name)}</b> <small class="muted">@${esc(p.username)}</small>
          ${p.is_admin ? '<span class="badge admin">admin</span>' : ''}
          ${p.active ? '' : '<span class="badge rechazado">inactivo</span>'}
        </div>
        <div class="row-actions">
          <button class="btn small" data-action="rename" data-id="${p.id}">Nombre</button>
          <button class="btn small" data-action="password" data-id="${p.id}">Contraseña</button>
          ${p.id === state.me.id ? '' : `
            <button class="btn small" data-action="toggle-admin" data-id="${p.id}">${p.is_admin ? 'Quitar admin' : 'Hacer admin'}</button>
            <button class="btn small ${p.active ? 'danger' : ''}" data-action="toggle-active" data-id="${p.id}">${p.active ? 'Desactivar' : 'Activar'}</button>`}
        </div>
      </div>`).join('')}

    <div class="view-head"><h2>Categorías</h2></div>
    ${categories.map((c) => `
      <div class="card row-item">
        <div class="row-info"><b>${esc(c.name)}</b> <span class="pts-tag">${pts(c.points)}</span></div>
        <div class="row-actions">
          <button class="btn small" data-action="edit-category" data-id="${c.id}">Editar</button>
        </div>
      </div>`).join('')}
    <p class="muted intro">Cambiar el puntaje afecta solo a los acontecimientos nuevos.</p>`;

  const reload = () => showAdmin(el);

  el.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const id = b.dataset.id;
    const p = profiles.find((x) => x.id === id);
    const cat = categories.find((x) => x.id === id);

    switch (b.dataset.action) {
      case 'new-user':
        formModal({
          title: 'Nuevo usuario', submitLabel: 'Crear usuario',
          fields: [
            { name: 'username', label: 'Usuario (para entrar, sin espacios)', required: true,
              attrs: 'autocapitalize="none" pattern="[a-z0-9._\\-]{3,30}" title="3 a 30 minúsculas, números, punto o guion"' },
            { name: 'display_name', label: 'Nombre visible', required: true },
            { name: 'password', label: 'Contraseña inicial (mín. 8)', type: 'password', required: true,
              attrs: 'minlength="8" autocomplete="new-password"' },
          ],
          onSubmit: async (v) => {
            await api.adminCreateUser(v.username.trim().toLowerCase(), v.display_name.trim(), v.password);
            toast('Usuario creado');
            await reload();
          },
        });
        break;

      case 'rename':
        formModal({
          title: `Nombre de @${p.username}`,
          fields: [{ name: 'display_name', label: 'Nombre visible', value: p.display_name, required: true }],
          onSubmit: async (v) => {
            await api.adminUpdateProfile(p.id, { display_name: v.display_name.trim() });
            toast('Nombre actualizado');
            if (p.id === state.me.id) { state.me.display_name = v.display_name.trim(); renderShell(); route(); }
            else await reload();
          },
        });
        break;

      case 'password':
        formModal({
          title: `Nueva contraseña para @${p.username}`,
          fields: [{ name: 'password', label: 'Contraseña (mín. 8)', type: 'password', required: true,
                     attrs: 'minlength="8" autocomplete="new-password"' }],
          onSubmit: async (v) => {
            await api.adminResetPassword(p.id, v.password);
            toast('Contraseña cambiada');
          },
        });
        break;

      case 'toggle-admin':
        if (confirm(`¿${p.is_admin ? 'Quitar' : 'Dar'} permisos de admin a ${p.display_name}?`)) {
          run(async () => { await api.adminUpdateProfile(p.id, { is_admin: !p.is_admin }); await reload(); });
        }
        break;

      case 'toggle-active':
        if (confirm(`¿${p.active ? 'Desactivar' : 'Activar'} a ${p.display_name}?`)) {
          run(async () => { await api.adminSetActive(p.id, !p.active); toast('Hecho'); await reload(); });
        }
        break;

      case 'edit-category':
        formModal({
          title: 'Editar categoría',
          fields: [
            { name: 'name', label: 'Nombre', value: cat.name, required: true },
            { name: 'points', label: 'Puntaje', type: 'number', value: cat.points, required: true, attrs: 'step="1"' },
          ],
          onSubmit: async (v) => {
            await api.adminSaveCategory(cat.id, { name: v.name.trim(), points: Number(v.points) });
            toast('Categoría guardada');
            await reload();
          },
        });
        break;
    }
  };
}


// ---------------------------------------------------------------------
start().catch((e) => { app.innerHTML = `<p class="error center">Error al iniciar: ${esc(e.message)}</p>`; });
