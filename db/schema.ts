import Database from 'better-sqlite3';
import path from 'path';

export function openDb(dbPath = path.join(__dirname, '../data/observer.db')): Database.Database {
  const fs = require('fs');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Her BTC Up/Down market kaydı
    CREATE TABLE IF NOT EXISTS markets (
      id            TEXT PRIMARY KEY,
      question      TEXT NOT NULL,
      duration_min  INTEGER NOT NULL,   -- 5 | 15 | 60 | 1440
      token_up      TEXT,               -- CLOB token ID (Up outcome)
      token_down    TEXT,               -- CLOB token ID (Down outcome)
      open_time     INTEGER NOT NULL,   -- unix timestamp (tahmin)
      close_time    INTEGER NOT NULL,   -- unix timestamp (endDate)
      btc_open      REAL,               -- BTC fiyatı market açılışında
      btc_close     REAL,               -- BTC fiyatı kapanışta
      outcome       TEXT,               -- 'UP' | 'DOWN' | null (henüz bitmedi)
      up_price_final  REAL,             -- kapanış Up fiyatı
      down_price_final REAL,            -- kapanış Down fiyatı
      created_at    INTEGER DEFAULT (strftime('%s','now'))
    );

    -- Her market için zaman serisi orderbook snapshot
    CREATE TABLE IF NOT EXISTS snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id     TEXT NOT NULL REFERENCES markets(id),
      ts            INTEGER NOT NULL,   -- unix timestamp
      elapsed_sec   INTEGER NOT NULL,   -- market açılışından kaç saniye geçti
      up_bid        REAL,
      up_ask        REAL,
      up_best_price REAL,               -- midpoint
      down_bid      REAL,
      down_ask      REAL,
      down_best_price REAL,
      up_bid_depth  REAL,               -- top 5 bid toplam size
      up_ask_depth  REAL,
      down_bid_depth REAL,
      down_ask_depth REAL,
      btc_price     REAL,               -- o anki BTC spot fiyatı
      spread_up     REAL,               -- ask - bid
      spread_down   REAL
    );

    -- Paper trade kayıtları
    CREATE TABLE IF NOT EXISTS paper_trades (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id     TEXT NOT NULL REFERENCES markets(id),
      strategy      TEXT NOT NULL,      -- 'scalp' | 'reversal' | 'maker'
      side          TEXT NOT NULL,      -- 'UP' | 'DOWN'
      entry_price   REAL NOT NULL,
      entry_ts      INTEGER NOT NULL,
      target_price  REAL,
      stop_price    REAL,
      size_usd      REAL NOT NULL,
      exit_price    REAL,
      exit_ts       INTEGER,
      exit_reason   TEXT,               -- 'target' | 'stop' | 'expiry' | 'manual'
      pnl           REAL,               -- realized P&L
      pnl_pct       REAL,
      outcome       TEXT                -- 'WIN' | 'LOSS' | 'OPEN'
    );

    -- BTC spot fiyat geçmişi (Binance'ten)
    CREATE TABLE IF NOT EXISTS btc_prices (
      ts     INTEGER PRIMARY KEY,
      price  REAL NOT NULL
    );

    -- Index'ler
    CREATE INDEX IF NOT EXISTS idx_snapshots_market ON snapshots(market_id, ts);
    CREATE INDEX IF NOT EXISTS idx_trades_strategy  ON paper_trades(strategy);
    -- Canlı trade kayıtları (gerçek para)
    CREATE TABLE IF NOT EXISTS live_trades (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id       TEXT NOT NULL REFERENCES markets(id),
      token_id        TEXT NOT NULL,        -- CLOB token ID (UP veya DOWN)
      side            TEXT NOT NULL,        -- 'UP' | 'DOWN'
      entry_order_id  TEXT,                 -- Polymarket BUY order ID
      exit_order_id   TEXT,                 -- Polymarket SELL order ID (GTC limit @ target)
      shares          REAL NOT NULL,        -- satın alınan share miktarı
      entry_price     REAL NOT NULL,        -- giriş fiyatı (ask)
      entry_ts        INTEGER NOT NULL,
      target_price    REAL,                 -- 0.99
      stop_price      REAL,                 -- entry - 0.06
      size_usd        REAL NOT NULL,        -- harcanan USDC (~)
      exit_price      REAL,
      exit_ts         INTEGER,
      exit_reason     TEXT,                 -- 'stop_gtc_filled' | 'stop_fok_N' | 'settlement_win' | 'settlement_loss'
      pnl             REAL,
      pnl_pct         REAL,
      outcome         TEXT DEFAULT 'OPEN'   -- 'OPEN' | 'WIN' | 'LOSS'
    );

    CREATE INDEX IF NOT EXISTS idx_live_trades_market ON live_trades(market_id, outcome);

    CREATE INDEX IF NOT EXISTS idx_markets_close    ON markets(close_time);
  `);

  // Migration: stop_order_id kolonu ekle (yoksa)
  const cols = (db.pragma('table_info(live_trades)') as any[]).map((c: any) => c.name);
  if (!cols.includes('stop_order_id')) {
    db.exec(`ALTER TABLE live_trades ADD COLUMN stop_order_id TEXT`);
    console.log('[db] Migration: live_trades.stop_order_id kolonu eklendi');
  }

  return db;
}

export type Db = ReturnType<typeof openDb>;
