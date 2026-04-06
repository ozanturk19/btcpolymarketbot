// Tool modüllerini yükle - her biri kendi araçlarını register eder
import './tools/marketDiscovery';
import './tools/realTimeIntelligence';
import './tools/marketAnalysis';
import './tools/websocketTools';

// MCP sunucusunu başlat
import { startServer } from './server';

startServer().catch((err) => {
  console.error('[Polymarket MCP] Başlatma hatası:', err);
  process.exit(1);
});
