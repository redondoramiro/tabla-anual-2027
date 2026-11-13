// =====================================================================
// Configuración de la app — lo único que tienes que completar.
// Los valores están en Supabase → Project Settings → API Keys / Data API
// =====================================================================

// URL del proyecto, por ejemplo 'https://abcdefghijk.supabase.co'
export const SUPABASE_URL = 'https://ibbeycsmaasgcvwtimko.supabase.co';

// Clave PÚBLICA ("publishable" o "anon"). Está pensada para ir en la web.
// ¡NUNCA pongas aquí la clave "secret" ni la "service_role"!
export const SUPABASE_KEY = 'sb_publishable_0OSlTOGOMiBZt-duhWNHow_t8PdvdCV';

// Dominio inventado para convertir "usuario" en un email interno de Supabase.
// No se envía ningún correo. Debe ser igual al de supabase/functions/admin-users/index.ts
export const EMAIL_DOMAIN = 'tablaanual2027.app';

// Minutos para editar un reclamo. Debe coincidir con edit_window() en schema.sql
export const EDIT_MINUTES = 5;
