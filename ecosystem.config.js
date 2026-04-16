module.exports = {
  apps: [
    {
      name: 'polymarket-bot',
      script: 'node_modules/.bin/ts-node',
      args: 'index.ts --mode=paper',
      cwd: '/opt/polymarket/bot',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      log_file: '/opt/polymarket/bot/data/bot.log',
      error_file: '/opt/polymarket/bot/data/bot-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'polymarket-live',
      script: 'node_modules/.bin/ts-node',
      args: 'index.ts --mode=live',
      cwd: '/opt/polymarket/bot',
      instances: 1,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000,
      log_file: '/opt/polymarket/bot/data/live.log',
      error_file: '/opt/polymarket/bot/data/live-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ]
};
