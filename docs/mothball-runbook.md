# Phase 1 — Mothball shisaku / renderself.com

Every command below is written against the actual shisaku deployment:
repo at `/opt/shisaku`, Docker volumes prefixed `shisaku_`, services
`caddy / api / wordpress / db / deploy`. Run as a user who can `docker compose`.

**Do not skip the verification steps.** The whole point of a mothball (vs. a
teardown) is that renderself can be resurrected from what we keep.

---

## 0. Preflight

```bash
cd /opt/shisaku
docker compose ps          # note what's running
git status                 # any uncommitted changes on the box? commit/push or copy them
df -h                      # confirm free space for the backup bundle
```

If `git status` shows local changes that never made it to GitHub, deal with
them first — the GitHub repo is the canonical code backup.

## 1. Final backup bundle

```bash
export TS=$(date +%Y%m%d)
mkdir -p /opt/backups/final

# 1a. All databases (WordPress + API tables), from the running db container
source /opt/shisaku/.env
docker compose -f /opt/shisaku/docker-compose.yml exec -T db \
  mysqldump -u root -p"${DB_ROOT_PASSWORD}" --all-databases \
  | gzip > /opt/backups/final/db_final_${TS}.sql.gz

# 1b. Entire WordPress tree (plugins, uploads, wp-config — not just uploads)
tar czf /opt/backups/final/wordpress_final_${TS}.tar.gz \
  -C /var/lib/docker/volumes/shisaku_wordpress_data/_data .

# 1c. Environment + certs state (small but irreplaceable)
tar czf /opt/backups/final/config_final_${TS}.tar.gz \
  -C /opt/shisaku .env caddy/Caddyfile

# 1d. Sanity-check the bundle
ls -lh /opt/backups/final/
gzip -t /opt/backups/final/db_final_${TS}.sql.gz && echo "db dump OK"
tar tzf /opt/backups/final/wordpress_final_${TS}.tar.gz | head -5
```

The db dump should be at least a few MB; the WordPress tar at least tens of MB.
Zero-byte or KB-sized files mean something failed — stop and investigate.

## 2. Get the bundle OFF the box

From your local machine (not the VPS):

```powershell
scp -r <user>@<vps-ip>:/opt/backups/final/ .\shisaku-final-backup\
```

Verify the local copies opened/list correctly, then keep them wherever your
long-term storage lives. Optionally also push to Cloudflare R2 later — local
copy is sufficient for mothball.

## 3. Provider snapshot

In your VPS provider's dashboard: take a full instance snapshot named
`shisaku-final-<date>`. This is the "resurrect everything exactly as it was"
option and the backstop for anything step 1 missed.

## 4. Stop the stack

```bash
cd /opt/shisaku
docker compose down        # containers stop; volumes and images REMAIN on disk
```

Deliberately **not** `down -v` — volumes stay until the resize forces the
question, and they cost nothing but disk.

## 5. Park renderself.com

Options, pick one:
- **Simplest**: leave DNS as-is; the site just stops answering. Fine if you
  don't care what visitors see.
- **Tidier**: point renderself.com's DNS at a one-line "concluded" page — a
  free Cloudflare Worker on that zone works if renderself.com is (or gets)
  moved to Cloudflare DNS. Keep the domain registration alive either way;
  expired domains get squatted.

Also: silence any external monitors/uptime checks pointed at renderself.com,
and disable the old GitHub deploy webhook (repo → Settings → Webhooks) since
the deploy listener is gone.

## 6. Downsize the VPS

Provider-dependent, one of:
- **Resize in place** (if your provider supports shrinking): pick the smallest
  tier that runs WordPress + MariaDB comfortably — 1–2 GB RAM is plenty for a
  single-product store. Disk usually cannot shrink; that may cap how far down
  you can go.
- **Fresh small instance** (if shrinking isn't offered): create the small
  instance, then Phase 2 builds the shop on it from scratch — nothing from the
  old box is needed beyond the backups you already took. Destroy the old
  instance only after Phase 2 is live AND the snapshot from step 3 is retained.

## 7. Post-mothball checklist

- [ ] db dump + WordPress tar + config tar verified and stored off-box
- [ ] provider snapshot exists
- [ ] stack down / old instance scheduled for destruction after Phase 2
- [ ] renderself.com parked, registration kept, monitors silenced
- [ ] GitHub deploy webhook disabled
- [ ] `agents@renderself.com` mail (if hosted anywhere) — decide keep/forward

## Rollback (resurrecting renderself)

Full: restore the provider snapshot.
Manual: clone `tblef89/shisaku`, restore `.env` from the config tar,
`docker compose up -d`, load the db dump into the db container, untar the
WordPress tree into the `wordpress_data` volume.

---

Next: Phase 2 — the shop. See `infra/` in this repo for the new stack that
goes on the downsized box.
