// =====================================================================
// Acceso a datos (Supabase). Toda la comunicación con el servidor está aquí.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Devuelve los datos o lanza un error con un mensaje entendible
function check({ data, error }) {
  if (error) throw new Error(traducir(error.message));
  return data;
}

function traducir(msg) {
  if (/row-level security/i.test(msg)) return 'No tienes permiso para hacer eso (o ya pasó el plazo).';
  if (/duplicate key/i.test(msg)) return 'Ya existe un registro igual.';
  if (/check constraint/i.test(msg)) return 'Hay un dato inválido (¿texto vacío o demasiado largo?).';
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

// ---------- Usuarios y categorías ----------

export async function getMyProfile(userId) {
  return check(await sb.from('profiles').select('*').eq('id', userId).single());
}

export async function getProfiles() {
  return check(await sb.from('profiles').select('*').order('display_name'));
}

export async function getCategories() {
  return check(await sb.from('categories').select('*').order('sort'));
}

// ---------- Tabla de puntos ----------

// Cierra las votaciones que ya cumplieron 24 h (suma los puntos)
export async function closeDue() {
  check(await sb.rpc('close_due_happenings'));
}

export async function getLeaderboard() {
  return check(await sb.from('leaderboard').select('*')
    .order('points', { ascending: false })
    .order('display_name'));
}

// ---------- Acontecimientos (historial) ----------

// Los nombres tras "!" indican qué relación usar, porque happenings
// tiene varias columnas que apuntan a profiles (remitente, destinatario…)
const HAPPENING_FIELDS = `
  *,
  sender:profiles!happenings_from_user_fkey(id, display_name),
  recipient:profiles!happenings_to_user_fkey(id, display_name),
  closer:profiles!happenings_closed_by_fkey(display_name),
  category:categories(name),
  votes:happening_votes(voter_id, value, voter:profiles(display_name))
`;

export async function getHappenings() {
  return check(await sb.from('happenings')
    .select(HAPPENING_FIELDS)
    .order('created_at', { ascending: false })
    .limit(300));
}

export async function createHappening({ to_user, category_id, comment }) {
  check(await sb.from('happenings').insert({ to_user, category_id, comment }));
}

export async function updateHappening(id, { to_user, category_id, comment }) {
  const rows = check(await sb.from('happenings')
    .update({ to_user, category_id, comment }).eq('id', id).select('id'));
  if (!rows.length) throw new Error('Ya no se puede editar: pasó el plazo.');
}

export async function saveDefense(id, defense) {
  const rows = check(await sb.from('happenings')
    .update({ defense }).eq('id', id).select('id'));
  if (!rows.length) throw new Error('Ya no se puede cambiar el descargo: la votación está cerrada.');
}

export async function deleteHappening(id) {
  const rows = check(await sb.from('happenings').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error('Ya no se puede borrar: pasó el plazo.');
}

// Crea o cambia el voto del usuario (like = true, no like = false)
export async function vote(happening_id, voter_id, value) {
  check(await sb.from('happening_votes')
    .upsert({ happening_id, voter_id, value }, { onConflict: 'happening_id,voter_id' }));
}

export async function removeVote(happening_id, voter_id) {
  check(await sb.from('happening_votes').delete()
    .eq('happening_id', happening_id).eq('voter_id', voter_id));
}

export async function adminCloseHappening(id, accept) {
  check(await sb.rpc('admin_close_happening', { p_id: id, p_accept: accept }));
}

// ---------- Reclamos generales ----------

export async function getComplaints() {
  return check(await sb.from('complaints')
    .select('*, author:profiles(id, display_name)')
    .order('created_at', { ascending: false })
    .limit(200));
}

export async function createComplaint(body) {
  check(await sb.from('complaints').insert({ body }));
}

export async function deleteComplaint(id) {
  const rows = check(await sb.from('complaints').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error('No se puede borrar este reclamo.');
}

export async function adminAnswerComplaint(id, { status, response }) {
  check(await sb.from('complaints').update({ status, response: response || null }).eq('id', id));
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

export async function adminSaveCategory(id, { name, points }) {
  check(await sb.from('categories').update({ name, points }).eq('id', id));
}
