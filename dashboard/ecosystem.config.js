module.exports = {
  apps: [{
    name: 'polymarket-dashboard',
    script: 'node_modules/.bin/next',
    args: 'start -p 8004 -H 0.0.0.0',
    cwd: '/opt/polymarket/dashboard',
    env: {
      NODE_ENV: 'production',
      PORT: 8004,
    },
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
  }],
};
