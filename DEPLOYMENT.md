# Deploying mechanic-movil to a VPS

Written for a fresh Ubuntu 22.04/24.04 VPS (Hostinger or otherwise). Run
through this once when the VPS is first provisioned; the **"Deploying an
update"** section at the bottom is what you (or Claude, with you) run every
time after that.

This assumes two subdomains pointed at the VPS's IP before you start:

- `app.yourdomain.com` → the frontend (static build, served by nginx)
- `api.yourdomain.com` → the backend (Node/Express, proxied by nginx)

Using separate subdomains keeps CORS configuration simple and exact (no
wildcards) and lets each side get its own Let's Encrypt certificate.

---

## 1. Initial server hardening

SSH in as `root` (or whatever Hostinger gives you) **once**, then never
again — everything from here on happens as a normal user.

```bash
adduser deploy
usermod -aG sudo deploy
```

On your **own machine**, copy your SSH public key to the new user (skip if
you already have a key pair; generate one with `ssh-keygen -t ed25519` if
not):

```bash
ssh-copy-id deploy@your-vps-ip
```

Confirm you can log in as `deploy` with the key, in a **second terminal**,
before touching SSH config (so you don't lock yourself out):

```bash
ssh deploy@your-vps-ip
```

Now, back on the VPS as `deploy` (or still as root, your call), disable
password auth and root login over SSH:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

Firewall — only SSH, HTTP, HTTPS:

```bash
sudo apt update && sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

## 2. Install the stack

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# PM2 (keeps the Node process running, restarts on crash/reboot)
sudo npm install -g pm2
```

Create the database and an app-only Postgres role (don't run the app as the
`postgres` superuser):

```bash
sudo -u postgres psql -c "CREATE USER mechanic_movil WITH PASSWORD 'CHANGE-ME-generate-a-real-one';"
sudo -u postgres psql -c "CREATE DATABASE mechanic_movil OWNER mechanic_movil;"
```

## 3. Deploy the code

```bash
sudo mkdir -p /var/www/mechanic-movil
sudo chown deploy:deploy /var/www/mechanic-movil
cd /var/www/mechanic-movil

git clone https://github.com/AlbertoMontes01/mechanic-movil-backend.git backend
git clone https://github.com/AlbertoMontes01/mechanic-movil.git frontend
```

**Backend `.env`** (copy `.env.example`, then edit — every value here needs
to be the real production value, not the dev default):

```bash
cd backend
cp .env.example .env
nano .env
```

```env
DATABASE_URL="postgresql://mechanic_movil:CHANGE-ME-generate-a-real-one@localhost:5432/mechanic_movil?schema=public"
JWT_SECRET="<generate with: openssl rand -base64 48>"
ACCESS_TOKEN_EXPIRES_IN="15m"
REFRESH_TOKEN_DAYS=30
PORT=3001
CORS_ORIGIN="https://app.yourdomain.com"
NODE_ENV="production"
```

```bash
npm install
npx prisma migrate deploy    # NOT `migrate dev` — deploy applies existing
                              # migrations without prompting or generating new ones
```

Start it under PM2 so it survives reboots and crashes:

```bash
pm2 start src/server.js --name mechanic-movil-backend
pm2 save
pm2 startup   # follow the one printed command to enable on-boot start
```

**Frontend build:**

```bash
cd /var/www/mechanic-movil/frontend
cp .env.example .env
```

```env
VITE_API_URL="https://api.yourdomain.com/api"
```

```bash
npm install
npm run build     # outputs to dist/ — this is what nginx serves
```

## 4. nginx + HTTPS

`/etc/nginx/sites-available/mechanic-movil-app` (frontend, static):

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;
    root /var/www/mechanic-movil/frontend/dist;
    index index.html;

    # SPA: any path that isn't a real file falls back to index.html so
    # client-side routing (react-router) works on a hard refresh/deep link.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`/etc/nginx/sites-available/mechanic-movil-api` (backend, reverse proxy):

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mechanic-movil-app /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/mechanic-movil-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Let's Encrypt certificates (certbot edits the nginx configs above in place
to add the `listen 443 ssl` blocks and redirect http→https automatically):

```bash
sudo certbot --nginx -d app.yourdomain.com -d api.yourdomain.com
```

Certbot's systemd timer auto-renews; confirm it's active:

```bash
sudo systemctl status certbot.timer
```

## 5. Automated backups

```bash
crontab -e
```

Add (adjust the path if you cloned somewhere other than
`/var/www/mechanic-movil`):

```cron
0 3 * * * /var/www/mechanic-movil/backend/scripts/backup-db.sh >> /var/log/mechanic-movil-backup.log 2>&1
```

This runs nightly at 3am, writes a gzipped `pg_dump` to
`/var/www/mechanic-movil/backups/`, and prunes anything older than 7 days
(`BACKUP_RETENTION_DAYS` env var to change that). Test it once by hand:

```bash
/var/www/mechanic-movil/backend/scripts/backup-db.sh
ls -la /var/www/mechanic-movil/backups/
```

Consider also copying backups off the VPS itself periodically (e.g. to
Hostinger's own backup product, or `rclone` to any object storage) — a
local-disk-only backup doesn't protect against the VPS itself being lost.

---

## Deploying an update

```bash
cd /var/www/mechanic-movil/backend
git pull
npm install
npm audit                      # check for new critical/high findings first
npm test                       # run against .env.test, NOT the prod DB
npx prisma migrate deploy      # only does anything if there are new migrations
pm2 restart mechanic-movil-backend

cd /var/www/mechanic-movil/frontend
git pull
npm install
npm audit
npm run build                  # nginx serves the new dist/ immediately, no restart needed
```

---

## What's still a manual/human decision, not something to automate away

- **JWT_SECRET and the Postgres password**: generate real random values
  (`openssl rand -base64 48`) and never reuse the dev placeholders.
- **Transactional email**: forgot-password currently has no way to deliver
  the reset link in production (see mechanic-movil-backend's
  auth.routes.js) until a provider is chosen and wired up.
- **DNS**: pointing `app.` and `api.` at the VPS's IP happens in whatever
  registrar/DNS panel you're using (Hostinger's, presumably) — outside the
  scope of anything in this repo.
