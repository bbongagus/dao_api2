/**
 * Test repeatable nodes daily reset logic
 * Manually triggers the same logic that runs at midnight
 * Run with: node test-repeatable-reset.js
 */

import redis from './src/redis.js';

const DEFAULT_USER_ID = 'dev-user-1';

async function getGraph(graphId, userId = DEFAULT_USER_ID) {
  try {
    const data = await redis.get(`user:${userId}:graph:${graphId}`);
    if (!data) return null;
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Redis get error:', error);
    return null;
  }
}

async function saveGraph(graphId, graph, userId = DEFAULT_USER_ID) {
  try {
    graph.version = (graph.version || 0) + 1;
    graph.lastUpdated = new Date().toISOString();
    const graphData = JSON.stringify(graph);
    await redis.set(`user:${userId}:graph:${graphId}`, graphData);
    return true;
  } catch (error) {
    console.error('❌ Redis save error:', error);
    return false;
  }
}

async function testRepeatableReset() {
  console.log('🧪 Testing repeatable nodes daily reset logic...');
  console.log('   User: dev-user-1');
  console.log('   Graph: main');
  console.log('');
  
  try {
    const userId = DEFAULT_USER_ID;
    const graphId = 'main';
    
    const graph = await getGraph(graphId, userId);
    if (!graph || !graph.nodes) {
      console.log('❌ No graph data found for repeatable reset');
      process.exit(1);
    }
    
    console.log(`📊 Graph loaded: ${graph.nodes.length} root nodes`);
    console.log('');
    
    let updatedCount = 0;
    
    // Reset repeatable nodes recursively (SAME LOGIC AS CRON JOB)
    const resetRepeatableNodes = (nodes, level = 0) => {
      const indent = '  '.repeat(level);
      
      nodes.forEach(node => {
        if (node.nodeType === 'repeatable') {
          console.log(`${indent}🔍 Found repeatable: "${node.title}"`);
          console.log(`${indent}   Before: isDone=${node.isDone}, currentCompletions=${node.currentCompletions || 0}`);
          
          if (node.isDone === true) {
            // Node was completed today - increment counter and reset flag
            node.isDone = false;
            node.currentCompletions = (node.currentCompletions || 0) + 1;
            console.log(`${indent}   After:  isDone=${node.isDone}, currentCompletions=${node.currentCompletions} ✅`);
            updatedCount++;
          } else {
            console.log(`${indent}   Skipped: not completed today (isDone=false)`);
          }
        }
        
        if (node.children && node.children.length > 0) {
          resetRepeatableNodes(node.children, level + 1);
        }
      });
    };
    
    resetRepeatableNodes(graph.nodes);
    
    console.log('');
    console.log(`📋 Summary:`);
    console.log(`   Repeatable nodes updated: ${updatedCount}`);
    console.log('');
    
    if (updatedCount > 0) {
      console.log('💾 Saving graph...');
      await saveGraph(graphId, graph, userId);
      console.log('✅ Graph saved to Redis');
      console.log('');
      console.log('Next steps:');
      console.log('   1. Refresh frontend (F5)');
      console.log('   2. Repeatable nodes should have:');
      console.log('      - isDone = false');
      console.log('      - currentCompletions increased by 1');
    } else {
      console.log('ℹ️  No repeatable nodes to reset (none were completed today)');
      console.log('');
      console.log('To test:');
      console.log('   1. Click on a repeatable node in frontend');
      console.log('   2. Run this script again');
      console.log('   3. Should see currentCompletions increment');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await redis.disconnect();
    process.exit(0);
  }
}

testRepeatableReset();
