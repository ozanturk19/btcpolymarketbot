#!/bin/bash
if [ -f /tmp/polymarket-dashboard.pid ]; then
  kill $(cat /tmp/polymarket-dashboard.pid) 2>/dev/null
  rm /tmp/polymarket-dashboard.pid
  echo "Dashboard durduruldu."
else
  echo "Çalışan process bulunamadı."
fi
