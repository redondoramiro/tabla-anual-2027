// =====================================================================
// Supabase Edge Function: admin-users
//
// Hace las tareas que requieren la clave secreta de Supabase, que NUNCA
// debe estar en la página web:
//   - create          crear un usuario
//   - reset_password  cambiar la contraseña de un usuario
//   - set_active      activar / desactivar un usuario
//
// Solo responde si quien llama es un usuario admin y activo.
// Despliegue: Supabase → Edge Functions → Deploy a new function →
//             Via Editor → nombre "admin-users" → pegar este archivo → Deploy
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

// Debe ser igual a EMAIL_DOMAIN en js/config.js
const EMAIL_DOMAIN = 'tablaanual2027.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // Cliente con permisos totales (solo existe en el servidor de Supabase)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // ¿Quién llama? ¿Es admin?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: 'Sesión inválida, vuelve a entrar' }, 401);

    const { data: me } = await admin
      .from('profiles').select('is_admin, active').eq('id', user.id).single();
    if (!me?.is_admin || !me.active) return json({ error: 'Solo el admin puede hacer esto' }, 403);

    const body = await req.json();

    switch (body.action) {
      case 'create': {
        const username = String(body.username ?? '').trim().toLowerCase();
        const display_name = String(body.display_name ?? '').trim() || username;
        const password = String(body.password ?? '');

        if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
          return json({ error: 'Usuario inválido: de 3 a 30 caracteres, solo minúsculas, números, punto, guion o guion bajo' }, 400);
        }
        if (password.length < 8) {
          return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
        }

        const { data, error } = await admin.auth.admin.createUser({
          email: `${username}@${EMAIL_DOMAIN}`,
          password,
          email_confirm: true,
          user_metadata: { username, display_name },
        });
        if (error) {
          const msg = /already|registered|exists/i.test(error.message)
            ? 'Ese nombre de usuario ya existe' : error.message;
          return json({ error: msg }, 400);
        }
        return json({ id: data.user.id });
      }

      case 'reset_password': {
        const password = String(body.password ?? '');
        if (password.length < 8) {
          return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case 'set_active': {
        if (body.user_id === user.id) {
          return json({ error: 'No puedes desactivarte a ti mismo' }, 400);
        }
        const active = Boolean(body.active);

        // Un usuario desactivado queda bloqueado y no puede iniciar sesión
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          ban_duration: active ? 'none' : '876000h',
        });
        if (error) return json({ error: error.message }, 400);

        const { error: e2 } = await admin.from('profiles').update({ active }).eq('id', body.user_id);
        if (e2) return json({ error: e2.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
