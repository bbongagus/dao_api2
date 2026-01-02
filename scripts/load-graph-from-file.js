/**
 * Script to load graph from JSON file into Redis
 *
 * Usage: cd dao_api2 && node scripts/load-graph-from-file.js /tmp/graph5.json
 * 
 * Options:
 *   --user-id=USER_ID   Override user ID (default: google-oauth2|115460786955799167178)
 *   --graph-id=GRAPH_ID Override graph ID (default: main)
 *   --dedup             Remove duplicate edges before saving
 */

import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

// Parse command line args
const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));
const dedup = args.includes('--dedup');

// Parse options
let userId = 'google-oauth2|115460786955799167178';
let graphId = 'main';

args.forEach(arg => {
  if (arg.startsWith('--user-id=')) {
    userId = arg.split('=')[1];
  }
  if (arg.startsWith('--graph-id=')) {
    graphId = arg.split('=')[1];
  }
});

async function loadGraphFromFile() {
  if (!filePath) {
    console.log('❌ Usage: node scripts/load-graph-from-file.js <file.json> [--dedup] [--user-id=ID] [--graph-id=ID]');
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  
  console.log(`📖 Reading graph from file: ${absolutePath}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Graph ID: ${graphId}`);
  console.log(`   Dedup edges: ${dedup}`);
  
  try {
    // Read file
    if (!fs.existsSync(absolutePath)) {
      console.log(`❌ File not found: ${absolutePath}`);
      process.exit(1);
    }
    
    const fileContent = fs.readFileSync(absolutePath, 'utf8');
    const graph = JSON.parse(fileContent);
    
    console.log(`\n📊 Graph data:`);
    console.log(`   Nodes: ${graph.nodes?.length || 0}`);
    console.log(`   Edges: ${graph.edges?.length || 0}`);
    
    // Deduplicate edges if requested
    if (dedup && graph.edges) {
      const edgeIds = graph.edges.map(e => e.id);
      const duplicateIds = edgeIds.filter((id, index) => edgeIds.indexOf(id) !== index);
      
      if (duplicateIds.length > 0) {
        console.log(`\n🔴 Found ${duplicateIds.length} duplicate edge(s)`);
        
        const seenIds = new Set();
        graph.edges = graph.edges.filter(edge => {
          if (seenIds.has(edge.id)) {
            return false;
          }
          seenIds.add(edge.id);
          return true;
        });
        
        console.log(`   Edges after dedup: ${graph.edges.length}`);
      } else {
        console.log(`\n✅ No duplicate edges found`);
      }
    }
    
    // Update metadata
    graph.version = (graph.version || 0) + 1;
    graph.userId = userId;
    graph.lastUpdated = new Date().toISOString();
    
    // Save to Redis
    const key = `user:${userId}:graph:${graphId}`;
    console.log(`\n💾 Saving to Redis key: ${key}`);
    
    await redis.set(key, JSON.stringify(graph));
    
    console.log(`\n✅ Done!`);
    console.log(`   Nodes: ${graph.nodes?.length || 0}`);
    console.log(`   Edges: ${graph.edges?.length || 0}`);
    console.log(`   Version: ${graph.version}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

loadGraphFromFile();
