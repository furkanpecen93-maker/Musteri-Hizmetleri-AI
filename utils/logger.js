// utils/logger.js
const log = {
  info: (msg, data) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ℹ️  ${msg}`, data ? JSON.stringify(data) : '');
  },
  warn: (msg, data) => {
    const ts = new Date().toISOString();
    console.warn(`[${ts}] ⚠️  ${msg}`, data ? JSON.stringify(data) : '');
  },
  error: (msg, err) => {
    const ts = new Date().toISOString();
    console.error(`[${ts}] ❌ ${msg}`, err instanceof Error ? err.message : (err || ''));
  }
};

module.exports = log;
