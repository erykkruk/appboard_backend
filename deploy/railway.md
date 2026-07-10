# Deploy AppBoard on Railway

Railway multi-service templates are created and published from the dashboard
(there is no repo config file for them). It takes ~3 minutes.

## Steps

1. **New Project → Empty Project.**
2. **Add PostgreSQL**: *New → Database → Add PostgreSQL*.
3. **Add the backend**: *New → Docker Image* → `ghcr.io/erykkruk/appboard-backend:latest`.
   Name it `appboard-backend`. Set variables:
   - `NODE_ENV` = `production`
   - `PORT` = `6680`
   - `DB_URL` = `${{Postgres.DATABASE_URL}}`
   - `BETTER_AUTH_SECRET` = a long random string (min 32 chars)
   - `BETTER_AUTH_URL` = `https://${{appboard-web.RAILWAY_PUBLIC_DOMAIN}}`
   - `ALLOWED_ORIGINS` = `https://${{appboard-web.RAILWAY_PUBLIC_DOMAIN}}`
   - `ENCRYPTION_KEY` = *(leave empty — generated on first boot)*
   - `ADMIN_EMAIL` = `admin@example.com`
   - `ADMIN_PASSWORD` = a password for the first login
   - Attach a **Volume** at `/app/data`.
4. **Add the panel**: *New → Docker Image* → `ghcr.io/erykkruk/appboard-web:latest`.
   Name it `appboard-web`. Set variables:
   - `NODE_ENV` = `production`
   - `PORT` = `6600`
   - `HOSTNAME` = `0.0.0.0`
   - `BACKEND_URL` = `http://appboard-backend.railway.internal:6680`
   - Under *Settings → Networking*, **Generate Domain**.
5. Open the panel domain and sign in with `ADMIN_EMAIL` + `ADMIN_PASSWORD`
   using **"Sign in with a password"**.

## Publish as a one-click template (optional)

*Project → Settings → Publish as Template* to get a `railway.app/template/...`
URL and a **Deploy on Railway** button (and Kickback rewards on deploys).
