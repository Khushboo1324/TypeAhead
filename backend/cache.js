// cache.js
// In-memory HashMap cache with consistent hashing across 3 virtual nodes

const crypto = require('crypto');

// 3 virtual cache nodes (simulates distributed cache)
const NODES = ['CacheNode-A', 'CacheNode-B', 'CacheNode-C'];

// Each node has its own HashMap
const nodeStorage = {
  'CacheNode-A': new Map(),
  'CacheNode-B': new Map(),
  'CacheNode-C': new Map(),
};

let hits = 0;
let misses = 0;

// Consistent hashing: hash the prefix → pick a node
function getNode(prefix) {
  const hash = crypto.createHash('md5').update(prefix).digest('hex');
  const hashInt = parseInt(hash.substring(0, 8), 16);
  const nodeIndex = hashInt % NODES.length;
  return NODES[nodeIndex];
}

function get(prefix) {
  const node = getNode(prefix);
  const data = nodeStorage[node].get(prefix);

  if (data !== undefined) {
    hits++;
    return { data, node, hit: true };
  }

  misses++;
  return { data: null, node, hit: false };
}

function set(prefix, suggestions) {
  const node = getNode(prefix);
  nodeStorage[node].set(prefix, suggestions);
  console.log(`[Cache] prefix:"${prefix}" → assigned to ${node}`);
}

function invalidate(prefix) {
  const node = getNode(prefix);
  nodeStorage[node].delete(prefix);
}

function getStats() {
  const totalKeys = NODES.reduce((sum, n) => sum + nodeStorage[n].size, 0);
  return {
    hits,
    misses,
    hitRate: hits + misses === 0
      ? '0%'
      : ((hits / (hits + misses)) * 100).toFixed(1) + '%',
    totalKeys,
    nodeDistribution: NODES.map(n => ({
      node: n,
      keys: nodeStorage[n].size
    }))
  };
}

module.exports = { get, set, invalidate, getStats, getNode };