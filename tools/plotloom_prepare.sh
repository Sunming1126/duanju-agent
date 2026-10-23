#!/bin/bash
set -euo pipefail
# Run as root only after uploading a source-only zip to /tmp/plotloom-release.zip.
base=/opt/plotloom-cn
stamp=$(date -u +%Y%m%dT%H%M%SZ)
test ! -e "$base/current"
! ss -ltn | grep -Eq '127.0.0.1:(3001|8766) '
id plotloom-cn >/dev/null 2>&1 || useradd --system --home "$base" --shell /usr/sbin/nologin plotloom-cn
install -d -m 750 -o plotloom-cn -g plotloom-cn "$base" "$base/releases" "$base/shared" "$base/shared/data" "$base/backups"
cp -a /etc/nginx/sites-available/jubencn.onesay.top "$base/backups/nginx-$stamp.conf"
tar -czf "$base/backups/legacy-$stamp.tar.gz" -C /opt/duanju-agent app service.env
chmod 600 "$base"/backups/*
release="$base/releases/$stamp"
install -d "$release" "$base/runtime"
python3 - "$release" <<'PY'
import sys,zipfile
with zipfile.ZipFile('/tmp/plotloom-release.zip') as z: z.extractall(sys.argv[1])
PY
cp "$release/data/corpus.json" "$base/shared/data/corpus.json"
mv "$release/data" "$release/seed-data"
ln -s "$base/shared/data" "$release/data"
python3 -m venv "$base/venv"
"$base/venv/bin/pip" install fastapi 'pydantic>=2.6' uvicorn httpx python-dotenv python-multipart
cd "$base/runtime"
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
nodefile=$(awk '/ node-v.*-linux-x64.tar.xz$/ {print $2}' SHASUMS256.txt)
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$nodefile"
grep " $nodefile$" SHASUMS256.txt | sha256sum -c -
tar -xJf "$nodefile" --strip-components=1
chown -R plotloom-cn:plotloom-cn "$base/releases" "$base/shared"
cd "$release/ai-website-cloner-template"
runuser -u plotloom-cn -- env PATH="$base/runtime/bin:/usr/bin:/bin" npm ci --no-audit --no-fund
runuser -u plotloom-cn -- env PATH="$base/runtime/bin:/usr/bin:/bin" DUANJU_BACKEND_URL=http://127.0.0.1:8766 NODE_OPTIONS=--max-old-space-size=1024 npm run build -- --webpack
ln -s "$release" "$base/current"
for kind in api web; do
 if [ "$kind" = api ]; then
   wd="$base/current"; command="$base/venv/bin/uvicorn studio_main:app --host 127.0.0.1 --port 8766 --workers 1"
 else
   wd="$base/current/ai-website-cloner-template"; command="$base/runtime/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001"
 fi
 cat > "/etc/systemd/system/plotloom-cn-$kind.service" <<EOF
[Unit]
Description=Plotloom Chinese $kind
After=network-online.target
[Service]
User=plotloom-cn
Group=plotloom-cn
WorkingDirectory=$wd
ExecStart=$command
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=DUANJU_SCHEDULER_ENABLED=false
Environment=DUANJU_WRITER_AUTO_RESUME_ENABLED=false
Restart=on-failure
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$base/shared $base/releases
[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
systemctl enable --now plotloom-cn-api plotloom-cn-web
echo "Prepared $release; public proxy has not changed."
