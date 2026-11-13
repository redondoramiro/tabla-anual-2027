// =====================================================================
// Acceso a datos (Supabase). Toda la comunicación con el servidor está aquí.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Devuelve los datos o lanza un error con el mensaje de Supabase
function check({ data, error }) {
  if (error) throw new Error(traducir(error.message));
  return data;
}

function traducir(msg) {
  if (/row-level security/i.test(msg)) return 'No tienes permiso para hacer eso (o pasó el plazo).';
  if (/duplicate key.*votes/i.test(msg)) return 'Ya votaste este reclamo.';
  if (/duplicate key/i.test(msg)) return 'Ya existe un registro con ese nombre.';
  return msg;
}

// ---------- Sesión ----------

export const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export async function login(username, password) {
  const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) throw new Error('Usuario o contraseña incorrectos');
}

export const logout = () => sb.auth.signOut();

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

// ---------- Lecturas ----------

export async function getMyProfile(userId) {
  return check(await sb.from('profiles').select('*').eq('id', userId).single());
}

export async function getProfiles() {
  return check(await sb.from('profiles').select('*').order('display_name'));
}

export async function getLeaderboard() {
  return check(await sb.from('leaderboard').select('*')
    .order('points', { ascending: false })
    .order('display_name'));
}

export async function getEvents(onlyActive = true) {
  let q = sb.from('events').select('*').order('name');
  if (onlyActive) q = q.eq('active', true);
  return check(await q);
}

export async function getClaims() {
  return check(await sb.from('claims')
    .select('*, author:profiles(id, display_name), event:events(name), votes(voter_id, value)')
    .order('created_at', { ascending: false })
    .limit(200));
}

// ---------- Reclamos y votos ----------

export async function createClaim(event_id, description) {
  check(await sb.from('claims').insert({ event_id, description: description || null }));
}

export async function updateClaim(id, event_id, description) {
  const rows = check(await sb.from('claims')
    .update({ event_id, description: description || null }).eq('id', id).select('id'));
  if (!rows.length) throw new Error('Ya no se puede editar: pasó el plazo.');
}

export async function deleteClaim(id) {
  const rows = check(await sb.from('claims').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error('Ya no se puede borrar: pasó el plazo.');
}

export async function vote(claim_id, value) {
  check(await sb.from('votes').insert({ claim_id, value }));
}

// ---------- Admin ----------

// Llama a la Edge Function "admin-users" (crear usuario, contraseña, activar)
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* sin detalle */ }
    throw new Error(msg);
  }
  return data;
}

export const adminCreateUser = (username, display_name, password) =>
  adminCall({ action: 'create', username, display_name, password });

export const adminResetPassword = (user_id, password) =>
  adminCall({ action: 'reset_password', user_id, password });

export const adminSetActive = (user_id, active) =>
  adminCall({ action: 'set_active', user_id, active });

export async function adminUpdateProfile(id, fields) {
  check(await sb.from('profiles').update(fields).eq('id', id));
}

export async function adminSaveEvent({ id, ...fields }) {
  if (id) check(await sb.from('events').update(fields).eq('id', id));
  else check(await sb.from('events').insert(fields));
}
