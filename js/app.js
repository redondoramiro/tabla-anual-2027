// =====================================================================
// Interfaz de la app: login, menú y pantallas.
// Cada pantalla es una función show...() que dibuja HTML dentro de #view.
// =====================================================================

import * as api from './api.js';
import { EDIT_MINUTES } from './config.js';

const app = document.getElementById('app');
const EDIT_MS = EDIT_MINUTES * 60 * 1000;

const state = {
  me: null,           // perfil del usuario conectado
  events: [],         // acontecimientos activos
  claims: [],         // reclamos cargados
  activeUsers: 0,     // usuarios activos (para calcular votantes)
  filter: 'pendiente' // filtro de la pantalla Reclamos
};

const STATUS_LABEL = { pendiente: 'Pendiente', aceptado: 'Aceptado', rechazado: 'Rechazado' };


// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

// Escapa texto para meterlo en HTML sin riesgo (evita inyección de código)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => new Date(iso).toLocaleString('es', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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


// ---------------------------------------------------------------------
// Formulario en ventana emergente (se usa para todo: reclamos, usuarios…)
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
    return `<label>${label}<textarea name="${f.name}" rows="3" maxlength="500" ${req}>${esc(f.value)}</textarea></label>`;
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

function renderShell() {
  const tabs = [['tabla', '🏆', 'Tabla'], ['reclamos', '📣', 'Reclamos']];
  if (state.me.is_admin) tabs.push(['admin', '⚙️', 'Admin']);

  app.innerHTML = `
    <header class="topbar">
      <span class="brand">🏆 Tabla Anual 2027</span>
      <span class="me">${esc(state.me.display_name)}
        <button class="btn link" id="logout">Salir</button></span>
    </header>
    <main id="view"></main>
    <nav class="tabs">
      ${tabs.map(([id, icon, label]) =>
        `<a href="#${id}" data-tab="${id}"><span class="icon">${icon}</span>${label}</a>`).join('')}
    </nav>`;

  document.getElementById('logout').onclick = async () => {
    await api.logout();
    location.hash = '';
    renderLogin();
  };
}

async function route() {
  if (!state.me) return;
  let tab = location.hash.slice(1) || 'tabla';
  if (tab === 'admin' && !state.me.is_admin) tab = 'tabla';
  if (!['tabla', 'reclamos', 'admin'].includes(tab)) tab = 'tabla';

  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === tab));

  const el = view();
  if (!el.innerHTML) el.innerHTML = '<p class="muted center">Cargando…</p>';

  await run(async () => {
    if (tab === 'tabla') await showTabla(el);
    if (tab === 'reclamos') await showReclamos(el);
    if (tab === 'admin') await showAdmin(el);
  });
}

window.addEventListener('hashchange', () => { view() && (view().innerHTML = ''); route(); });

// Al volver a la app (por ejemplo, desde otra app del móvil) se refrescan los datos
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me && !document.querySelector('.modal')) route();
});


// ---------------------------------------------------------------------
// Pantalla: Tabla de puntos
// ---------------------------------------------------------------------

async function showTabla(el) {
  const rows = await api.getLeaderboard();
  const medals = ['🥇', '🥈', '🥉'];

  el.innerHTML = `
    <div class="view-head"><h2>Tabla de puntos</h2></div>
    <ol class="ranking">
      ${rows.map((r, i) => `
        <li class="card rank-row ${r.id === state.me.id ? 'mine' : ''}">
          <span class="pos">${medals[i] ?? i + 1}</span>
          <span class="name">${esc(r.display_name)}
            <small>${r.accepted} aceptados · ${r.pending} pendientes</small></span>
          <span class="pts">${r.points}<small>pts</small></span>
        </li>`).join('')}
    </ol>`;
}


// ---------------------------------------------------------------------
// Pantalla: Reclamos
// ---------------------------------------------------------------------

async function showReclamos(el) {
  const [events, claims, profiles] = await Promise.all([
    api.getEvents(), api.getClaims(), api.getProfiles(),
  ]);
  state.events = events;
  state.claims = claims;
  state.activeUsers = profiles.filter((p) => p.active).length;
  drawReclamos(el);
}

function drawReclamos(el) {
  const filters = [['pendiente', 'Pendientes'], ['aceptado', 'Aceptados'],
                   ['rechazado', 'Rechazados'], ['todos', 'Todos']];
  const list = state.claims.filter((c) => state.filter === 'todos' || c.status === state.filter);

  el.innerHTML = `
    <div class="view-head">
      <h2>Reclamos</h2>
      <button class="btn primary" data-action="new">+ Nuevo</button>
    </div>
    <div class="filters">
      ${filters.map(([k, l]) =>
        `<button class="chip ${state.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    ${list.length ? list.map(claimCard).join('') : '<p class="muted center">No hay reclamos aquí.</p>'}`;

  el.onclick = (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { state.filter = f.dataset.filter; drawReclamos(el); return; }

    const b = e.target.closest('[data-action]');
    if (!b) return;
    const claim = state.claims.find((c) => c.id === Number(b.dataset.id));

    switch (b.dataset.action) {
      case 'new': claimForm(); break;
      case 'edit': claimForm(claim); break;
      case 'delete':
        if (confirm('¿Borrar este reclamo?')) {
          run(async () => { await api.deleteClaim(claim.id); toast('Reclamo borrado'); await showReclamos(el); });
        }
        break;
      case 'yes':
      case 'no':
        b.disabled = true;
        run(async () => {
          await api.vote(claim.id, b.dataset.action === 'yes');
          toast('Voto registrado');
          await showReclamos(el);
        });
        break;
    }
  };
}

function claimCard(c) {
  const now = Date.now();
  const until = new Date(c.created_at).getTime() + EDIT_MS;
  const inWindow = now < until;
  const mine = c.user_id === state.me.id;
  const yes = c.votes.filter((v) => v.value).length;
  const no = c.votes.length - yes;
  const myVote = c.votes.find((v) => v.voter_id === state.me.id);
  const voters = Math.max(state.activeUsers - 1, 0);
  const timer = `<b data-until="${until}">${mmss(until - now)}</b>`;

  let actions = '';
  if (c.status === 'pendiente') {
    if (mine && inWindow) {
      actions = `<span class="muted">Puedes editar durante ${timer}</span>
        <button class="btn small" data-action="edit" data-id="${c.id}">Editar</button>
        <button class="btn small danger" data-action="delete" data-id="${c.id}">Borrar</button>`;
    } else if (mine) {
      actions = '<span class="muted">Esperando los votos del resto</span>';
    } else if (inWindow) {
      actions = `<span class="muted">La votación abre en ${timer}</span>`;
    } else if (myVote) {
      actions = `<span class="muted">Votaste ${myVote.value ? 'Sí 👍' : 'No 👎'}</span>`;
    } else {
      actions = `
        <button class="btn vote-yes" data-action="yes" data-id="${c.id}">👍 Sí</button>
        <button class="btn vote-no" data-action="no" data-id="${c.id}">👎 No</button>`;
    }
  }
  // El admin puede borrar cualquier reclamo (moderación)
  if (state.me.is_admin && !(mine && inWindow && c.status === 'pendiente')) {
    actions += `<button class="btn small danger ghost" data-action="delete" data-id="${c.id}">Borrar</button>`;
  }

  return `
    <article class="card claim">
      <div class="claim-head">
        <b>${esc(c.author?.display_name)}</b>
        <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
      </div>
      <div class="claim-event">${esc(c.event?.name)} <span class="pts-tag">${c.points > 0 ? '+' : ''}${c.points}</span></div>
      ${c.description ? `<p class="claim-desc">${esc(c.description)}</p>` : ''}
      <div class="claim-meta">
        <span>${fmtDate(c.created_at)}</span>
        <span>👍 ${yes} · 👎 ${no} <small>(${voters} votantes)</small></span>
      </div>
      ${actions ? `<div class="claim-actions">${actions}</div>` : ''}
    </article>`;
}

function claimForm(claim) {
  const events = [...state.events];
  // Si el acontecimiento del reclamo ya no está activo, igual se muestra
  if (claim && !events.some((e) => e.id === claim.event_id)) {
    events.push({ id: claim.event_id, name: claim.event?.name ?? '?', points: claim.points });
  }
  if (!events.length) return toast('El admin todavía no cargó acontecimientos', true);

  formModal({
    title: claim ? 'Editar reclamo' : 'Nuevo reclamo',
    submitLabel: claim ? 'Guardar' : 'Crear reclamo',
    fields: [
      {
        name: 'event_id', label: 'Acontecimiento', type: 'select', required: true,
        value: claim?.event_id,
        options: events.map((e) => ({ value: e.id, label: `${e.name} (${e.points > 0 ? '+' : ''}${e.points})` })),
      },
      { name: 'description', label: 'Detalle (opcional)', type: 'textarea', value: claim?.description ?? '' },
    ],
    onSubmit: async ({ event_id, description }) => {
      if (claim) await api.updateClaim(claim.id, Number(event_id), description.trim());
      else await api.createClaim(Number(event_id), description.trim());
      toast(claim ? 'Reclamo actualizado' : 'Reclamo creado');
      state.filter = 'pendiente';
      await showReclamos(view());
    },
  });
}

// Cuenta regresiva de los reclamos (cada segundo)
setInterval(() => {
  let expired = false;
  document.querySelectorAll('[data-until]').forEach((b) => {
    const left = Number(b.dataset.until) - Date.now();
    if (left <= 0) expired = true;
    else b.textContent = mmss(left);
  });
  // Al terminar un plazo, se redibuja para mostrar los botones correctos
  if (expired && location.hash === '#reclamos' && !document.querySelector('.modal')) {
    drawReclamos(view());
  }
}, 1000);


// ---------------------------------------------------------------------
// Pantalla: Admin (usuarios y acontecimientos)
// ---------------------------------------------------------------------

async function showAdmin(el) {
  const [profiles, events] = await Promise.all([api.getProfiles(), api.getEvents(false)]);

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

    <div class="view-head">
      <h2>Acontecimientos</h2>
      <button class="btn primary" data-action="new-event">+ Nuevo</button>
    </div>
    ${events.map((ev) => `
      <div class="card row-item ${ev.active ? '' : 'inactive'}">
        <div class="row-info">
          <b>${esc(ev.name)}</b> <span class="pts-tag">${ev.points > 0 ? '+' : ''}${ev.points}</span>
          ${ev.active ? '' : '<span class="badge rechazado">inactivo</span>'}
        </div>
        <div class="row-actions">
          <button class="btn small" data-action="edit-event" data-id="${ev.id}">Editar</button>
          <button class="btn small" data-action="toggle-event" data-id="${ev.id}">${ev.active ? 'Desactivar' : 'Activar'}</button>
        </div>
      </div>`).join('')}`;

  const reload = () => showAdmin(el);

  el.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const id = b.dataset.id;
    const p = profiles.find((x) => x.id === id);
    const ev = events.find((x) => String(x.id) === id);

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

      case 'new-event':
      case 'edit-event':
        formModal({
          title: ev ? 'Editar acontecimiento' : 'Nuevo acontecimiento',
          fields: [
            { name: 'name', label: 'Nombre', value: ev?.name ?? '', required: true },
            { name: 'points', label: 'Puntaje', type: 'number', value: ev?.points ?? 5, required: true, attrs: 'step="1"' },
          ],
          onSubmit: async (v) => {
            await api.adminSaveEvent({ id: ev?.id, name: v.name.trim(), points: Number(v.points) });
            toast('Acontecimiento guardado');
            await reload();
          },
        });
        break;

      case 'toggle-event':
        run(async () => { await api.adminSaveEvent({ id: ev.id, active: !ev.active }); await reload(); });
        break;
    }
  };
}


// ---------------------------------------------------------------------
start().catch((e) => { app.innerHTML = `<p class="error center">Error al iniciar: ${esc(e.message)}</p>`; });
