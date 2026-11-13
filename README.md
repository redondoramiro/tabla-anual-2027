# 🏆 Tabla Anual 2027

App web para un grupo de amigos: tabla de puntos y reclamos que se validan por votación.
Funciona en el navegador de Android, iOS y PC, y se puede "instalar" en la pantalla de inicio.

## Cómo funciona

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Página web (`index.html`, `css/`, `js/`) | **GitHub Pages** (gratis) | Lo que ve el usuario. Solo archivos estáticos, sin compilar. |
| Base de datos + login | **Supabase** (plan gratis) | Usuarios, contraseñas, reclamos, votos y **todas las reglas de seguridad**. |
| Función `admin-users` | **Supabase Edge Functions** | Crear usuarios, cambiar contraseñas y activar o desactivar usuarios (solo el admin). |

GitHub Pages solo sirve archivos: no puede guardar datos ni validar contraseñas.
Por eso los datos y el login están en Supabase, y la página habla con Supabase desde el navegador.

### Reglas de la app

- **Tabla de puntos**: suma de los puntos de los reclamos **aceptados** de cada usuario.
- **Reclamos**: se elige un acontecimiento del catálogo, cada uno con un puntaje fijo.
  - El autor puede **editar o borrar** su reclamo durante **5 minutos** desde que lo crea.
  - Al terminar esos 5 minutos, se abre la **votación**: vota el resto de los usuarios activos, Sí o No. El voto no se puede cambiar.
  - **Aceptado**: los "Sí" llegan a mayoría (con 4 votantes hacen falta 3). Se suman los puntos.
  - **Rechazado**: ya no es posible llegar a esa mayoría (con 4 votantes alcanzan 2 "No"; un empate 2-2 se rechaza). No se suman puntos.
  - Mientras se vota, el reclamo está **Pendiente**.
- **Admin**: crea usuarios, cambia nombres y contraseñas, activa o desactiva usuarios, da permisos de admin y gestiona el catálogo de acontecimientos. También puede borrar cualquier reclamo.

Las reglas se aplican **en la base de datos** (`supabase/schema.sql`), no solo en la página.
Aunque alguien modifique el JavaScript desde su navegador, no puede votar dos veces, editar fuera de plazo ni sumarse puntos.

---

## Puesta en marcha (una sola vez, unos 20 minutos)

### 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com>, crea una cuenta y luego **New project**.
   Elige una región cercana y guarda la contraseña de la base de datos en un lugar seguro.
2. Ve a **SQL Editor → New query**, pega el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
3. Ve a **Authentication → Sign In / Providers** y **desactiva "Allow new users to sign up"**.
   Así nadie puede registrarse solo: los usuarios los crea únicamente el admin.

### 2. Crear tu usuario admin

1. **Authentication → Users → Add user → Create new user**
   - Email: `ramiroredondo@tablaanual2027.app`. Es un email interno: no recibe correos, solo convierte el nombre de usuario en el formato que pide Supabase.
   - Password: la que elijas. **No uses tu número de documento**: es fácil de adivinar y es un dato personal.
   - Marca **Auto Confirm User**.
2. En **SQL Editor**, ejecuta:
   ```sql
   update profiles set is_admin = true where username = 'ramiroredondo';
   ```

### 3. Publicar la función de administración

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `admin-users`.
3. Pega el contenido de [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts) y pulsa **Deploy**.

### 4. Conectar la página con Supabase

1. En Supabase: **Project Settings → Data API** (copia la *Project URL*) y **API Keys** (copia la clave **publishable** o **anon**).
2. Pégalas en [`js/config.js`](js/config.js), en `SUPABASE_URL` y `SUPABASE_KEY`.
3. Haz commit y push.

> La clave *publishable/anon* está pensada para ser pública. Lo que protege los datos son las reglas de `schema.sql`.
> **Nunca** pongas en el repositorio la clave *secret* / *service_role* ni contraseñas.

### 5. Publicar en GitHub Pages

1. En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch** → rama `main`, carpeta `/ (root)` → **Save**.
2. En 1 o 2 minutos la app estará en: `https://redondoramiro.github.io/tabla-anual-2027/`

> En el plan gratuito de GitHub, Pages solo funciona con **repositorios públicos**.
> Con GitHub Pro se puede publicar desde un repositorio privado, aunque la página igualmente es pública.

### 6. Crear a tus amigos

Entra a la app con tu usuario y ve a **Admin → Usuarios → + Nuevo**.
Pásale a cada amigo su usuario y su contraseña inicial.

### 7. Instalarla en el móvil (opcional)

- **iPhone (Safari)**: botón Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Añadir a pantalla de inicio* o *Instalar app*.

---

## Hacer cambios

No hay nada que compilar: editas un archivo, haces commit y push, y GitHub Pages lo publica en 1 o 2 minutos.

| Quiero cambiar… | Archivo |
|---|---|
| Colores, tamaños, tipografía | `css/styles.css` (variables al principio) |
| Textos y pantallas | `js/app.js` (una función `show...` por pantalla) |
| Consultas a la base | `js/api.js` |
| Minutos de edición | `edit_window()` en `schema.sql` **y** `EDIT_MINUTES` en `js/config.js` |
| Regla de votación (mayoría, empate…) | función `resolve_claim` en `schema.sql` |
| Acontecimientos y puntajes | Desde la app: **Admin → Acontecimientos** |

Los cambios en `schema.sql` no se aplican solos: hay que ejecutar en el SQL Editor de Supabase la parte modificada.
Por ejemplo, el `create or replace function ...` completo.

**Probar en tu PC antes de subir:** abre la carpeta en VS Code con la extensión **Live Server** y pulsa *Go Live*.
Otra opción, si tienes Python, es ejecutar `python -m http.server 8000` y abrir <http://localhost:8000>.
Abrir el `index.html` con doble clic no funciona, porque los navegadores bloquean los módulos JS en archivos locales.

---

## Seguridad: qué protege y qué no

**Protege:**
- Login con usuario y contraseña. Supabase guarda las contraseñas cifradas y limita los intentos de inicio de sesión.
- HTTPS automático, tanto en GitHub Pages como en Supabase.
- Sin registro público: solo el admin crea usuarios.
- Un usuario desactivado queda bloqueado y no puede entrar.
- Reglas en la base de datos (Row Level Security): solo usuarios activos ven datos, nadie puede votar su propio reclamo, el voto es único y los puntos salen siempre del catálogo.
- La página no aparece en buscadores (`noindex`).

**Limitaciones:**
- **El código es público** si el repositorio es público. No es un problema mientras no subas secretos, pero cualquiera puede leer cómo funciona la app.
- **La URL es pública**: cualquiera puede ver la pantalla de login, aunque sin usuario no ve ningún dato.
- **No hay recuperación de contraseña por email**: si alguien la olvida, el admin le pone una nueva.
- **Supabase gratis pausa el proyecto tras 7 días sin actividad**. Si pasa, se reactiva desde el panel de Supabase con **Restore**. Los datos no se pierden.
- Límites del plan gratis: 500 MB de base de datos y 50.000 usuarios activos al mes. Para 5 amigos sobra.
- GitHub Pages: 1 GB por sitio y unos 100 GB de tráfico al mes. Sus condiciones de uso no permiten usarlo para negocios o información sensible.
- No es apto para dinero, datos personales sensibles ni nada crítico: es una app de amigos con seguridad básica razonable.
- Las actualizaciones no son en tiempo real: los datos se refrescan al cambiar de pantalla o al volver a la app.

## Estructura

```
index.html                 página única
css/styles.css             estilos (móvil primero, modo oscuro automático)
js/config.js               URL y clave pública de Supabase  ← completar
js/api.js                  todas las llamadas a Supabase
js/app.js                  pantallas: login, tabla, reclamos, admin
manifest.webmanifest       para "instalar" en el móvil
icon.svg                   icono
supabase/schema.sql        tablas, reglas de seguridad y lógica de votación
supabase/functions/admin-users/index.ts   gestión de usuarios (admin)
```
