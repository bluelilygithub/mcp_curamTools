/**
 * logger.js — Winston logger with DB transport for in-app log viewer.
 *
 * Writes info/warn/error entries to the app_logs table so they appear
 * in Admin > Logs > Server Logs tab.
 *
 * Usage:
 *   const logger = require('../utils/logger');
 *   logger.info('Server started');
 *   logger.warn('Slow query', { duration: 1200 });
 *   logger.error('Something broke', { error: err.message });
 */

const { createLogger, format, transports } = require('winston');
const Transport = require('winston-transport');

const isDev = process.env.NODE_ENV !== 'production';

// DB transport — lazy-requires pool to avoid circular dependency
class DBTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.name = 'database';
  }

  log(info, callback) {
    callback(); // never block the logging pipeline

    const { level, message, [Symbol.for('splat')]: _splat, ...meta } = info;
    const clean = Object.fromEntries(
      Object.entries(meta).filter(([k]) => !k.startsWith('Symbol('))
    );

    setImmediate(() => {
      try {
        const { pool } = require('../db');
        pool.query(
          `INSERT INTO app_logs (level, message, meta) VALUES ($1, $2, $3)`,
          [level, message, Object.keys(clean).length ? clean : null]
        ).catch(() => {});
      } catch (_) {}
    });
  }
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isDev
    ? format.combine(
        format.colorize(),
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const clean = Object.fromEntries(
            Object.entries(meta).filter(([k]) => !k.startsWith('Symbol('))
          );
          const extras = Object.keys(clean).length ? ' ' + JSON.stringify(clean) : '';
          return `${timestamp} ${level}: ${message}${extras}`;
        })
      )
    : format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
  transports: [
    new transports.Console(),
    new DBTransport({ level: 'info' }),
  ],
});

module.exports = logger;
