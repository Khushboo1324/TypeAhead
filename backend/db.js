// db.js - SQLite setup (Source of Truth)
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'typeahead.db'));

// Better performance
db.pragma('journal_mode = WAL');

// Only one table - stores all queries with count and score
db.exec(`
  CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT UNIQUE NOT NULL,
    count INTEGER DEFAULT 1,
    score REAL DEFAULT 0,
    last_updated TEXT DEFAULT (datetime('now'))
  )
`);

console.log('[DB] SQLite ready');
module.exports = db;