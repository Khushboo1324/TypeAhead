// server.js - Main Express server
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const cache = require('./cache');
const { addToBuffer, flush, getStats: getBufferStats } = require('./batchWriter');
const { runBatchProcessor, redis } = require('./batchProcessor');

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));


// Latency tracker for p95 reporting
const latencyLog = [];
const MAX_LATENCY_SAMPLES = 1000;

function recordLatency(ms) {
  latencyLog.push(ms);
  if (latencyLog.length > MAX_LATENCY_SAMPLES) {
    latencyLog.shift(); // keep only last 1000 samples
  }
}

function getP95Latency() {
  if (latencyLog.length === 0) return 0;
  const sorted = [...latencyLog].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[index];
}

// ─────────────────────────────────────────
// GET /suggest?q=<prefix>
// ─────────────────────────────────────────
app.get('/suggest', async (req, res) => {
  const start = Date.now();
  const prefix = (req.query.q || '').toLowerCase().trim();

  if (prefix.length < 3) {
    return res.json({ suggestions: [], latency_ms: 0 });
  }

  // 1. Check cache first (consistent hashing)
  const { data, node, hit } = cache.get(prefix);
  if (hit) {
// inside cache hit block
  const latency = Date.now() - start;
  recordLatency(latency);
  return res.json({
    suggestions: data,
    source: 'cache',
    node,
    latency_ms: latency
  });
  }

  // 2. Cache miss → query Redis Sorted Set
  const results = await redis.zrevrange(`prefix:${prefix}`, 0, 9, 'WITHSCORES');

  // results = ["iphone", "93456", "iphone pro", "91765", ...]
  const suggestions = [];
  for (let i = 0; i < results.length; i += 2) {
    suggestions.push({
      query: results[i],
      score: parseInt(results[i + 1])
    });
  }

  // 3. Store in cache for next request
  cache.set(prefix, suggestions);

// inside redis block
  const latency = Date.now() - start;
  recordLatency(latency);
  return res.json({
    suggestions,
    source: 'redis',
    node,
    latency_ms: latency
  });
});

// ─────────────────────────────────────────
// POST /search  { "query": "iphone charger" }
// ─────────────────────────────────────────
app.post('/search', (req, res) => {
  const query = (req.body.query || '').trim();

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  // Add to batch buffer (not directly to DB)
  addToBuffer(query);

  return res.json({ message: 'Searched' });
});

// ─────────────────────────────────────────
// GET /trending
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// GET /trending/basic  (sort by count only - no recency)
// GET /trending/enhanced (sort by score - exponential decay)
// ─────────────────────────────────────────
app.get('/trending/basic', (req, res) => {
  const trending = db.prepare(`
    SELECT query, count
    FROM queries
    ORDER BY count DESC
    LIMIT 10
  `).all();

  res.json({ 
    type: 'basic',
    description: 'Sorted by total all-time count only',
    trending 
  });
});

app.get('/trending/enhanced', (req, res) => {
  const trending = db.prepare(`
    SELECT query, score, count
    FROM queries
    ORDER BY score DESC
    LIMIT 10
  `).all();

  res.json({ 
    type: 'enhanced',
    description: 'Sorted by score using exponential decay: score = score * 0.9 + count',
    trending 
  });
});

// ─────────────────────────────────────────
// GET /cache/debug?prefix=iph
// ─────────────────────────────────────────
app.get('/cache/debug', (req, res) => {
  const prefix = (req.query.prefix || '').toLowerCase().trim();
  const node = cache.getNode(prefix);
  const { data, hit } = cache.get(prefix);

  res.json({
    prefix,
    assigned_node: node,
    cache_hit: hit,
    cached_suggestions: data || []
  });
});

// ─────────────────────────────────────────
// GET /stats
// ─────────────────────────────────────────
app.get('/stats', (req, res) => {
  const cacheStats = cache.getStats();
  const bufferStats = getBufferStats();
  const queryCount = db.prepare('SELECT COUNT(*) as total FROM queries').get();

  res.json({
    cache: cacheStats,
    batchBuffer: bufferStats,
    totalQueriesInDB: queryCount.total,
    latency: {
      p95_ms: getP95Latency(),
      samples: latencyLog.length,
      all_samples: latencyLog
    }
  });
});

// ─────────────────────────────────────────
// Startup: build Redis index + run every 60s
// ─────────────────────────────────────────
console.log('[Server] Building Redis index on startup...');
runBatchProcessor().then(() => {
  console.log('[Server] Redis index ready.');
});

setInterval(() => {
  console.log('[Server] Running scheduled batch processor...');
  runBatchProcessor();
}, 60000);

app.listen(PORT, () => {
  console.log(`\n[Server] Running at http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /suggest?q=<prefix>');
  console.log('  POST /search');
  console.log('  GET  /trending');
  console.log('  GET  /cache/debug?prefix=<prefix>');
  console.log('  GET  /stats\n');
});