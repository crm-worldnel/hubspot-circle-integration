const express = require('express');
const circleRoutes = require('./routes/circle.routes');
const syncRoutes = require('./routes/sync.routes');
const logger = require('./utils/logger');

const app = express();

// --- Middleware ---
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
});

// --- Routes ---
app.use('/api/circle', circleRoutes);
app.use('/api/sync', syncRoutes);

// Health / status check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/status', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// --- Global error handler ---
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', {
    errorMessage: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
