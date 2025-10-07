import redis from './src/redis.js';

const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30';
const userId = '1';
const graphId = 'main';

async function createYesterdaySnapshot() {
  try {
    console.log(`\n📸 Creating yesterday's snapshot for node: ${nodeId}`);
    console.log('='.repeat(80));
    
    // 1. First get current node data from graph
    const graphKey = `user:${userId}:graph:${graphId}`;
    console.log(`\n📊 Getting node data from: ${graphKey}`);
    
    const graphData = await redis.get(graphKey);
    if (!graphData) {
      console.log('❌ Graph not found');
      return;
    }
    
    const graph = JSON.parse(graphData);
    const node = graph.nodes.find(n => n.id === nodeId);
    
    if (!node) {
      console.log('❌ Node not found in graph');
      return;
    }
    
    console.log(`✅ Found node: ${node.title}`);
    console.log(`   Type: ${node.nodeType}`);
    console.log(`   Subtype: ${node.nodeSubtype}`);
    console.log(`   calculatedProgress: ${node.calculatedProgress}`);
    
    // Count completed DAO children for fundamental category nodes
    let completedCount = 0;
    let totalDaoChildren = 0;
    
    if (node.nodeType === 'fundamental' && node.nodeSubtype === 'category' && node.children) {
      node.children.forEach(child => {
        if (child.nodeType === 'dao') {
          totalDaoChildren++;
          if (child.isDone) {
            completedCount++;
          }
        }
      });
      console.log(`   DAO children: ${completedCount}/${totalDaoChildren} completed`);
    }
    
    // 2. Create snapshot for yesterday midnight
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMilliseconds(0);
    
    const snapshotData = {
      nodeId: nodeId,
      progress: Math.round((node.calculatedProgress || 0) * 100),  // Convert to percentage
      calculatedProgress: node.calculatedProgress || 0,  // Store raw value too
      completions: completedCount,
      total: totalDaoChildren,
      isDone: node.isDone,
      nodeType: node.nodeType,
      nodeSubtype: node.nodeSubtype,
      title: node.title,
      metadata: {
        userId: userId,
        graphId: graphId,
        capturedAt: yesterday.toISOString(),
        source: 'manual_recreation'
      }
    };
    
    console.log(`\n📅 Creating snapshot for: ${yesterday.toISOString()}`);
    console.log('Snapshot data:', JSON.stringify(snapshotData, null, 2));
    
    // 3. Store snapshot using sorted set
    const snapshotKey = `progress:daily:${nodeId}`;
    const score = yesterday.getTime();
    
    // Remove any existing snapshot for yesterday (if exists)
    const existingSnapshots = await redis.zrangebyscore(snapshotKey, score, score);
    if (existingSnapshots.length > 0) {
      console.log(`\n⚠️ Removing existing snapshot for yesterday`);
      await redis.zremrangebyscore(snapshotKey, score, score);
    }
    
    // Add new snapshot
    await redis.zadd(snapshotKey, score, JSON.stringify(snapshotData));
    console.log(`\n✅ Snapshot created with score: ${score}`);
    
    // 4. Verify snapshot was saved
    console.log('\n🔍 Verifying snapshot was saved:');
    const savedSnapshots = await redis.zrangebyscore(snapshotKey, score, score, 'WITHSCORES');
    
    if (savedSnapshots.length > 0) {
      const savedData = JSON.parse(savedSnapshots[0]);
      const savedScore = parseInt(savedSnapshots[1]);
      const savedDate = new Date(savedScore);
      
      console.log(`✅ Snapshot verified:`);
      console.log(`   Date: ${savedDate.toISOString()}`);
      console.log(`   Progress: ${savedData.progress}%`);
      console.log(`   Calculated Progress: ${savedData.calculatedProgress}`);
    } else {
      console.log('❌ Failed to verify snapshot');
    }
    
    // 5. Also try alternative snapshot storage format (hash by date)
    const dateKey = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    const hashKey = `graph:${graphId}:progress:snapshot:${dateKey}`;
    
    console.log(`\n📁 Also storing in hash format: ${hashKey}`);
    
    const hashData = {
      progress: Math.round((node.calculatedProgress || 0) * 100),
      calculatedProgress: node.calculatedProgress || 0,
      isDone: node.isDone,
      currentCompletions: completedCount,
      requiredCompletions: totalDaoChildren || 1,
      nodeType: node.nodeType,
      nodeSubtype: node.nodeSubtype,
      timestamp: yesterday.toISOString()
    };
    
    await redis.hset(hashKey, nodeId, JSON.stringify(hashData));
    console.log(`✅ Stored in hash format`);
    
    // Verify hash storage
    const hashValue = await redis.hget(hashKey, nodeId);
    if (hashValue) {
      const parsed = JSON.parse(hashValue);
      console.log(`✅ Hash storage verified, progress: ${parsed.progress}%`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Yesterday\'s snapshot created successfully!');
    
  } catch (error) {
    console.error('❌ Error creating snapshot:', error);
  } finally {
    redis.quit();
  }
}

createYesterdaySnapshot();