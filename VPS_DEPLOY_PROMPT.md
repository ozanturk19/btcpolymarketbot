# VPS Deploy Prompt — Polymarket Dashboard

Aşağıdaki prompt'u Claude Code ajanına ver. VPS'e SSH erişimi olan bir ortamda çalıştır.

---

## PROMPT BAŞLANGIÇ

```
Polymarket Dashboard'u VPS'e deploy et. Adımları kontrollü şekilde, her adımı doğrulayarak yap.

## Bilgiler
- VPS IP: 135.181.206.109
- VPS kullanıcı: root
- Repo: https://github.com/ozanturk19/claude.git
- Branch: claude/polymarket-mcp-integration-F3JjW
- Hedef dizin: /opt/polymarket
- Dashboard dizini: /opt/polymarket/dashboard
- Port: 8004 (UFW'de zaten açık)
- Sadece dashboard/ dizinini deploy et, src/ (MCP server) şimdilik gerekmez

## Adım 1: VPS'e SSH bağlan ve ortamı kontrol et
ssh root@135.181.206.109

Kontrol edilecekler:
- Node.js versiyonu (>= 18 gerekli): node -v
- npm versiyonu: npm -v  
- git kurulu mu: git --version
- pm2 kurulu mu: pm2 --version
- Port 8004 boş mu: ss -tlnp | grep 8004

Eğer Node.js 18+ yoksa:
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

Eğer pm2 yoksa:
npm install -g pm2

Eğer git yoksa:
apt install -y git

Eğer port 8004 meşgulse:
- Hangi servis kullandığını kontrol et (örn. paper_bot varsa durdur: systemctl stop paper-bot-api)
- fuser -k 8004/tcp ile portu serbest bırak

## Adım 2: Repo'yu klonla
cd /opt
git clone https://github.com/ozanturk19/claude.git polymarket
cd /opt/polymarket
git checkout claude/polymarket-mcp-integration-F3JjW

Eğer /opt/polymarket zaten varsa:
cd /opt/polymarket
git fetch origin
git checkout claude/polymarket-mcp-integration-F3JjW
git pull origin claude/polymarket-mcp-integration-F3JjW

## Adım 3: Bağımlılıkları kur
cd /opt/polymarket/dashboard
npm install

Doğrula: node_modules/ dizini oluştu mu, hata var mı kontrol et.

## Adım 4: Build et
cd /opt/polymarket/dashboard
npm run build

Doğrula: .next/ dizini oluştu mu, build hatasız tamamlandı mı kontrol et.

Eğer build hatası alırsan:
- Hata mesajını oku ve düzelt
- Genellikle tip hataları veya eksik bağımlılıklar olur
- npm run build 2>&1 ile detaylı hata gör

## Adım 5: PM2 ile başlat
cd /opt/polymarket/dashboard
pm2 delete polymarket-dashboard 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup

ecosystem.config.js zaten doğru path'e ayarlı (/opt/polymarket/dashboard).

## Adım 6: Doğrula
sleep 3

# Port dinleniyor mu?
ss -tlnp | grep 8004

# Localhost'tan erişilebilir mi?
curl -s -o /dev/null -w '%{http_code}' http://localhost:8004

# Dışarıdan erişilebilir mi?
curl -s -o /dev/null -w '%{http_code}' http://135.181.206.109:8004

# PM2 durumu
pm2 status

Beklenen sonuçlar:
- Port 8004 LISTEN durumda
- HTTP 200 yanıtı
- PM2'de "polymarket-dashboard" online

Eğer çalışmıyorsa:
- pm2 logs polymarket-dashboard --lines 50 ile logları kontrol et
- Hata varsa düzelt ve pm2 restart polymarket-dashboard yap

## Adım 7: Firewall kontrolü
ufw status | grep 8004

Eğer 8004 yoksa:
ufw allow 8004
ufw reload

## Önemli Notlar
- MCP server (src/) kısmını deploy ETME, sadece dashboard
- Mevcut servislere (paper_bot vb.) dokunma, sadece port çakışması varsa bildir
- Her adımdan sonra sonucu doğrula, hata varsa logları kontrol et
- Dashboard client-side API kullanıyor, proxy ayarı gerekmez
- .env dosyası gerekmez, dashboard varsayılan API URL'lerini kullanıyor
```

## PROMPT BİTİŞ

---

## Alternatif: Tek Script ile Deploy

Eğer prompt yerine direkt bir script çalıştırmak istersen, VPS'te şunu çalıştır:

```bash
#!/bin/bash
set -e

echo "=== 1/7 Ortam Kontrolü ==="
echo "Node: $(node -v 2>/dev/null || echo 'YOK')"
echo "npm: $(npm -v 2>/dev/null || echo 'YOK')"
echo "git: $(git --version 2>/dev/null || echo 'YOK')"
echo "pm2: $(pm2 --version 2>/dev/null || echo 'YOK')"

# Node.js yoksa kur
if ! command -v node &> /dev/null; then
    echo "Node.js kuruluyor..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# pm2 yoksa kur
if ! command -v pm2 &> /dev/null; then
    echo "pm2 kuruluyor..."
    npm install -g pm2
fi

echo ""
echo "=== 2/7 Port Kontrolü ==="
if ss -tlnp | grep -q ':8004'; then
    echo "UYARI: Port 8004 kullanımda!"
    ss -tlnp | grep ':8004'
    echo "Serbest bırakılıyor..."
    fuser -k 8004/tcp 2>/dev/null || true
    sleep 2
fi
echo "Port 8004 boş"

echo ""
echo "=== 3/7 Repo Klonlama ==="
if [ -d "/opt/polymarket" ]; then
    echo "Mevcut repo güncelleniyor..."
    cd /opt/polymarket
    git fetch origin
    git checkout claude/polymarket-mcp-integration-F3JjW
    git pull origin claude/polymarket-mcp-integration-F3JjW
else
    cd /opt
    git clone https://github.com/ozanturk19/claude.git polymarket
    cd /opt/polymarket
    git checkout claude/polymarket-mcp-integration-F3JjW
fi
echo "Repo hazır"

echo ""
echo "=== 4/7 npm install ==="
cd /opt/polymarket/dashboard
npm install
echo "Bağımlılıklar kuruldu"

echo ""
echo "=== 5/7 Build ==="
npm run build
echo "Build tamamlandı"

echo ""
echo "=== 6/7 PM2 Başlat ==="
pm2 delete polymarket-dashboard 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
echo "PM2 başlatıldı"

echo ""
echo "=== 7/7 Doğrulama ==="
sleep 3
echo "Port durumu:"
ss -tlnp | grep 8004 || echo "HATA: Port 8004 dinlenmiyor!"

HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8004)
echo "HTTP Status: $HTTP_CODE"

echo ""
pm2 status

if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo "========================================="
    echo "  BASARILI! Dashboard hazir"
    echo "  http://135.181.206.109:8004"
    echo "========================================="
else
    echo ""
    echo "HATA: Dashboard yanit vermiyor (HTTP $HTTP_CODE)"
    echo "Loglar:"
    pm2 logs polymarket-dashboard --lines 20 --nostream
fi
```
