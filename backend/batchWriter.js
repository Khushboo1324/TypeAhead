// batchWriter.js
// Buffers POST /search submissions and flushes to SQLite in batches
// This reduces DB write pressure significantly

const db = require('./db');

// In-memory buffer: { "iphone charger": 3, "macbook": 1 }
const buffer = {};
let totalBuffered = 0;
let totalFlushed = 0;
let flushCount = 0;

const FLUSH_INTERVAL_MS = 10000; // flush every 10 seconds
const FLUSH_BATCH_SIZE = 100;    // or when 100 searches accumulate

function addToBuffer(query) {
  const key = query.toLowerCase().trim();
  buffer[key] = (buffer[key] || 0) + 1;
  totalBuffered++;

  console.log(`[BatchWriter] Buffered: "${key}" | Buffer size: ${totalBuffered}`);

  // Flush early if batch size reached
  if (totalBuffered >= FLUSH_BATCH_SIZE) {
    flush();
  }
}

function flush() {
  const keys = Object.keys(buffer);
  if (keys.length === 0) return;

  const uniqueCount = keys.length;
  const totalCount = totalBuffered;

  console.log(`[BatchWriter] Flushing ${uniqueCount} unique queries (${totalCount} total buffered)...`);
  console.log(`[BatchWriter] Write reduction: ${totalCount} searches → ${uniqueCount} DB writes`);

  const upsert = db.prepare(`
    INSERT INTO queries (query, count, last_updated)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(query) DO UPDATE SET
      count = count + excluded.count,
      last_updated = datetime('now')
  `);

  const flushAll = db.transaction(() => {
    for (const key of keys) {
      upsert.run(key, buffer[key]);
      delete buffer[key];
    }
  });

flushAll();

  totalFlushed += uniqueCount;
  flushCount++;
  
  const reduction = (((totalCount - uniqueCount) / totalCount) * 100).toFixed(1);
  
  console.log(`[BatchWriter]  Flush #${flushCount} complete.`);
  console.log(`[BatchWriter]  Write Reduction: ${totalCount} searches → ${uniqueCount} DB writes (${reduction}% fewer writes)`);
  
  totalBuffered = 0;
}

function getStats() {
  return {
    currentBufferSize: totalBuffered,
    uniqueQueriesInBuffer: Object.keys(buffer).length,
    totalFlushed,
    flushCount,
    writeReduction: totalBuffered > 0
      ? `${totalBuffered} searches → ${Object.keys(buffer).length} DB writes`
      : 'No pending writes',
    buffer
  };
}

// Auto-flush every 10 seconds
setInterval(flush, FLUSH_INTERVAL_MS);

module.exports = { addToBuffer, flush, getStats };