#!/bin/sh
set -eu

# Certbot runs deploy hooks after successful renewal. Only this lineage
# needs a reload from this hook; every other certificate is ignored.
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/juben.onesay.top ]; then
    nginx -t
    systemctl reload nginx
fi
