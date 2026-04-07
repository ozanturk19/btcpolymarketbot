# VPS Deploy Prompt — Polymarket MCP Dashboard

## Ajan Prompt'u (Kopyala-Yapıştır Hazır)

Aşağıdaki prompt'u Claude Code veya herhangi bir AI ajanına verin:

---

```
Sen bir VPS deployment uzmanısın. Aşağıdaki 7 adımı sırayla, her adımda hata kontrolü yaparak gerçekleştir.

HEDEF: Polymarket MCP Dashboard'u VPS'e deploy et ve port 8004'te çalışır hale getir.

REPO: https://github.com/ozanturk19/claude.git
BRANCH: claude/polymarket-mcp-integration-F3JjW

## ADIM 1: Sistem Hazırlığı
```bash
# Node.js 20+ kontrolü
node --version || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)

# PM2 global kurulum
npm list -g pm2 || npm install -g pm2

# Git kontrolü
git --version || sudo apt-get install -y git
```

## ADIM 2: Repo Klonlama
```bash
# Eğer dizin varsa güncelle, yoksa klonla
if [ -d "/opt/polymarket" ]; then
  cd /opt/polymarket && git fetch origin && git checkout claude/polymarket-mcp-integration-F3JjW && git pull
else
  git clone -b claude/polymarket-mcp-integration-F3JjW https://github.com/ozanturk19/claude.git /opt/polymarket
fi
cd /opt/polymarket
```

## ADIM 3: Ortam Değişkenleri
```bash
# .env dosyası oluştur (yoksa)
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "UYARI: .env dosyası oluşturuldu. Gerekliyse API anahtarlarını ekleyin."
fi

# Dashboard .env
cat > dashboard/.env.local << 'EOF'
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:3001
NEXT_PUBLIC_GAMMA_API=https://gamma-api.polymarket.com
NEXT_PUBLIC_CLOB_API=https://clob.polymarket.com
EOF
```

## ADIM 4: Bağımlılık Kurulumu
```bash
# MCP Server bağımlılıkları
npm install

# Dashboard bağımlılıkları
cd dashboard && npm install && cd ..

# TypeScript derleme
npm run build 2>&1 | tail -20
```

## ADIM 5: Dashboard Build
```bash
cd dashboard

# Next.js production build
npm run build 2>&1 | tail -30

if [ $? -ne 0 ]; then
  echo "HATA: Dashboard build başarısız. Loglara bakın."
  exit 1
fi

cd ..
```

## ADIM 6: PM2 ile Başlatma
```bash
# Mevcut süreçleri durdur
pm2 delete polymarket-mcp 2>/dev/null || true
pm2 delete polymarket-dashboard 2>/dev/null || true

# MCP Server başlat (port 3001)
pm2 start npm --name "polymarket-mcp" -- run start -- --port 3001

# Dashboard başlat (port 8004)
cd dashboard
pm2 start npm --name "polymarket-dashboard" -- run start -- --port 8004
cd ..

# PM2 startup kaydet
pm2 save
pm2 startup 2>&1 | tail -5
```

## ADIM 7: Sağlık Kontrolü
```bash
sleep 5

# MCP Server kontrolü
curl -s http://localhost:3001/health | python3 -m json.tool || echo "MCP Server yanıt vermiyor"

# Dashboard kontrolü
curl -s -o /dev/null -w "%{http_code}" http://localhost:8004 | grep -q "200" && \
  echo "✓ Dashboard port 8004'te çalışıyor" || \
  echo "✗ Dashboard başlatılamadı"

# PM2 durum
pm2 status

# Firewall (ufw varsa)
sudo ufw allow 8004/tcp 2>/dev/null || true
sudo ufw allow 3001/tcp 2>/dev/null || true

echo ""
echo "=== DEPLOY TAMAMLANDI ==="
echo "Dashboard: http://$(curl -s ifconfig.me):8004"
echo "MCP Server: http://$(curl -s ifconfig.me):3001"
```

Her adımda çıktıyı kontrol et. Hata varsa devam etmeden önce bildir.
```

---

## Bash Script Alternatifi (Tek Seferde Çalıştır)

VPS'e SSH ile bağlandıktan sonra tek komutla deploy:

```bash
curl -fsSL https://raw.githubusercontent.com/ozanturk19/claude/claude/polymarket-mcp-integration-F3JjW/deploy.sh | bash
```

Veya yerel script olarak:

```bash
#!/bin/bash
set -e

echo "=== Polymarket Dashboard Deploy ==="

# Renkler
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# 1. Node.js
log "Node.js kontrol ediliyor..."
node --version 2>/dev/null | grep -qE "v(18|20|22)" || {
  warn "Node.js 20 kuruluyor..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

# 2. PM2
log "PM2 kontrol ediliyor..."
npm list -g pm2 &>/dev/null || npm install -g pm2

# 3. Repo
log "Repo klonlanıyor/güncelleniyor..."
DEPLOY_DIR="/opt/polymarket"
if [ -d "$DEPLOY_DIR/.git" ]; then
  cd "$DEPLOY_DIR"
  git fetch origin
  git checkout claude/polymarket-mcp-integration-F3JjW
  git pull origin claude/polymarket-mcp-integration-F3JjW
else
  git clone -b claude/polymarket-mcp-integration-F3JjW \
    https://github.com/ozanturk19/claude.git "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

# 4. Env
[ -f ".env" ] || cp .env.example .env
cat > dashboard/.env.local << 'EOF'
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:3001
NEXT_PUBLIC_GAMMA_API=https://gamma-api.polymarket.com
NEXT_PUBLIC_CLOB_API=https://clob.polymarket.com
EOF

# 5. Bağımlılıklar
log "Bağımlılıklar kuruluyor..."
npm install --production 2>&1 | tail -5
cd dashboard && npm install 2>&1 | tail -5 && cd ..

# 6. Build
log "Dashboard build ediliyor..."
cd dashboard
npm run build 2>&1 | tail -10
[ $? -eq 0 ] || err "Build başarısız!"
cd ..

# 7. PM2
log "Servisler başlatılıyor..."
pm2 delete polymarket-mcp polymarket-dashboard 2>/dev/null || true
pm2 start npm --name "polymarket-mcp" -- run start -- --port 3001
cd dashboard
pm2 start npm --name "polymarket-dashboard" -- run start -- --port 8004
cd ..
pm2 save

# 8. Firewall
sudo ufw allow 8004/tcp 2>/dev/null || true
sudo ufw allow 3001/tcp 2>/dev/null || true

# 9. Kontrol
sleep 8
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8004)
[ "$HTTP_STATUS" = "200" ] && log "Dashboard çalışıyor!" || warn "Dashboard yanıt vermiyor (status: $HTTP_STATUS)"

VPS_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "=============================="
log "DEPLOY BAŞARILI"
echo "Dashboard : http://$VPS_IP:8004"
echo "MCP Server: http://$VPS_IP:3001"
echo "PM2 Durum : pm2 status"
echo "Loglar    : pm2 logs polymarket-dashboard"
echo "=============================="
```

---

## Hata Senaryoları ve Çözümler

### Port Çakışması
```bash
# Port 8004'ü kullanan süreci bul ve sonlandır
sudo lsof -ti:8004 | xargs sudo kill -9 2>/dev/null || true
sudo lsof -ti:3001 | xargs sudo kill -9 2>/dev/null || true
```

### Node.js Versiyon Uyumsuzluğu
```bash
# nvm ile doğru versiyonu kullan
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
```

### Build Bellek Hatası (ENOMEM)
```bash
# Swap dosyası ekle
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Sonra build tekrar dene
cd dashboard && npm run build
```

### PM2 Servis Başlamıyor
```bash
# Logları kontrol et
pm2 logs polymarket-dashboard --lines 50

# Manuel test
cd /opt/polymarket/dashboard
node_modules/.bin/next start -p 8004
```

### Nginx Reverse Proxy (Opsiyonel)
```nginx
# /etc/nginx/sites-available/polymarket
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8004;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /mcp/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Güncelleme (Sonraki Deploy'lar)

```bash
cd /opt/polymarket
git pull origin claude/polymarket-mcp-integration-F3JjW
cd dashboard && npm install && npm run build && cd ..
pm2 restart all
```
