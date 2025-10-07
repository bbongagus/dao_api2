import redis from './src/redis.js';

async function checkNodeProgress() {
  const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30';
  
  console.log('🔍 Checking progress for node:', nodeId);
  console.log('=' .repeat(60));
  
  // 1. Проверяем разные возможные userId
  const possibleUserIds = ['1', 'user-1', 'test-user-001'];
  const graphId = 'main';
  
  for (const userId of possibleUserIds) {
    const graphKey = `user:${userId}:graph:${graphId}`;
    console.log(`\n📊 Checking graph key: ${graphKey}`);
    
    const graphData = await redis.get(graphKey);
    if (graphData) {
      const graph = JSON.parse(graphData);
      console.log(`  ✅ Found graph with ${graph.nodes.length} nodes`);
      
      // Ищем нашу ноду
      const node = graph.nodes.find(n => n.id === nodeId);
      if (node) {
        console.log(`  🎯 Found node: ${node.title}`);
        console.log(`     Type: ${node.nodeType}`);
        console.log(`     Subtype: ${node.nodeSubtype || 'not set'}`);
        console.log(`     isDone: ${node.isDone}`);
        console.log(`     currentCompletions: ${node.currentCompletions}`);
        console.log(`     totalCompletions: ${node.totalCompletions}`);
        console.log(`     requiredCompletions: ${node.requiredCompletions}`);
        
        // Вычисляем прогресс
        let progress = 0;
        if (node.nodeType === 'fundamental') {
          // Для fundamental нод прогресс может считаться по-разному
          if (node.children && node.children.length > 0) {
            // Если есть дети, считаем по ним
            const completedChildren = node.children.filter(c => c.isDone).length;
            progress = Math.round((completedChildren / node.children.length) * 100);
            console.log(`     Progress (from children): ${progress}% (${completedChildren}/${node.children.length})`);
          } else if (node.linkedNodeIds) {
            // Если есть связанные ноды
            console.log(`     LinkedNodeIds:`, node.linkedNodeIds);
          } else if (node.totalCompletions && node.totalCompletions > 0) {
            // Если есть totalCompletions (как у DAO нод)
            progress = Math.round((node.currentCompletions / node.totalCompletions) * 100);
            console.log(`     Progress (from completions): ${progress}%`);
          } else {
            // Иначе используем isDone
            progress = node.isDone ? 100 : 0;
            console.log(`     Progress (from isDone): ${progress}%`);
          }
        } else {
          // Для DAO нод
          if (node.totalCompletions && node.totalCompletions > 0) {
            progress = Math.round((node.currentCompletions / node.totalCompletions) * 100);
            console.log(`     Progress: ${progress}%`);
          }
        }
        
        console.log(`\n  📈 CALCULATED PROGRESS: ${progress}%`);
        
        // Если это правильный пользователь, покажем всю структуру ноды
        if (userId === '1') {
          console.log('\n  📋 Full node structure:');
          console.log(JSON.stringify(node, null, 2));
        }
      } else {
        console.log(`  ❌ Node ${nodeId} not found in this graph`);
      }
    } else {
      console.log(`  ⚠️ Graph not found`);
    }
  }
  
  // 2. Проверяем снимки прогресса
  console.log('\n' + '=' .repeat(60));
  console.log('📸 Checking progress snapshots for node:', nodeId);
  
  const snapshotKey = `progress:daily:${nodeId}`;
  const snapshots = await redis.zrange(snapshotKey, 0, -1, 'WITHSCORES');
  
  if (snapshots.length > 0) {
    console.log(`Found ${snapshots.length / 2} snapshots:`);
    for (let i = 0; i < snapshots.length; i += 2) {
      const data = JSON.parse(snapshots[i]);
      const timestamp = parseInt(snapshots[i + 1]);
      const date = new Date(timestamp);
      console.log(`  - ${date.toISOString()}: progress=${data.progress}%`);
    }
  } else {
    console.log('No snapshots found');
  }
  
  // 3. Проверяем, как сохраняется прогресс при снимке
  console.log('\n' + '=' .repeat(60));
  console.log('🧪 Testing snapshot creation...');
  
  // Эмулируем создание снимка с текущим прогрессом 50%
  const testSnapshot = {
    nodeId: nodeId,
    timestamp: Date.now(),
    progress: 50,  // Frontend говорит что 50%
    completions: 5,
    total: 10,
    metadata: {
      userId: '1',
      graphId: 'main',
      nodeTitle: 'Routine',
      capturedAt: new Date().toISOString(),
      test: true
    }
  };
  
  console.log('Creating test snapshot with 50% progress...');
  await redis.zadd(snapshotKey + ':test', Date.now(), JSON.stringify(testSnapshot));
  
  // Проверяем что сохранилось
  const testSnapshots = await redis.zrange(snapshotKey + ':test', -1, -1);
  if (testSnapshots.length > 0) {
    const saved = JSON.parse(testSnapshots[0]);
    console.log('✅ Test snapshot saved:', saved);
    
    // Удаляем тестовый снимок
    await redis.del(snapshotKey + ':test');
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('✅ Check complete');
  
  process.exit(0);
}

checkNodeProgress().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});