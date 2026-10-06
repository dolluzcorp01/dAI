# Pilot runbook

How dAI goes onto the Dolluz server, in the order it has to happen, and how to
get it off again.

Written for whoever is at the terminal. Every command here is run by a person,
not by an agent: the server is not something this repository has access to.

**Nothing in this document has been run.** It is written from the code, from
what the box is known to look like, and from measurements taken on a laptop.
The first hour will find things.

---

## What the box is

One droplet, `64.227.135.222`, shared with twelve other dApps:

| | |
|---|---|
| CPU / RAM | 1 vCPU, 1 GB, already at 75% memory with swap in use |
| Disk | 23 GB, **92% full** |
| Stack | pm2 behind nginx, certbot for TLS, MySQL on the same box |
| Ports | 4000 to 4010 taken by twelve dApps. **dAI gets 4011** |
| Node | v18.19.1 system-wide. dAI needs 22, so 22 goes alongside via nvm, with nvm's default put back to the system Node |

Two things follow from this, and both are decisions rather than preferences.

**One process, fork mode.** The Docker plan ran two replicas because two
processes behind one port is the smallest arrangement that proves the Redis
adapter is carrying messages between instances. That reasoning has not changed,
but a second Node process on this box risks pushing it further into swap and
taking twelve other apps down. So:

> **The Redis adapter is configured and unproven in production.** `REDIS_URL` is
> set and the adapter attaches, but nothing crosses between instances because
> there is only one. The day a second instance appears anywhere, that becomes
> load bearing, and it has only ever been proven on a laptop.

**The disk is the tighter constraint, not the memory.** 8% of 23 GB is about
1.8 GB free. See "Backups and the disk" before enabling the nightly dump.

---

## Memory, measured

Measured on 2026-10-01 against a real server process answering real requests
through the mock model provider. Windows `WorkingSet64`, which is close to
Linux RSS and usually a little higher.

| State | Memory |
|---|---|
| Idle, after settling | **66 MB** |
| After 10 concurrent questions | 80 MB |
| After 25 concurrent questions | **84 MB** |
| Idle again afterwards | 84 MB |

Two things to read from that. The footprint is modest: **under 100 MB**, which
a 1 GB box can hold alongside what is already there. And it does not come back
down. V8 keeps the heap it has grown, so the number to plan for is the high
water mark, not the resting figure. `ecosystem.config.js` caps the old space at
256 MB and restarts above 250 MB, so a leak shows up as a restart rather than as
twelve other apps being killed.

What this measurement does **not** cover: the real Anthropic provider. A model
call holds an HTTPS connection and a response buffer, which is kilobytes, but it
also takes seconds rather than milliseconds, so more requests are in flight at
once. Expect the high water mark to be higher under real answers. Watch it for
the first week.

Node itself: 71 MB of `node_modules`, under 1 MB of source.

---

## 1. Provisioning

Run in this order. Nothing here touches dAI yet.

### Node 22, alongside the system Node

The box runs v18.19.1 for the other dApps. **Do not upgrade the system Node.**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
```

**Then immediately put the default back, before anything else happens:**

```bash
nvm alias default system
```

**This step is not optional and the order matters.** The nvm installer appends
itself to `~/.bashrc`, so from that moment every new root shell starts on Node
22, in every directory, for every app on the box. A pm2 restart from such a
shell would relaunch another dApp on Node 22 without anyone deciding to. Found
on 2026-10-01 during the real provisioning, before it did any harm.

Verify it, in a new shell rather than this one:

```bash
exit            # and log in again
node -v         # expect v18.19.1, the system Node
nvm which 22    # the path to the Node 22 binary, which is what dAI uses
```

Nothing on the box is now on Node 22 by default. dAI gets there explicitly:

- **pm2** uses the `interpreter` line in `ecosystem.config.js`.
- **deploy.sh** puts that directory at the front of `PATH` and refuses to run if
  `node -v` is not 22 or newer.

Both default to `/root/.nvm/versions/node/v22.23.3/bin`. If nvm installs a
different patch version, set `DAI_NODE` for pm2 and `DAI_NODE_BIN` for
deploy.sh, or edit the two defaults.

### Redis

```bash
sudo apt update
sudo apt install -y redis-server
grep -E '^bind|^protected-mode' /etc/redis/redis.conf    # expect 127.0.0.1 ::1, yes
sudo systemctl enable --now redis-server
redis-cli ping                                           # PONG
```

Use a dedicated database index so dAI can never collide with another dApp:
`REDIS_URL=redis://127.0.0.1:6379/3`.

On a 1 GB box, cap it. In `/etc/redis/redis.conf`:

```
maxmemory 64mb
maxmemory-policy allkeys-lru
save ""
appendonly no
```

Persistence off is deliberate: Redis is a message bus here, not a store.
Everything in it is reconstructible and losing it costs one reconnect.

### The database

Run on the MySQL on this box. Replace the password; it goes into `.env`, never
into a chat window.

```sql
CREATE DATABASE kody CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'kody'@'localhost' IDENTIFIED BY 'PUT-A-LONG-RANDOM-PASSWORD-HERE';
GRANT ALL PRIVILEGES ON kody.* TO 'kody'@'localhost';

-- dAdmin stays read-only, and only the nine columns sign-in needs.
-- Never account_pass_text, bank, Aadhaar or PAN.
GRANT SELECT
  (emp_id, emp_mail_id, account_pass, emp_first_name, emp_last_name,
   emp_access_level, active, deleted_time, app_dAI)
  ON dadmin.employee TO 'kody'@'localhost';

FLUSH PRIVILEGES;
SHOW GRANTS FOR 'kody'@'localhost';
```

`SHOW GRANTS` must return exactly three lines: `USAGE ON *.*`, `ALL PRIVILEGES
ON kody.*`, and the column-list `SELECT` on `dadmin.employee`. A fourth line
means something is wider than intended.

`'localhost'` rather than `'%'` because the app runs on this same box. dAI reads
dAdmin with a cross-database query on one connection, which is why both have to
live on the same MySQL server.

### DNS and the site

Point `dai.dolluzcorp.com` at the droplet and confirm it resolves.

**Two stages, and the order matters.** nginx refuses to load an `ssl` listener
with no certificate, so the full site file cannot be installed before the
certificate exists, and `certbot --nginx` cannot run against a config that will
not load. Get the certificate with `certonly` over http first.

Stage one, http only:

```bash
sudo cp deploy/nginx/dai.dolluzcorp.com.http-only.conf \
        /etc/nginx/sites-available/dai.dolluzcorp.com.conf
sudo ln -s /etc/nginx/sites-available/dai.dolluzcorp.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/html -d dai.dolluzcorp.com
```

Stage two, the real site, once the certificate is on disk:

```bash
sudo cp deploy/nginx/dai.dolluzcorp.com.conf /etc/nginx/sites-available/dai.dolluzcorp.com.conf
sudo nginx -t && sudo systemctl reload nginx
```

`certonly` leaves the config alone, so the `listen ... http2` lines stay as
written. The full file keeps serving `/.well-known/acme-challenge/` over port 80
ahead of its redirect, which is what every renewal needs: certbot renews with
the authenticator it first used, and if the redirect catches the challenge the
renewal fails silently and the certificate expires sixty days later.

### The code and its environment

```bash
sudo mkdir -p /var/www/dolluzcorp.com/dai /var/log/dai
sudo chown -R $USER:$USER /var/www/dolluzcorp.com/dai /var/log/dai
git clone https://github.com/dolluzcorp01/dAI /var/www/dolluzcorp.com/dai
cd /var/www/dolluzcorp.com/dai
cp .env.example .env
```

Fill `.env`. The settings that differ from development:

```
NODE_ENV=production
PORT=4011
PUBLIC_URL=https://dai.dolluzcorp.com
WEB_URL=https://dai.dolluzcorp.com

DB_HOST=127.0.0.1
DB_NAME=kody
DB_USER=kody
DB_PASSWORD=<the one you just set>

JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
DADMIN_SHARED_JWT_SECRET=<openssl rand -base64 48, shared with dAdmin>
DADMIN_RESET_URL=https://dadmin.dolluzcorp.com/Login
EXTENSION_IDS=ikamkodfpkklimdldhfpnhmmlapdjpmn

REDIS_URL=redis://127.0.0.1:6379/3

# File sharing is Phase 2. Off, rather than configured weakly.
STORAGE_DRIVER=none
FILE_SCANNER=none

# No SendGrid or FCM yet. In-app notifications still work; email and push drop.
MAIL_DRIVER=none
PUSH_DRIVER=none

# The first deploy runs on mock. The real key goes in at step 4, not before.
# NODE_ENV stays production: the alternative is running the pilot in development
# mode, which switches off every other guard, including the one that lets a
# local Kody password stand in for a dAdmin one. ALLOW_MOCK_MODEL says the mock
# is deliberate, warns loudly at every boot, and comes out at step 4.
MODEL_PRIMARY_PROVIDER=mock
MODEL_FALLBACK_PROVIDER=
ALLOW_MOCK_MODEL=1
```

Those are every line that must change. Do not rely on having read the list
carefully, because the dangerous mistakes here are the ones that start
perfectly well:

```bash
chmod 600 .env
cd server
node --env-file=../.env scripts/check-env.js --port 4011
```

**The `--env-file` is the point.** `node -e` on its own does not read `.env`, so
a check written without it fails on the first secret and proves nothing about
anything after it. That mistake was made on this runbook on 2026-10-05.

`check-env.js` covers what `config.js` cannot. `config.js` refuses to START on a
configuration that is dangerous: a development JWT secret, no Redis, local disk,
a scanner that is not real, a mock model, a memory transport. The checker covers
the other kind, the configuration that starts perfectly and is simply wrong:

| Left wrong | What happens |
|---|---|
| `PORT` still 4014 while nginx proxies 4011 | Boots, serves nobody, 502 for ever |
| `PUBLIC_URL` still localhost | Sign in builds URLs nobody can reach |
| `MODEL_FALLBACK_PROVIDER=openai` with no key | Fine until the primary fails, which is the day it was meant to help |
| Both JWT secrets the same string | An access token verifies as a refresh token |
| `EXTENSION_IDS` empty or malformed | Nobody can sign in through the extension |

It exits non-zero when anything is wrong, so it can go in a deploy script later.
`MODEL_PRIMARY_PROVIDER=mock` is reported as a note rather than an error,
because the first deploy runs on it deliberately.

Then confirm the production guards themselves, which is a separate thing:

```bash
NODE_ENV=production node --env-file=../.env -e "require('./src/config'); console.log('every production guard passes')"
```

On the first deploy this correctly stops at one line, `Refusing to start in
production with the mock model provider`. Everything before it having passed is
the result worth having.

---

### What the install costs

Measured on the real package set, because this box has little room to spare:

| Operation | Peak memory | Time |
|---|---|---|
| `npm ci --omit=dev` | **228 MB** | ~20 s on a laptop, longer here |
| `node scripts/migrate.js` | 40 MB | seconds |
| dAI running | 66 to 84 MB | |

**The install is the only spike, and there is no build step at all**: no
bundler, no React, nothing to compile. 246 packages, 68 MB on disk.

228 MB on a box with little free memory will touch swap for a minute. Do it
after the resize if you can. If you cannot, two things help: it is a short
window rather than a sustained load, and `node_modules` contains **no native
binaries**, so it can be installed on another machine and copied over if the
box cannot spare the memory at all.

---

## 2. First deploy, on the mock model

The model stays off for this. The point of this step is to prove the plumbing:
nginx, pm2, MySQL, Redis, dAdmin sign-in and the extension. A wrong Anthropic
key or an unexpected model bill should not be mixed into that.

**NODE_ENV is `production` for this deploy and every one after it.** The mock
provider is allowed by `ALLOW_MOCK_MODEL=1`, which is a single deliberate
exception that warns at every boot. It is not `NODE_ENV=development`: that would
also switch off the Redis requirement, the storage and scanner checks, the mail
and push transports, and the rule that a local Kody password cannot stand in for
a dAdmin one. Working around one guard by disabling six is not a trade worth
making, and the app would be running in a mode the pilot is not testing.

```bash
cd /var/www/dolluzcorp.com/dai
./deploy/deploy.sh --skip-install
```

Before any change to `deploy/*.sh` is pushed, run it:

```bash
bash deploy/dryrun.sh
```

That runs `deploy.sh` end to end against a clone of the repository with the
working tree's scripts copied in: real backup, real lockfile check, real
migrate, real readiness poll against a real server, with only pm2 stubbed. It
exists because three faults reached the server in three days and every one of
them would have died on the first line of a single real run.

The scripts carry the execute bit in git, so a fresh clone can run them. If a
checkout ever loses it, `chmod +x deploy/*.sh`. Both scripts read **one** env
file, `.env` at the repository root: the same one pm2 loads and the same one
step 1e creates. There is no `.env.production`.

`--skip-install` because `node_modules` was built on another machine and copied
here: `npm ci` peaks around 228 MB on a box with 1 GB shared between thirteen
apps. Skipping the install does not skip the question of whether the tree is
right, though. It runs `npm ls --omit=dev` and refuses to go on if the tree does
not satisfy `package-lock.json`.

Build the tree on a machine that can afford it:

```bash
# on a laptop, in a scratch copy of server/ rather than the repo, since
# --omit=dev strips the dev dependencies the test suite needs
npm ci --omit=dev --no-audit --no-fund
tar -czf node_modules.tgz node_modules
```

Copy it over with a checksum manifest and verify every file before anything
starts. Nothing in the tree is compiled, which is what makes a tree built on
Windows safe on Linux: 246 packages, 5,676 files, 68 MB, zero native binaries,
zero packages pinned to an OS or CPU.

It backs up, installs, migrates once, starts pm2, waits for readiness, and rolls
the code back if readiness never comes up.

Then check, in this order, and stop at the first thing that fails:

```bash
curl -s http://127.0.0.1:4011/health
curl -s http://127.0.0.1:4011/health/ready       # ok true, db ok, migrations ok
curl -sI https://dai.dolluzcorp.com/extension/authorize | head -5
```

Readiness must say `redis.configured: true`. If it does not, `REDIS_URL` is
wrong and you are running without the bus.

The sign-in page must come back **200** with
`Content-Security-Policy: default-src 'none'` and `Cache-Control: no-store`. If
the policy is missing, nginx is serving the page instead of proxying it.

Then, in Chrome: load the extension, set nothing (production is the default),
and sign in with a dAdmin password. That exercises the whole path: the page, the
one-time code, the token exchange, and the cross-database read of
`dadmin.employee`.

Last, `pm2 save` so the app comes back after a reboot, and `pm2 startup` if it
has never been run on this box. The app is `dai-backend`, matching every other
app on the server.

---

## 3. The first real Anthropic call

Only after step 2 is green.

1. **Set a spend limit on the Anthropic account first.** A loop in a retry path
   costs money, and the limit is the only thing that bounds it.
2. Put the key in `.env`, set `MODEL_PRIMARY_PROVIDER=anthropic`, leave the
   fallback empty for now.
3. `pm2 reload dai --update-env`.
4. Ask **one** question, through the extension, and watch three things: that an
   answer comes back, how long it took, and what it cost on the Anthropic
   console.
5. Ask a tier 0 question (`What does CO-45 mean?`). It must come back in
   milliseconds from the code table, with **no model call at all**. If that one
   costs money, tier routing is not working and the model is answering
   everything.

Then stop and read `/api/admin/analytics` for the day before letting anyone
else in.

---

## 4. The code imports

CARC, RARC and ICD-10. CPT and CDT wait for their licences, and the importer
refuses them until the licence is recorded in `org_settings`.

Sources: ICD-10-CM from cms.gov, CARC and RARC from x12.org.

**Dry run first, every time. Read the diff. Then apply.**

```bash
cd /var/www/dolluzcorp.com/dai/server
node --env-file-if-exists=../.env scripts/import-codes.js CARC ./carc-2026.csv --from 2026-01-01
# read the output in full, then:
node --env-file-if-exists=../.env scripts/import-codes.js CARC ./carc-2026.csv --from 2026-01-01 --apply
```

A bad import silently corrupts every future tier 0 answer, which is the one
thing Kody is supposed to be certain about. The dry run is not a formality.

After each import, ask a question that uses it and check the answer names the
set and the as-of date.

---

## 5. Backups and the disk

**Check the free space before enabling this.** The disk is 92% full, about
1.8 GB free, and a backup that fills a disk takes twelve other apps down with
it.

```bash
df -h /
du -sh /var/www/dolluzcorp.com/dai
```

A fresh `kody` database is a few megabytes. It grows with messages and
notifications: the development database, after months of test runs, is 54 MB,
of which 40 MB is the notifications table. A pilot of a few people will produce
far less, but the growth is real and nobody will be watching it.

So, for this box:

```bash
cd /var/www/dolluzcorp.com/dai/deploy
BACKUP_KEEP_DAYS=7 ./backup.sh          # once, by hand, and look at the size
```

Then a nightly cron, with the retention that the free space can actually carry:

```cron
0 2 * * * cd /var/www/dolluzcorp.com/dai/deploy && BACKUP_KEEP_DAYS=7 ./backup.sh >> /var/log/dai/backup.log 2>&1
```

`backup.sh` refuses to report success on a dump that is too small, unreadable,
truncated, or missing `users`, `messages`, `conversations` or
`schema_migrations`, and it only prunes while a readable dump remains. It cannot
tell you that the disk is nearly full, so check `df -h` when you check the log.

### A warning about shared boxes and MySQL option files

Any MySQL client tool reads option files before it reads anything you pass it,
and a password in one wins over `MYSQL_PWD`. This server has a `/root/.my.cnf`
belonging to another application. The effect is that `mysqldump --user=kody`
authenticates with the other application's password and reports access denied,
while the same credentials work perfectly when you type them by hand, which is
a confusing afternoon.

`backup.sh` passes `--no-defaults` as the first argument for that reason, and
mysqldump refuses that flag anywhere but first. If you write any other MySQL
command for this box, do the same.

```bash
# the one that lies
mysqldump --user=kody ... kody            # reads /root/.my.cnf, access denied
# the one that does what you asked
mysqldump --no-defaults --user=kody ... kody
```

### The retention sweep

Nothing in dAI deleted anything until this script. Run it by hand first and read
what it says it would do:

```bash
cd /var/www/dolluzcorp.com/dai/server
node scripts/retention.js --notifications 90 --unread 365 --digests 90
```

It is a dry run unless `--apply` is passed, which is also what makes it safe to
put in a crontab with a typo in it. Then, weekly:

```cron
30 3 * * 0 cd /var/www/dolluzcorp.com/dai/server && /root/.nvm/versions/node/v22.23.3/bin/node scripts/retention.js --notifications 90 --unread 365 --digests 90 --apply >> /var/log/dai/retention.log 2>&1
```

The full node path matters for the same reason it does in `deploy.sh`: cron gets
a minimal environment and `node` there is the system Node 18.

**Two windows, far apart.** Read notifications go at 90 days, unread at 365.
An unread notification is somebody's outstanding work right up until it
obviously is not, and a year-old one is noise nobody will act on.

Keeping unread for ever was tried and measured, and does not work: **97.6% of
notifications in development are unread** (179,081 of 183,559), because a thumbs
down notifies every reviewer and most never open it. A read-only policy
reclaims about one row in forty.

The script holds unread to a higher bar than read. Below 180 days it refuses
without `--force`, and it refuses outright if the unread window is shorter than
the read one, because that would bin unseen notifications sooner than seen ones.

None of this is the real fix. 97.6% unread means **too many notifications are
being sent**, which is a Phase 2 question about fan-out, not something a sweeper
can answer.

**The dump contains message bodies, so it contains claim detail.** It is written
0600 into a 0700 directory. Copying it anywhere else is a decision about PHI,
not a convenience.

---

## 6. Rolling back

**Code only:**

```bash
cd /var/www/dolluzcorp.com/dai
git checkout <previous-commit>
cd server && npm ci --omit=dev
pm2 reload dai --update-env
```

`deploy.sh` does this automatically when readiness never comes up.

**Migrations do not roll back.** This project has no down migrations, by design:
a down migration that has never been run is a guess about how to undo something
under pressure. If a migration is what broke the deploy, restore the dump
`deploy.sh` took at the start of that run, then go back to the previous commit.

```bash
gunzip -c deploy/backups/kody-<stamp>.sql.gz | mysql -u kody -p kody
```

**Turning dAI off entirely**, which is the fastest way out of trouble:

```bash
pm2 stop dai
```

Nothing else on the box depends on dAI. The extension will say it cannot reach
Kody, which is the correct answer when it cannot.

---

## What is still unproven when real people start

Everything in this list is a thing nobody has watched happen:

- **nginx has never proxied this app**, and Socket.IO has never gone through it.
- **The Redis adapter is configured and unproven**, because one process.
- **No real Anthropic call has been made.** Tier routing, retries, timeouts and
  cost are untested against a live model.
- **No code set has been imported.**
- **`backup.sh` has never produced a dump**, and `deploy.sh` has never run.
- **The pilot runs with file sharing off.** Spaces and ClamAV remain untested,
  which is fine while `STORAGE_DRIVER=none` and is not the day that changes.
- **Email and push are dropped**, not sent. In-app notifications work; a digest
  goes nowhere.
- **No load testing.** One process, measured at rest, not under real people.
- `exchangeCode` issues a session without re-checking dAdmin, a sixty second
  window the next refresh closes.
- The quick switcher reads only the 200 most recently active conversations
  before filtering, so a heavy user cannot find an older one by name.
- **Growth is only half controlled.** `scripts/retention.js` now removes read
  notifications and old digest runs, and it has never run on the server. It does
  not remove unread notifications, which in development are 97.6% of the table,
  so the notifications table still grows without bound. `audit_log` is never
  pruned, deliberately. The first place any of this hurts is the nightly dump,
  which is on the same disk.

The first three are where the trouble will come from.
