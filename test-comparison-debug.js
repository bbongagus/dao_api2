import fetch from 'node-fetch';
import redis from './src/redis.js';

async function testComparison() {
  const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30';
  const userId = 'test-user-001';
  const graphId = 'main';
  
  console.log('🔍 Checking current state and snapshots...\n');
  
  // 1. Проверяем текущее состояние узла
  const graphKey = `user:${userId}:graph:${graphId}`;
  const graphData = await redis.get(graphKey);
  if (graphData) {
    const graph = JSON.parse(graphData);
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node) {
      const currentProgress = node.totalCompletions > 0 
        ? Math.round((node.currentCompletions / node.totalCompletions) * 100)
        : 0;
      console.log(`📊 Current node state:`);
      console.log(`   Title: ${node.title}`);
      console.log(`   Completions: ${node.currentCompletions}/${node.totalCompletions}`);
      console.log(`   Progress: ${currentProgress}%`);
    }
  }
  
  // 2. Проверяем снимки
  const snapshotKey = `progress:daily:${nodeId}`;
  const snapshots = await redis.zrange(snapshotKey, 0, -1, 'WITHSCORES');
  console.log(`\n📸 Snapshots (${snapshots.length / 2} total):`);
  
  for (let i = 0; i < snapshots.length; i += 2) {
    const data = JSON.parse(snapshots[i]);
    const timestamp = parseInt(snapshots[i + 1]);
    const date = new Date(timestamp);
    console.log(`   - ${date.toISOString()}: progress=${data.progress}%`);
  }
  
  // 3. Тестируем API endpoint
  console.log('\n🌐 Testing API endpoint...');
  
  for (const period of ['today', '7d', '30d']) {
    const url = `http://localhost:3001/api/analytics/progress-comparison?nodeIds=${nodeId}&period=${period}`;
    
    const response = await fetch(url, {
      headers: {
        'x-user-id': userId,
        'x-graph-id': graphId
      }
    });
    
    const data = await response.json();
    
    console.log(`\n📊 Period: ${period}`);
    
    if (data.comparisons && data.comparisons[0]) {
      const comp = data.comparisons[0];
      console.log(`   Current: ${comp.current}%`);
      console.log(`   Historical: ${comp.historical}%`);
      console.log(`   Trend: ${comp.trend > 0 ? '+' : ''}${comp.trend}%`);
      console.log(`   Has Historical Data: ${comp.hasHistoricalData}`);
      
      if (!comp.hasHistoricalData) {
        console.log(`   ⚠️ No historical data for ${period}`);
      } else if (comp.trend === 0 && comp.current !== comp.historical) {
        console.log(`   ❌ Trend calculation error: current=${comp.current}, historical=${comp.historical}, but trend=0`);
      }
    }
  }
  
  console.log('\n✅ Test complete');
  process.exit(0);
}

testComparison().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});