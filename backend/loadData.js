// loadData.js - Reads CSV and loads into SQLite (run once)
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('./db');

const CSV_PATH = path.join(__dirname, '../data/search_queries_dataset.csv');

const insert = db.prepare(`
  INSERT INTO queries (query, count, score, last_updated)
  VALUES (?, ?, 0, ?)
  ON CONFLICT(query) DO UPDATE SET
    count = count + excluded.count,
    last_updated = excluded.last_updated
`);

function normalizeCount(raw) {
  const c = parseInt(raw) || 1;
  if (c > 10000)      return Math.floor(c / 1000);
  if (c >= 100)       return Math.floor(c / 100);
  return c;
}

const insertMany = db.transaction((rows) => {
  for (const row of rows) {
    insert.run(
      row.query.toLowerCase().trim(),
      normalizeCount(row.count),
      row.timestamp || new Date().toISOString()
    );
  }
});

const rows = [];

fs.createReadStream(CSV_PATH)
  .pipe(csv())
  .on('data', (row) => {
    if (row.query && row.query.trim() !== '') {
      rows.push(row);
    }
  })
  .on('end', () => {
    console.log(`[LoadData] Found ${rows.length} queries in CSV...`);
    insertMany(rows);
    console.log('[LoadData] Done! All queries loaded into SQLite.');
    process.exit(0);
  })
  .on('error', (err) => {
    console.error('[LoadData] Error reading CSV:', err.message);
    process.exit(1);
  });