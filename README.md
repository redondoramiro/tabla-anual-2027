# 🏆 Tabla Anual 2027

App web para un grupo de amigos: tabla de puntos, un historial de acontecimientos que se validan por votación y reclamos generales.
Funciona en el navegador de Android, iOS y PC, y se puede "instalar" en la pantalla de inicio.

**App publicada:** <https://redondoramiro.github.io/tabla-anual-2027/>

## Cómo funciona

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Página web (`index.html`, `css/`, `js/`) | **GitHub Pages** (gratis) | Lo que ve el usuario. Solo archivos estáticos, sin compilar. |
| Base de datos + login | **Supabase** (plan gratis) | Usuarios, contraseñas, acontecimientos, votos, reclamos y **todas las reglas de seguridad**. |
| Función `admin-users` | **Supabase Edge Functions** | Crear usuarios, cambiar contraseñas y activar o desactivar usuarios (solo el admin). |

GitHub Pages solo sirve archivos: no puede guardar datos ni validar contraseñas.
Por eso los datos y el login están en Supabase, y la página habla con Supabase desde el navegador.

### Pantallas y reglas

**🏆 Tabla**: puntos de cada usuario, que son la suma de los acontecimientos **aceptados** que recibió.

**📜 Historial**: todos los acontecimientos. Cada uno tiene:

| Campo | Detalle |
|---|---|
| De | Quien lo carga (automático) |
| Para | El usuario destinatario |
| Categoría | Novio nivel básico (+25), intermedio (+50), avanzado (+75) o extremo (+100) |
| Comentarios | Qué pasó |
| Descargo | Lo escribe el destinatario mientras la votación está abierta |
| Votos | 👍 Like / 👎 No like, con los nombres de quién votó qué |

- Votan todos los usuarios **menos el destinatario**. Cada uno puede **cambiar o quitar su voto** mientras esté abierto, por ejemplo después de leer el descargo.
- La votación **se cierra a las 24 h**. Si hay **más likes que no likes**, queda **Aceptado** y los puntos se suman al destinatario. Si hay empate o nadie votó, queda **Rechazado**.
- El **admin** puede **aprobar o rechazar antes** de las 24 h.
- Quien lo cargó puede **editarlo o borrarlo durante 5 minutos**.
- El cierre a las 24 h se procesa la siguiente vez que alguien abre la Tabla o el Historial. No hace falta tener ningún servidor encendido.

**📣 Reclamos**: quejas o ideas generales sobre la app. Cualquiera las escribe y el admin las responde y las marca como resueltas.

**⚙️ Admin** (solo admin): crear usuarios, cambiarles el nombre o la contraseña, activarlos o desactivarlos, dar permisos de admin y cambiar el nombre o el puntaje de las categorías.

Las reglas se aplican **en la base de datos** (`supabase/02-app.sql`), no solo en la página.
Aunque alguien modifique el JavaScript desde su navegador, no puede votar su propio acontecimiento, escribir el descargo de otro ni cambiar estados o puntos.

---

## Puesta en marcha (proyecto nuevo, unos 20 minutos)

### 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com>, crea una cuenta y luego **New project**.
2. Ve a **SQL Editor → New query**, pega [`supabase/01-base.sql`](supabase/01-base.sql) y pulsa **Run**.
   Después haz lo mismo con [`supabase/02-app.sql`](supabase/02-app.sql).
3. Ve a **Authentication → Sign In / Providers** y **desactiva "Allow new users to sign up"**.
   Así nadie puede registrarse solo: los usuarios los crea únicamente el admin.

### 2. Crear tu usuario admin

1. **Authentication → Users → Add user → Create new user**
   - Email: `ramiroredondo@tablaanual2027.app`. Es un email interno: no recibe correos, solo convierte el nombre de usuario en el formato que pide Supabase.
   - Password: la que elijas. **No uses tu número de documento**: es fácil de adivinar y es un dato personal.
   - Si aparece la casilla **Auto Confirm User**, márcala.
2. En **SQL Editor**, ejecuta este bloque. Confirma el usuario, crea su perfil si falta, lo hace admin y muestra el resultado:
   ```sql
   update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
    where email = 'ramiroredondo@tablaanual2027.app';

   insert into profiles (id, username, display_name, is_admin)
   select id, 'ramiroredondo', 'Ramiro', true from auth.users
    where email = 'ramiroredondo@tablaanual2027.app'
   on conflict (id) do update set is_admin = true;

   select u.email, u.email_confirmed_at, p.username, p.is_admin, p.active
     from auth.users u left join profiles p on p.id = u.id;
   ```

### 3. Publicar la función de administración

**Edge Functions → Deploy a new function → Via Editor** → nombre `admin-users` → borra el código de ejemplo y pega
[`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts) → **Deploy**.

### 4. Conectar la página con Supabase

En [`js/config.js`](js/config.js) van la *Project URL* (sin `/rest/v1/`) y la clave **publishable** (`sb_publishable_...`).
Las dos aparecen en el botón **Connect** de Supabase.

> La clave *publishable* está pensada para ser pública. Lo que protege los datos son las reglas SQL.
> **Nunca** pongas en el repositorio la clave *secret* / *service_role* ni contraseñas.

### 5. Publicar en GitHub Pages

**Settings → Pages → Deploy from a branch** → `main`, carpeta `/ (root)`.
En el plan gratis de GitHub el repositorio debe ser público.

### 6. Instalarla en el móvil (opcional)

- **iPhone (Safari)**: botón Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Añadir a pantalla de inicio* o *Instalar app*.

---

## Copias de seguridad

Cada día se guarda una copia completa de la base de datos en el repositorio **privado** `redondoramiro/tabla-anual-2027-backups`.
Su README explica cómo restaurarla.

## Hacer cambios

No hay nada que compilar: editas un archivo, haces commit y push, y GitHub Pages lo publica en 1 o 2 minutos.

**Para cambios en la base de datos:**
1. Haz un backup manual: en el repositorio de backups, **Actions → Run workflow**.
2. Ejecuta la migración nueva (`03-...sql`, `04-...sql`…).
3. Publica la web.

**Nunca vuelvas a ejecutar `01-base.sql` ni `02-app.sql`** en un proyecto que ya tiene datos: son solo para instalar desde cero.

| Quiero cambiar… | Dónde |
|---|---|
| Colores, tamaños | `css/styles.css` (variables al principio) |
| Textos y pantallas | `js/app.js` (una función `show...` por pantalla) |
| Consultas a la base | `js/api.js` |
| Nombre o puntaje de las categorías | Desde la app: **Admin → Categorías** |
| Duración de la votación (24 h) | `voting_window()` en `02-app.sql` |
| Minutos para editar (5) | `edit_window()` en `01-base.sql` **y** `EDIT_MINUTES` en `js/config.js` |
| Regla para aceptar (más likes que no likes) | función `close_due_happenings` en `02-app.sql` |

Los cambios en los `.sql` no se aplican solos: hay que ejecutar en el SQL Editor de Supabase la parte modificada.
Por ejemplo, el `create or replace function ...` completo.

**Probar en tu PC antes de subir:** abre la carpeta en VS Code con la extensión **Live Server** y pulsa *Go Live*.
Abrir el `index.html` con doble clic no funciona, porque los navegadores bloquean los módulos JS en archivos locales.

---

## Seguridad: qué protege y qué no

**Protege:**
- Login con contraseña cifrada y HTTPS.
- Sin registro público: solo el admin crea usuarios.
- Un usuario desactivado queda bloqueado.
- Reglas en la base de datos (Row Level Security): solo usuarios activos ven datos y cada uno solo puede hacer lo que le corresponde.
- La página no aparece en buscadores (`noindex`).

**Limitaciones:**
- El código es público, porque el repositorio es público. No es un problema mientras no subas secretos.
- Cualquiera puede ver la pantalla de login, aunque sin usuario no ve ningún dato.
- No hay recuperación de contraseña por email: el admin pone una nueva.
- **Supabase gratis pausa el proyecto tras 7 días sin actividad**. Se reactiva desde su panel con **Restore** y los datos no se pierden.
- No se actualiza en tiempo real: los datos se refrescan al cambiar de pantalla o al volver a la app.
- No es apto para dinero ni datos sensibles: es una app de amigos con seguridad básica razonable.

## Estructura

```
index.html                 página única
css/styles.css             estilos (móvil primero, modo oscuro automático)
js/config.js               URL y clave pública de Supabase
js/api.js                  todas las llamadas a Supabase
js/app.js                  pantallas: login, tabla, historial, reclamos, admin
manifest.webmanifest       para "instalar" en el móvil
icon.svg                   icono
supabase/01-base.sql       usuarios y permisos básicos
supabase/02-app.sql        categorías, acontecimientos, votos, reclamos y reglas
supabase/functions/admin-users/index.ts   gestión de usuarios (admin)
```
