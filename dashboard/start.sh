#!/bin/bash
# Polymarket Dashboard - Port 8004
cd /opt/polymarket/dashboard

# Proxy env'lerini temizle (VPS proxy kısıtlaması - client-side fetch kullandığımız için gerekli değil)
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

# Varsa eski process'i durdur
if [ -f /tmp/polymarket-dashboard.pid ]; then
  kill $(cat /tmp/polymarket-dashboard.pid) 2>/dev/null
  rm /tmp/polymarket-dashboard.pid
fi

# Production modda başlat
NODE_ENV=production nohup node node_modules/.bin/next start -p 8004 -H 0.0.0.0 \
  > /tmp/polymarket-dashboard.log 2>&1 &

echo $! > /tmp/polymarket-dashboard.pid
echo "Dashboard başlatıldı - PID: $(cat /tmp/polymarket-dashboard.pid)"
echo "URL: http://0.0.0.0:8004"
echo "Log: tail -f /tmp/polymarket-dashboard.log"
