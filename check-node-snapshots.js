import redis from './src/redis.js';

const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30';
const userId = '1';
const graphId = 'main';

async function checkNodeSnapshots() {
  try {
    console.log(`\n📊 Checking snapshots for node: ${nodeId}`);
    console.log('='.repeat(80));
    
    // 1. First check if the node exists in the graph
    const graphKey = `user:${userId}:graph:${graphId}`;
    console.log(`\n📈 Checking graph: ${graphKey}`);
    
    const graphData = await redis.get(graphKey);
    if (graphData) {
      const graph = JSON.parse(graphData);
      const node = graph.nodes.find(n => n.id === nodeId);
      
      if (node) {
        console.log(`✅ Found node: ${node.title}`);
        console.log(`   Type: ${node.nodeType}`);
        console.log(`   Subtype: ${node.nodeSubtype || 'not set'}`);
        console.log(`   calculatedProgress: ${node.calculatedProgress || 0}`);
        console.log(`   isDone: ${node.isDone}`);
        console.log(`   Children count: ${node.children?.length || 0}`);
        
        // Show details of each child
        if (node.children && node.children.length > 0) {
          console.log('\n👶 Children:');
          node.children.forEach((child, idx) => {
            console.log(`\n  ${idx + 1}. ${child.title} (${child.id.substring(0, 8)}...)`);
            console.log(`     Type: ${child.nodeType}`);
            console.log(`     Subtype: ${child.nodeSubtype || 'simple'}`);
            console.log(`     isDone: ${child.isDone}`);
            console.log(`     calculatedProgress: ${child.calculatedProgress || 0}`);
            
            // Show linkedNodeIds if it's a Fundamental node
            if ('1'==='1') {
              console.log(`     linkedNodeIds:`);
              
              // Handle both Map and plain object
              if (child.linkedNodeIds instanceof Map || child.linkedNodeIds.get) {
                const downstream = child.linkedNodeIds.get?.('downstream') || [];
                const upstream = child.linkedNodeIds.get?.('upstream') || [];
                if (downstream.length > 0) {
                  console.log(`       downstream: [${downstream.length} nodes]`);
                  downstream.forEach(id => console.log(`         - ${id.substring(0, 8)}...`));
                }
                if (upstream.length > 0) {
                  console.log(`       upstream: [${upstream.length} nodes]`);
                  upstream.forEach(id => console.log(`         - ${id.substring(0, 8)}...`));
                }
              } else {
                // Plain object
                if (child.linkedNodeIds.downstream?.length > 0) {
                  console.log(`       downstream: [${child.linkedNodeIds.downstream.length} nodes]`);
                  child.linkedNodeIds.downstream.forEach(id => console.log(`         - ${id.substring(0, 8)}...`));
                }
                if (child.linkedNodeIds.upstream?.length > 0) {
                  console.log(`       upstream: [${child.linkedNodeIds.upstream.length} nodes]`);
                  child.linkedNodeIds.upstream.forEach(id => console.log(`         - ${id.substring(0, 8)}...`));
                }
              }
            }
          });
        }
      } else {
        console.log(`❌ Node not found in graph`);
      }
    } else {
      console.log(`❌ Graph not found`);
    }
    
    // 2. Check daily progress snapshots using zrange
    console.log('\n📸 Checking daily progress snapshots:');
    console.log('-'.repeat(60));
    
    const snapshotKey = `progress:daily:${nodeId}`;
    const snapshots = await redis.zrange(snapshotKey, 0, -1, 'WITHSCORES');
    
    if (snapshots.length > 0) {
      console.log(`Found ${snapshots.length / 2} snapshots:\n`);
      
      const snapshotList = [];
      for (let i = 0; i < snapshots.length; i += 2) {
        const data = JSON.parse(snapshots[i]);
        const timestamp = parseInt(snapshots[i + 1]);
        const date = new Date(timestamp);
        
        snapshotList.push({
          date,
          timestamp,
          data
        });
        
        console.log(`📅 ${date.toISOString()}`);
        console.log(`   Progress: ${data.progress}%`);
        if (data.completions !== undefined) {
          console.log(`   Completions: ${data.completions}/${data.total || data.requiredCompletions || 1}`);
        }
        if (data.metadata) {
          console.log(`   Metadata:`, data.metadata);
        }
        console.log();
      }
      
      // Check for yesterday's snapshot
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayStart = yesterday.getTime();
      const yesterdayEnd = yesterdayStart + 24 * 60 * 60 * 1000;
      
      console.log('\n🔍 Looking for yesterday\'s snapshot:');
      console.log(`   Yesterday range: ${new Date(yesterdayStart).toISOString()} - ${new Date(yesterdayEnd).toISOString()}`);
      
      const yesterdaySnapshot = snapshotList.find(s => 
        s.timestamp >= yesterdayStart && s.timestamp < yesterdayEnd
      );
      
      if (yesterdaySnapshot) {
        console.log(`✅ Found yesterday's snapshot:`);
        console.log(JSON.stringify(yesterdaySnapshot.data, null, 2));
      } else {
        console.log(`❌ No snapshot found for yesterday`);
        
        // Show the most recent snapshot
        if (snapshotList.length > 0) {
          const mostRecent = snapshotList[snapshotList.length - 1];
          console.log(`\n📌 Most recent snapshot is from ${mostRecent.date.toISOString()}:`);
          console.log(JSON.stringify(mostRecent.data, null, 2));
        }
      }
    } else {
      console.log('❌ No snapshots found for this node');
      
      // Try alternative key patterns
      console.log('\n🔍 Trying alternative snapshot key patterns:');
      
      // Pattern 1: graph:graphId:progress:snapshot:date
      const pattern1 = `graph:${graphId}:progress:snapshot:*`;
      const keys1 = await redis.keys(pattern1);
      if (keys1.length > 0) {
        console.log(`Found ${keys1.length} snapshot keys with pattern: ${pattern1}`);
        for (const key of keys1.slice(-3)) {  // Show last 3
          const snapshot = await redis.hget(key, nodeId);
          if (snapshot) {
            const date = key.split(':').pop();
            console.log(`  - ${date}: ${snapshot.substring(0, 100)}...`);
          }
        }
      }
      
      // Pattern 2: user:userId:graph:graphId:snapshot:date
      const pattern2 = `user:${userId}:graph:${graphId}:snapshot:*`;
      const keys2 = await redis.keys(pattern2);
      if (keys2.length > 0) {
        console.log(`Found ${keys2.length} snapshot keys with pattern: ${pattern2}`);
      }
    }
    
    // 3. Check if snapshot worker is creating snapshots correctly
    console.log('\n🔧 Checking snapshot creation mechanism:');
    console.log('-'.repeat(60));
    
    // Get queue metrics
    const queueKey = 'bull:snapshot-queue';
    const completedCount = await redis.zcard(`${queueKey}:completed`);
    const failedCount = await redis.zcard(`${queueKey}:failed`);
    
    console.log(`Snapshot queue stats:`);
    console.log(`  - Completed jobs: ${completedCount}`);
    console.log(`  - Failed jobs: ${failedCount}`);
    
    // Check last failed job if any
    if (failedCount > 0) {
      const lastFailed = await redis.zrange(`${queueKey}:failed`, -1, -1);
      if (lastFailed.length > 0) {
        console.log(`\n⚠️ Last failed snapshot job:`, lastFailed[0].substring(0, 200));
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking snapshots:', error);
  } finally {
    redis.quit();
  }
}

checkNodeSnapshots();