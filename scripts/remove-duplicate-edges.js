/**
 * Script to remove duplicate edges from Redis graph data
 *
 * Usage: cd dao_api2 && node scripts/remove-duplicate-edges.js
 */

import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

const USER_ID = 'dev-user-1';
const GRAPH_ID = 'main';

async function removeDuplicateEdges() {
  const key = `user:${USER_ID}:graph:${GRAPH_ID}`;
  console.log(`📖 Reading graph from Redis key: ${key}`);
  
  try {
    const data = await redis.get(key);
    
    if (!data) {
      console.log('❌ No graph data found');
      process.exit(1);
    }
    
    const graph = JSON.parse(data);
    console.log(`\n📊 Current state:`);
    console.log(`   Nodes: ${graph.nodes?.length || 0}`);
    console.log(`   Edges: ${graph.edges?.length || 0}`);
    
    // Find duplicates
    const edgeIds = graph.edges.map(e => e.id);
    const duplicates = edgeIds.filter((id, index) => edgeIds.indexOf(id) !== index);
    
    if (duplicates.length === 0) {
      console.log('\n✅ No duplicate edges found!');
      process.exit(0);
    }
    
    console.log(`\n🔴 Found ${duplicates.length} duplicate edge IDs:`);
    duplicates.forEach(dupId => {
      const dupes = graph.edges.filter(e => e.id === dupId);
      console.log(`   → "${dupId}" appears ${dupes.length} times`);
      dupes.forEach((e, i) => {
        console.log(`      [${i}] source: ${e.source}, target: ${e.target}`);
      });
    });
    
    // Deduplicate - keep first occurrence of each edge ID
    const seenIds = new Set();
    const deduplicatedEdges = graph.edges.filter(edge => {
      if (seenIds.has(edge.id)) {
        return false;
      }
      seenIds.add(edge.id);
      return true;
    });
    
    const removedCount = graph.edges.length - deduplicatedEdges.length;
    console.log(`\n🧹 Removing ${removedCount} duplicate edges...`);
    
    // Update graph
    graph.edges = deduplicatedEdges;
    graph.version = (graph.version || 0) + 1;
    
    // Save back to Redis
    await redis.set(key, JSON.stringify(graph));
    
    console.log(`\n✅ Done! Graph saved.`);
    console.log(`   Edges before: ${graph.edges.length + removedCount}`);
    console.log(`   Edges after:  ${graph.edges.length}`);
    console.log(`   Version: ${graph.version}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

removeDuplicateEdges();
