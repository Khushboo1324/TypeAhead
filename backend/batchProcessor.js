// batchProcessor.js
// Reads SQLite → computes scores → writes prefix:ZSET into Redis
const db = require('./db');
const Redis = require('ioredis');

const redis = new Redis({ host: '127.0.0.1', port: 6379 });

function generatePrefixes(query) {
  const prefixes = [];
  for (let i = 3; i <= query.length; i++) {
    prefixes.push(query.substring(0, i));
  }
  return prefixes;
}

async function runBatchProcessor() {
  console.log(`[BatchProcessor] Started at ${new Date().toISOString()}`);

  // Step 1: Exponential decay score update in SQLite
  // score = old_score * 0.9 + count
  db.prepare(`
    UPDATE queries
    SET score = score * 0.9 + count,
        last_updated = datetime('now')
  `).run();

  // Step 2: Fetch all queries sorted by score
  const allQueries = db.prepare(`
    SELECT query, score FROM queries ORDER BY score DESC
  `).all();

  console.log(`[BatchProcessor] Processing ${allQueries.length} queries...`);

  // Step 3: Clear old Redis prefix keys
// Step 3: Clear old Redis prefix keys in chunks (avoids stack overflow)
  const existingKeys = await redis.keys('prefix:*');
  if (existingKeys.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < existingKeys.length; i += chunkSize) {
      const chunk = existingKeys.slice(i, i + chunkSize);
      await redis.del(...chunk);
    }
    console.log(`[BatchProcessor] Cleared ${existingKeys.length} old prefix keys`);
  }

  // Step 4: Build prefix → sorted set in Redis using pipeline (fast batch write)
  const pipeline = redis.pipeline();

  for (const row of allQueries) {
    const query = row.query.toLowerCase().trim();
    const score = Math.round(row.score);
    const prefixes = generatePrefixes(query);

    for (const prefix of prefixes) {
      pipeline.zadd(`prefix:${prefix}`, score, row.query);
    }
  }

  await pipeline.exec();

  // Step 5: Trim every prefix key to top 10 only
  const allPrefixKeys = await redis.keys('prefix:*');
  const trimPipeline = redis.pipeline();
  for (const key of allPrefixKeys) {
    // zremrangebyrank removes lowest scores, keep only top 10
    trimPipeline.zremrangebyrank(key, 0, -11);
  }
  await trimPipeline.exec();

  console.log(`[BatchProcessor] Done. ${allPrefixKeys.length} prefix keys written to Redis.`);
}

module.exports = { runBatchProcessor, redis };

// If run directly
if (require.main === module) {
  runBatchProcessor()
    .then(() => {
      console.log('[BatchProcessor] Finished. Exiting.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[BatchProcessor] Error:', err.message);
      process.exit(1);
    });
}