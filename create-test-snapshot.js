import redis from './src/redis.js';

async function createTestSnapshot() {
  const userId = 'test-user-001';
  const graphId = 'main';
  const nodeId = 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30'; // Routine node
  
  // Вчерашняя дата
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate());
  yesterday.setHours(0, 0, 0, 0);
  const timestamp = yesterday.getTime();
  
  // Создаём снимок с прогрессом 0
  const snapshotData = {
    nodeId,
    timestamp,
    progress: 0,
    completions: 0,
    total: 1, // предполагаем 10 total completions
    metadata: {
      userId,
      graphId,
      capturedAt: yesterday.toISOString()
    }
  };
  
  const key = `progress:daily:${nodeId}`;
  
  console.log(`📸 Creating snapshot for ${nodeId} at ${yesterday.toISOString()}`);
  console.log(`   Key: ${key}`);
  console.log(`   Data:`, snapshotData);
  
  // Сохраняем в Redis sorted set
  await redis.zadd(key, timestamp, JSON.stringify(snapshotData));
  
  // Проверяем что сохранилось
  const snapshots = await redis.zrange(key, 0, -1, 'WITHSCORES');
  console.log(`✅ Snapshot created. Total snapshots for this node: ${snapshots.length / 2}`);
  
  // Показываем все снимки
  for (let i = 0; i < snapshots.length; i += 2) {
    const data = JSON.parse(snapshots[i]);
    const score = snapshots[i + 1];
    const date = new Date(parseInt(score));
    console.log(`   - ${date.toISOString()}: progress=${data.progress}%`);
  }
  
  process.exit(0);
}

createTestSnapshot().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});