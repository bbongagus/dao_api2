/**
 * Reset repeatable infinity nodes for new day
 * This script:
 * 1. Clears daily completions
 * 2. Sets isDone = false for all repeatable infinity nodes
 * 3. Keeps currentCompletions (cumulative counter)
 * 
 * Run with: node reset-repeatable-nodes.js
 */

import redis from './src/redis.js';
import dailyCompletions from './src/services/dailyCompletions.js';

async function resetRepeatableNodes() {
  const userId = 'dev-user-1';
  const graphId = 'main';
  
  console.log('🔄 Resetting repeatable infinity nodes for new day...');
  console.log(`   User: ${userId}`);
  console.log(`   Graph: ${graphId}`);
  console.log('');
  
  try {
    // Step 1: Get current graph
    const graphKey = `user:${userId}:graph:${graphId}`;
    const graphData = await redis.get(graphKey);
    
    if (!graphData) {
      console.error('❌ Graph not found in Redis');
      process.exit(1);
    }
    
    const graph = JSON.parse(graphData);
    console.log(`📊 Graph loaded: ${graph.nodes?.length || 0} root nodes`);
    console.log('');
    
    // Step 2: Find and reset repeatable infinity nodes
    let resetCount = 0;
    const repeatableNodes = [];
    
    const resetNodes = (nodes, level = 0) => {
      const indent = '  '.repeat(level);
      
      nodes.forEach(node => {
        if (node.nodeType === 'repeatable' && node.nodeSubtype === 'infinity') {
          repeatableNodes.push({
            id: node.id,
            title: node.title,
            isDone: node.isDone,
            currentCompletions: node.currentCompletions || 0
          });
          
          if (node.isDone) {
            console.log(`${indent}🔄 Resetting: "${node.title}"`);
            console.log(`${indent}   Before: isDone=${node.isDone}, completions=${node.currentCompletions || 0}`);
            
            node.isDone = false; // ✅ Reset flag for new day
            // currentCompletions stays the same! ✅
            
            console.log(`${indent}   After:  isDone=${node.isDone}, completions=${node.currentCompletions || 0}`);
            resetCount++;
          } else {
            console.log(`${indent}✓ Already reset: "${node.title}" (isDone=${node.isDone}, completions=${node.currentCompletions || 0})`);
          }
        }
        
        // Recurse into children
        if (node.children && node.children.length > 0) {
          resetNodes(node.children, level + 1);
        }
      });
    };
    
    resetNodes(graph.nodes);
    
    console.log('');
    console.log(`📋 Summary:`);
    console.log(`   Total repeatable infinity nodes: ${repeatableNodes.length}`);
    console.log(`   Nodes reset (isDone → false): ${resetCount}`);
    console.log(`   Already reset: ${repeatableNodes.length - resetCount}`);
    console.log('');
    
    if (repeatableNodes.length === 0) {
      console.log('⚠️  No repeatable infinity nodes found in graph');
      console.log('   Create a node with:');
      console.log('   - nodeType: "repeatable"');
      console.log('   - nodeSubtype: "infinity"');
      process.exit(0);
    }
    
    // Step 3: Save graph back to Redis
    if (resetCount > 0) {
      console.log('💾 Saving graph with reset nodes...');
      graph.version = (graph.version || 0) + 1;
      graph.lastUpdated = new Date().toISOString();
      
      await redis.set(graphKey, JSON.stringify(graph));
      console.log('✅ Graph saved to Redis');
      console.log('');
    }
    
    // Step 4: Clear daily completions
    console.log('📅 Clearing daily completions...');
    await dailyCompletions.clearCompletions(userId, graphId);
    console.log('✅ Daily completions cleared');
    console.log('');
    
    // Step 5: Instructions
    console.log('🎉 New day setup complete!');
    console.log('');
    console.log('What happened:');
    console.log('   ✅ isDone set to false for all repeatable infinity nodes');
    console.log('   ✅ currentCompletions preserved (cumulative counter)');
    console.log('   ✅ daily completions cleared in Redis');
    console.log('');
    console.log('Next steps:');
    console.log('   1. Refresh frontend (F5 or reconnect WebSocket)');
    console.log('   2. Frontend will reload graph with isDone=false');
    console.log('   3. Frontend will load empty daily completions');
    console.log('   4. Repeatable nodes ready to be completed again!');
    console.log('   5. Click on repeatable node → currentCompletions will increment');
    
  } catch (error) {
    console.error('❌ Failed to reset repeatable nodes:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await redis.disconnect();
    process.exit(0);
  }
}

resetRepeatableNodes();
