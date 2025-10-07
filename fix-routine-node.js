import redis from './src/redis.js';

async function fixRoutineNode() {
  const userId = 'test-user-001';
  const graphId = 'main';
  const graphKey = `user:${userId}:graph:${graphId}`;
  const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30';
  
  // Получаем граф
  const graphData = await redis.get(graphKey);
  if (!graphData) {
    console.error('Graph not found');
    process.exit(1);
  }
  
  const graph = JSON.parse(graphData);
  const node = graph.nodes.find(n => n.id === nodeId);
  
  if (!node) {
    console.error('Routine node not found');
    process.exit(1);
  }
  
  console.log('📊 Current Routine node state:', {
    title: node.title,
    currentCompletions: node.currentCompletions,
    totalCompletions: node.totalCompletions,
    isDone: node.isDone
  });
  
  // Устанавливаем правильные значения для fundamental узла
  // Например, делаем его выполненным на 30% (3 из 10)
  node.currentCompletions = 3;
  node.totalCompletions = 10;
  
  console.log('\n✅ Updated Routine node to:', {
    currentCompletions: node.currentCompletions,
    totalCompletions: node.totalCompletions,
    progress: '30%'
  });
  
  // Сохраняем обратно
  await redis.set(graphKey, JSON.stringify(graph));
  
  // Теперь очистим неправильные снимки и создадим правильные
  const snapshotKey = `progress:daily:${nodeId}`;
  
  console.log('\n🧹 Clearing invalid snapshots...');
  await redis.del(snapshotKey);
  
  // Создаём снимки за последние дни с разным прогрессом
  const now = new Date();
  const snapshots = [
    { daysAgo: 30, progress: 0 },   // 30 дней назад - 0%
    { daysAgo: 7, progress: 10 },   // 7 дней назад - 10%
    { daysAgo: 3, progress: 15 },   // 3 дня назад - 15%
    { daysAgo: 1, progress: 20 },   // вчера - 20%
  ];
  
  for (const { daysAgo, progress } of snapshots) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);
    
    const snapshot = {
      nodeId,
      timestamp: date.getTime(),
      progress,
      completions: Math.round(progress / 10),
      total: 10,
      metadata: {
        userId,
        graphId,
        capturedAt: date.toISOString()
      }
    };
    
    await redis.zadd(snapshotKey, date.getTime(), JSON.stringify(snapshot));
    console.log(`📸 Created snapshot for ${date.toISOString().split('T')[0]}: ${progress}%`);
  }
  
  console.log('\n✅ Node fixed and snapshots created!');
  console.log('\n📈 Expected trends:');
  console.log('   - today: +10% (30% current vs 20% yesterday)');
  console.log('   - 7d: +20% (30% current vs 10% a week ago)');
  console.log('   - 30d: +30% (30% current vs 0% a month ago)');
  
  process.exit(0);
}

fixRoutineNode().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});