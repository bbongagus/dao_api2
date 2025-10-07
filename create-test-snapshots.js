import redis from './src/redis.js';

const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30';
const userId = '1';
const graphId = 'main';

async function createTestSnapshots() {
  try {
    console.log(`\n📸 Creating test snapshots for node: ${nodeId}`);
    console.log('='.repeat(80));
    
    // 1. Get current node data
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
    console.log(`   Current calculatedProgress: ${node.calculatedProgress}`);
    console.log(`   Current progress: ${Math.round((node.calculatedProgress || 0) * 100)}%`);
    
    // 2. Create snapshots for multiple periods
    const periods = [
      { days: 1, label: 'Yesterday (for "today" period)' },
      { days: 7, label: '7 days ago (for "7d" period)' },
      { days: 30, label: '30 days ago (for "30d" period)' }
    ];
    
    const snapshotKey = `progress:daily:${nodeId}`;
    
    for (const period of periods) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📅 Creating snapshot for ${period.label}`);
      
      const snapshotDate = new Date();
      snapshotDate.setDate(snapshotDate.getDate() - period.days);
      snapshotDate.setHours(0, 0, 0, 0);
      snapshotDate.setMilliseconds(0);
      
      // Historical progress should be less than current
      // Let's use: 0% for 30d, 20% for 7d, 40% for yesterday
      const historicalProgress = period.days === 30 ? 0 :
                                 period.days === 7 ? 20 :
                                 40; // yesterday
      
      const snapshotData = {
        progress: historicalProgress,
        completions: 0,
        total: 0,
        timestamp: snapshotDate.toISOString(),
        date: getDateKey(snapshotDate)
      };
      
      const score = snapshotDate.getTime();
      
      // Remove existing snapshot for this date
      await redis.zremrangebyscore(snapshotKey, score, score);
      
      // Add new snapshot
      await redis.zadd(snapshotKey, score, JSON.stringify(snapshotData));
      
      console.log(`✅ Created snapshot:`);
      console.log(`   Date: ${snapshotDate.toISOString()}`);
      console.log(`   Progress: ${historicalProgress}%`);
      console.log(`   Score: ${score}`);
      
      // Verify
      const saved = await redis.zrangebyscore(snapshotKey, score, score);
      if (saved.length > 0) {
        const verified = JSON.parse(saved[0]);
        console.log(`✅ Verified: progress = ${verified.progress}%`);
      }
    }
    
    // 3. List all snapshots for this node
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 All snapshots for node ${nodeId}:`);
    
    const allSnapshots = await redis.zrange(snapshotKey, 0, -1, 'WITHSCORES');
    for (let i = 0; i < allSnapshots.length; i += 2) {
      const data = JSON.parse(allSnapshots[i]);
      const score = parseInt(allSnapshots[i + 1]);
      const date = new Date(score);
      console.log(`   ${date.toISOString()}: ${data.progress}%`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Test snapshots created successfully!');
    console.log('\nNow test on frontend with different periods:');
    console.log('  - "today" should compare with yesterday (40% → 50% = +10% trend)');
    console.log('  - "7d" should compare with 7 days ago (20% → 50% = +30% trend)');
    console.log('  - "30d" should compare with 30 days ago (0% → 50% = +50% trend)');
    
  } catch (error) {
    console.error('❌ Error creating snapshots:', error);
  } finally {
    redis.quit();
  }
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

createTestSnapshots();