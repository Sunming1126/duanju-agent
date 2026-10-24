#!/bin/bash
set -euo pipefail
# Upload a source-only archive first. Does not modify Nginx or legacy services.
base=/opt/plotloom-cn
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="$base/releases/$stamp"
test -L "$base/current"
install -d "$release"
python3 - "$release" "$@" <<'PY'
import sys,zipfile
for archive in (sys.argv[2:] or ['/tmp/plotloom-release.zip']):
    with zipfile.ZipFile(archive) as z: z.extractall(sys.argv[1])
PY
mv "$release/data" "$release/seed-data"
ln -s "$base/shared/data" "$release/data"
chown -R plotloom-cn:plotloom-cn "$release"
cd "$release/ai-website-cloner-template"
runuser -u plotloom-cn -- env PATH="$base/runtime/bin:/usr/bin:/bin" npm ci --no-audit --no-fund
runuser -u plotloom-cn -- env PATH="$base/runtime/bin:/usr/bin:/bin" DUANJU_BACKEND_URL=http://127.0.0.1:8766 NODE_OPTIONS=--max-old-space-size=1024 NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
# Snapshot legacy tasks for explicit Chinese-only history import. The old
# application keeps ownership of its live data; no writes go to that tree.
if [ ! -d "$base/shared/legacy-history" ]; then
  cp -a /opt/duanju-agent/app/data/writer_tasks "$base/shared/legacy-history"
  chown -R plotloom-cn:plotloom-cn "$base/shared/legacy-history"
fi
old=$(readlink -f "$base/current")
echo "$old" > "$base/backups/previous-$stamp.txt"
systemctl stop plotloom-cn-worker.service 2>/dev/null || true
systemctl stop plotloom-cn-web plotloom-cn-api
python3 - "$base/shared/data/studio/studio.sqlite3" "$base/backups/studio-$stamp.sqlite3" <<'PY'
import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as source, sqlite3.connect(sys.argv[2]) as target:
    source.backup(target)
PY
chmod 600 "$base/backups/studio-$stamp.sqlite3"
cat > /etc/systemd/system/plotloom-cn-worker.service <<EOF
[Unit]
Description=Plotloom persistent Chinese generation worker
After=network-online.target
[Service]
User=plotloom-cn
Group=plotloom-cn
WorkingDirectory=$base/current
ExecStart=$base/venv/bin/python -m agent.studio_worker
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=PYTHONUNBUFFERED=1
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$base/shared
[Install]
WantedBy=multi-user.target
EOF
install -d /etc/systemd/system/plotloom-cn-api.service.d
cat > /etc/systemd/system/plotloom-cn-api.service.d/history.conf <<EOF
[Service]
Environment=PLOTLOOM_LEGACY_DIR=$base/shared/legacy-history
EOF
ln -s "$release" "$base/current-next"
mv -Tf "$base/current-next" "$base/current"
systemctl daemon-reload
systemctl enable plotloom-cn-worker
systemctl start plotloom-cn-api plotloom-cn-worker plotloom-cn-web
ok=false
for attempt in $(seq 1 20); do
 if curl -fsS http://127.0.0.1:8766/api/studio/status >/dev/null && curl -fsS http://127.0.0.1:3001/ >/dev/null; then ok=true; break; fi
 sleep 1
done
if [ "$ok" != true ]; then
 systemctl stop plotloom-cn-worker plotloom-cn-web plotloom-cn-api
 ln -s "$old" "$base/current-rollback"
 mv -Tf "$base/current-rollback" "$base/current"
 systemctl start plotloom-cn-api plotloom-cn-web
 echo 'Health check failed; program rolled back, new data retained.' >&2
 exit 1
fi
echo "Released $release; previous=$old; database backup=$base/backups/studio-$stamp.sqlite3"
