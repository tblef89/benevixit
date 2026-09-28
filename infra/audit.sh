#!/usr/bin/env bash
# infra/audit.sh — a read-only security check of the shop's VPS.
#
#   cd /opt/benevixit && sudo bash infra/audit.sh
#
# It changes nothing. It never prints a secret: no .env values, no password
# hashes, no key material, no database rows. Addresses are reported as
# "all interfaces" / "loopback" / "one address", never as the IP itself.
# The output is safe to paste into a chat or an issue.
#
# Each line starts PASS, WARN or FAIL with a short id (e.g. SSH-2) that
# infra/README.md → "Hardening" explains, with the fix.

set -u
export LC_ALL=C

REPO="${REPO:-/opt/benevixit}"
PASS=0; WARN=0; FAIL=0
pass() { PASS=$((PASS+1)); printf 'PASS  %-8s %s\n' "$1" "$2"; }
warn() { WARN=$((WARN+1)); printf 'WARN  %-8s %s\n' "$1" "$2"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %-8s %s\n' "$1" "$2"; }
info() { printf '      %-8s %s\n' "" "$1"; }
section() { printf '\n== %s ==\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash infra/audit.sh): most checks read root-only files." >&2
  exit 1
fi

# Describe a listening address without disclosing it.
addr_kind() {
  case "$1" in
    0.0.0.0|'*'|'[::]'|'::') echo "all interfaces" ;;
    127.*|'[::1]'|'::1') echo "loopback" ;;
    *) echo "one address" ;;
  esac
}

section "System"
if [ -r /etc/os-release ]; then . /etc/os-release; info "OS: ${PRETTY_NAME:-unknown}, kernel $(uname -r)"; fi
if [ -e /var/run/reboot-required ]; then
  warn SYS-1 "a reboot is pending (installed updates are not in effect until it happens)"
else
  pass SYS-1 "no reboot pending"
fi
if have apt-get; then
  upg=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c '^Inst ')
  sec=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep '^Inst ' | grep -ci security)
  if [ "$sec" -gt 0 ]; then fail SYS-2 "$sec security update(s) waiting ($upg updates in all)"
  elif [ "$upg" -gt 0 ]; then warn SYS-2 "$upg non-security update(s) waiting"
  else pass SYS-2 "packages up to date (as of the last apt update)"; fi
  if dpkg -s unattended-upgrades >/dev/null 2>&1 \
     && apt-config dump 2>/dev/null | grep -q 'APT::Periodic::Unattended-Upgrade "1"'; then
    pass SYS-3 "unattended security upgrades are on"
  else
    fail SYS-3 "unattended security upgrades are off"
  fi
fi
if have timedatectl; then
  if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ]; then
    pass SYS-4 "clock is synchronised"
  else
    warn SYS-4 "clock is not synchronised (TLS, logs and the purge's timing depend on it)"
  fi
fi

section "Accounts"
extra_root=$(awk -F: '$3==0 && $1!="root"{print $1}' /etc/passwd | tr '\n' ' ')
if [ -n "$extra_root" ]; then fail ACC-1 "accounts with UID 0 besides root: $extra_root"
else pass ACC-1 "root is the only UID-0 account"; fi
shells=$(awk -F: '$7 !~ /(nologin|false|sync|halt|shutdown)$/ {print $1}' /etc/passwd | tr '\n' ' ')
info "accounts that can log in: ${shells:-none}"
pw=$(awk -F: '$2 !~ /^[!*]/ && $2 != "" {print $1}' /etc/shadow 2>/dev/null | tr '\n' ' ')
if [ -n "$pw" ]; then warn ACC-2 "accounts with a password set (fine for sudo, as long as SSH refuses passwords): $pw"
else pass ACC-2 "no account has a usable password"; fi
for g in sudo wheel docker; do
  m=$(getent group "$g" | cut -d: -f4)
  [ -n "$m" ] && info "group $g: $m"
done
if [ -n "$(getent group docker | cut -d: -f4)" ]; then
  warn ACC-3 "members of the docker group are root in all but name; keep it to the operator"
fi
# SSH keys: type and fingerprint only, never the key or its comment.
while IFS=: read -r user _ uid _ _ home _; do
  { [ "$uid" -eq 0 ] || [ "$uid" -ge 1000 ]; } || continue
  f="$home/.ssh/authorized_keys"
  [ -r "$f" ] || continue
  n=$(grep -cE '^(ssh-|ecdsa-|sk-)' "$f")
  info "$user: $n authorized SSH key(s)"
  if have ssh-keygen; then
    while read -r line; do
      case "$line" in ssh-*|ecdsa-*|sk-*) ;; *) continue ;; esac
      printf '%s\n' "$line" | ssh-keygen -lf - 2>/dev/null | awk '{print "        " $1 " bits, " $NF ", " $2}'
    done < "$f"
  fi
  if have ssh-keygen && grep -q '^ssh-rsa' "$f"; then
    small=$(grep '^ssh-rsa' "$f" | while read -r l; do printf '%s\n' "$l" | ssh-keygen -lf - 2>/dev/null | awk '$1<3072'; done | wc -l)
    [ "$small" -gt 0 ] && warn ACC-4 "$user has $small RSA key(s) under 3072 bits"
  fi
done < /etc/passwd

section "SSH"
if have sshd; then
  cfg=$(sshd -T 2>/dev/null)
  get() { printf '%s\n' "$cfg" | awk -v k="$1" '$1==k{print $2; exit}'; }
  info "port $(get port)"
  case "$(get permitrootlogin)" in
    no) pass SSH-1 "root cannot log in over SSH" ;;
    prohibit-password|without-password) warn SSH-1 "root can log in over SSH with a key (better: log in as a user, then sudo)" ;;
    *) fail SSH-1 "root can log in over SSH with a password" ;;
  esac
  if [ "$(get passwordauthentication)" = no ] && [ "$(get kbdinteractiveauthentication)" != yes ]; then
    pass SSH-2 "SSH accepts keys only"
  else
    fail SSH-2 "SSH accepts passwords"
  fi
  mat=$(get maxauthtries)
  if [ -n "$mat" ] && [ "$mat" -le 4 ]; then pass SSH-3 "MaxAuthTries $mat"
  else warn SSH-3 "MaxAuthTries ${mat:-unset} (3 is plenty for key login)"; fi
  [ "$(get x11forwarding)" = yes ] && warn SSH-4 "X11 forwarding is on (not needed on a server)"
  au=$(get allowusers)
  if [ -n "$au" ]; then pass SSH-5 "SSH limited to named users"
  else warn SSH-5 "SSH not limited with AllowUsers (any account with a key may log in)"; fi
else
  warn SSH-0 "sshd not found"
fi
if have fail2ban-client && systemctl is-active --quiet fail2ban 2>/dev/null; then
  pass SSH-6 "fail2ban is running ($(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/{gsub(/^[ \t]+/,"",$2); print $2}'))"
else
  warn SSH-6 "fail2ban is not running (keys-only SSH makes it optional; it quiets the logs)"
fi

section "Network"
if have ss; then
  ss -Htlnp 2>/dev/null | while read -r _ _ _ local _ proc; do
    port="${local##*:}"; addr="${local%:*}"
    prog=$(printf '%s' "$proc" | sed -n 's/.*(("\([^"]*\)".*/\1/p')
    printf '      %-8s tcp %-5s on %-14s %s\n' "" "$port" "$(addr_kind "$addr")" "${prog:-?}"
  done
  open=$(ss -Htln 2>/dev/null | awk '{print $4}' | while read -r l; do
    a="${l%:*}"; p="${l##*:}"
    [ "$(addr_kind "$a")" = loopback ] && continue
    case "$p" in 22|80|443) ;; *) echo "$p" ;; esac
  done | sort -un | tr '\n' ' ')
  # A non-default SSH port shows up here too; that is expected.
  if [ -n "$open" ]; then warn NET-1 "reachable TCP ports besides 22/80/443: $open"
  else pass NET-1 "only SSH, 80 and 443 are reachable over TCP"; fi
fi
if have ufw && ufw status 2>/dev/null | grep -q 'Status: active'; then
  pass NET-2 "ufw is active (default incoming: $(ufw status verbose 2>/dev/null | awk -F'[:,(]' '/Default:/{gsub(/ /,"",$2); print $2}'))"
elif have nft && [ "$(nft list ruleset 2>/dev/null | grep -c 'policy drop')" -gt 0 ]; then
  pass NET-2 "an nftables policy drops unrequested traffic"
else
  fail NET-2 "no host firewall is active"
fi
if have iptables; then
  du_rules=$(iptables -S DOCKER-USER 2>/dev/null | grep -vc '^-N\|RETURN$')
  info "DOCKER-USER rules: ${du_rules:-0} (Docker's published ports bypass ufw; only this chain filters them)"
fi

section "Docker"
if have docker && docker info >/dev/null 2>&1; then
  info "engine $(docker version -f '{{.Server.Version}}' 2>/dev/null)"
  docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' | while IFS='|' read -r n i s p; do
    p=$(printf '%s' "$p" | sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/ADDR/g')
    printf '      %-8s %-28s %-24s %s %s\n' "" "$n" "$i" "$s" "${p:+[$p]}"
  done
  strays=$(docker ps -a --format '{{.Names}}' | grep -v '^infra[-_]' | tr '\n' ' ')
  if [ -n "$strays" ]; then warn DOC-1 "containers that aren't the shop's: $strays"
  else pass DOC-1 "only the shop's containers exist"; fi
  vols=$(docker volume ls -q | grep -v '^infra_' | tr '\n' ' ')
  if [ -n "$vols" ]; then warn DOC-2 "volumes that aren't the shop's (may hold old data): $vols"
  else pass DOC-2 "only the shop's volumes exist"; fi
  dbports=$(docker ps --filter name=db --format '{{.Ports}}' | grep -c -- '->')
  if [ "$dbports" -eq 0 ]; then pass DOC-3 "the database is not published to the network"
  else fail DOC-3 "the database container publishes a port"; fi
  if [ -r /etc/docker/daemon.json ] && grep -q 'max-size' /etc/docker/daemon.json; then
    pass DOC-4 "Docker rotates container logs (daemon.json)"
  else
    info "daemon.json sets no log rotation; infra/docker-compose.yml sets it per service"
  fi
  while read -r id; do
    n=$(docker inspect -f '{{.Name}}' "$id" | tr -d /)
    lp=$(docker inspect -f '{{.LogPath}}' "$id")
    sz=$( [ -n "$lp" ] && du -sh "$(dirname "$lp")" 2>/dev/null | cut -f1)
    mx=$(docker inspect -f '{{index .HostConfig.LogConfig.Config "max-size"}}' "$id" 2>/dev/null)
    [ "$mx" = "<no value>" ] && mx=""
    printf '      %-8s log %-28s %-6s %s\n' "" "$n" "${sz:-?}" "${mx:+(rotates at $mx)}"
    if [ -z "$mx" ] || [ "$mx" = "<no value>" ]; then warn DOC-5 "$n keeps its log forever (no max-size)"; fi
  done < <(docker ps -q)
else
  warn DOC-0 "docker is not reachable"
fi

section "The stack's files"
if [ -d "$REPO" ]; then
  env="$REPO/infra/.env"
  if [ -f "$env" ]; then
    mode=$(stat -c '%a' "$env"); owner=$(stat -c '%U' "$env")
    if [ "$mode" = 600 ] || [ "$mode" = 400 ]; then pass FIL-1 ".env is readable by its owner only ($mode, $owner)"
    else fail FIL-1 ".env is mode $mode (owner $owner); it holds every secret the shop has"; fi
    if grep -qE '^BV_PROXY_TOKEN=.{32,}$' "$env"; then pass FIL-2 ".env has BV_PROXY_TOKEN"
    else fail FIL-2 ".env has no BV_PROXY_TOKEN (the origin lock needs it)"; fi
  else
    fail FIL-1 "$env not found"
  fi
  if [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
    warn FIL-3 "the checkout has local changes (git status in $REPO)"
  else
    pass FIL-3 "the checkout is clean at $(git -C "$REPO" log -1 --format='%h %cs' 2>/dev/null)"
  fi
  remote=$(git -C "$REPO" remote get-url origin 2>/dev/null | sed -E 's#//[^/@]*@#//***@#')
  case "$remote" in *'***@'*) fail FIL-4 "the git remote URL embeds a credential: $remote" ;; *) pass FIL-4 "the git remote carries no credential" ;; esac
fi
others=$(find /opt /root /home -maxdepth 3 \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name 'db_*.tar.gz' -o -name 'wordpress_*.tar.gz' \) 2>/dev/null | head -20)
if [ -n "$others" ]; then
  warn FIL-5 "database dumps or site archives on disk (may hold personal data):"
  printf '%s\n' "$others" | while read -r f; do printf '      %-8s %s  %s\n' "" "$(du -h "$f" | cut -f1)" "$f"; done
else
  pass FIL-5 "no database dumps or site archives under /opt, /root, /home"
fi
for d in /opt/*; do
  [ -d "$d" ] || continue
  [ "$d" = "$REPO" ] && continue
  info "other directory in /opt: $d ($(du -sh "$d" 2>/dev/null | cut -f1))"
done
if crontab -l 2>/dev/null | grep -q 'wp-cron.php'; then
  pass FIL-6 "the host crontab wakes WordPress's scheduler (the purge depends on it)"
else
  fail FIL-6 "no host cron line wakes wp-cron (see README section 7)"
fi

section "Origin"
code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 8 "$@" 2>/dev/null; }
at_origin() { code --resolve shop.benevixit.com:443:127.0.0.1 "$@" https://shop.benevixit.com/wp-login.php; }
# The token is read to make one request with it; it is never printed.
token=""
[ -f "$REPO/infra/.env" ] && token=$(grep -m1 '^BV_PROXY_TOKEN=' "$REPO/infra/.env" | cut -d= -f2-)
without=$(at_origin)
if [ -n "$token" ]; then
  with=$(at_origin -H "X-BV-Proxy: $token")
  if [ "$with" = 000 ]; then
    warn ORG-1 "the origin didn't answer even with the Worker's token (is Caddy up? docker compose ps)"
  elif [ "$without" = 000 ]; then
    pass ORG-1 "the origin serves the Worker (HTTP $with) and refuses everyone else"
  else
    fail ORG-1 "the origin answers requests without the Worker's token (HTTP $without)"
  fi
else
  case "$without" in
    000) warn ORG-1 "the origin refused a direct request, but with no BV_PROXY_TOKEN to compare against it may simply be down" ;;
    *) fail ORG-1 "the origin answers anyone who asks shop.benevixit.com directly (HTTP $without)" ;;
  esac
fi
end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername shop.benevixit.com 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
[ -n "$end" ] && info "origin certificate valid until $end"

section "Public site (as the world sees it)"
pub() { code "https://benevixit.com$1"; }
if [ "$(pub /)" = 000 ]; then
  warn PUB-0 "couldn't reach https://benevixit.com from here; public checks skipped"
else
users=$(curl -s --max-time 8 'https://benevixit.com/wp-json/wp/v2/users' 2>/dev/null | grep -o '"slug"' | wc -l)
if [ "$users" -gt 0 ]; then fail PUB-1 "the REST API lists $users WordPress user(s) to anyone"
else pass PUB-1 "the REST API does not list users"; fi
loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 8 'https://benevixit.com/?author=1' 2>/dev/null)
case "$loc" in *'/author/'*) fail PUB-2 "/?author=1 redirects to an author page (reveals a login name)" ;; *) pass PUB-2 "author archives don't reveal login names" ;; esac
x=$(pub /xmlrpc.php)
case "$x" in 200|405) fail PUB-3 "xmlrpc.php is live (HTTP $x): password guessing in bulk" ;; *) pass PUB-3 "xmlrpc.php is closed (HTTP $x)" ;; esac
leaked=0
for p in /wp-content/debug.log /wp-config.php.bak /wp-config.php~ /.env /.git/config; do
  if [ "$(pub "$p")" = 200 ]; then fail PUB-4 "$p is downloadable"; leaked=1; fi
done
[ "$leaked" = 0 ] && pass PUB-4 "no debug log, config backup, .env or .git is downloadable"
hdr=$(curl -sI --max-time 8 https://benevixit.com/cart/ 2>/dev/null)
if printf '%s' "$hdr" | grep -qi '^x-powered-by:'; then warn PUB-5 "responses announce the PHP version (X-Powered-By)"
else pass PUB-5 "responses don't announce software versions"; fi
fi

printf '\n%d pass, %d warn, %d fail\n' "$PASS" "$WARN" "$FAIL"
