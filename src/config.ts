import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
  mode: (process.env.POLYMARKET_MODE || 'demo') as 'demo' | 'full',

  api: {
    gamma:  process.env.GAMMA_API_URL  || 'https://gamma-api.polymarket.com',
    clob:   process.env.CLOB_API_URL   || 'https://clob.polymarket.com',
    data:   process.env.DATA_API_URL   || 'https://data-api.polymarket.com',
  },

  wallet: {
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    address:    process.env.WALLET_ADDRESS     || '',
  },

  safety: {
    requireConfirmationAboveUsd: Number(process.env.REQUIRE_CONFIRMATION_ABOVE_USD || 100),
    maxSpreadTolerance:          Number(process.env.MAX_SPREAD_TOLERANCE            || 0.05),
    maxSingleTradeUsd:           Number(process.env.MAX_SINGLE_TRADE_USD            || 500),
  },

  ws: {
    url:                process.env.WS_URL                    || 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    reconnectDelayMs:   Number(process.env.WS_RECONNECT_DELAY_MS   || 3000),
    maxReconnectAttempts: Number(process.env.WS_MAX_RECONNECT_ATTEMPTS || 5),
  },
} as const;

export const isDemoMode = () => config.mode === 'demo';
export const isFullMode = () => config.mode === 'full';
