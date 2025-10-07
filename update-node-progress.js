import redis from './src/redis.js';

async function updateNodeProgress() {
  const userId = 'test-user-001';
  const graphId = 'main';
  const graphKey = `user:${userId}:graph:${graphId}`;
  
  // Получаем текущий граф
  const graphData = await redis.get(graphKey);
  if (!graphData) {
    console.error('Graph not found');
    process.exit(1);
  }
  
  const graph = JSON.parse(graphData);
  console.log(`📊 Current graph has ${graph.nodes.length} nodes`);
  
  // Находим узел Routine
  const routineNode = graph.nodes.find(n => n.id === 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30');
  if (!routineNode) {
    console.error('Routine node not found');
    process.exit(1);
  }
  
  console.log('🎯 Current Routine node:', routineNode);
  
  // Обновляем прогресс (например, делаем 5 из 10 completions)
  routineNode.currentCompletions = 5;
  routineNode.totalCompletions = 10;
  
  // Сохраняем обратно
  await redis.set(graphKey, JSON.stringify(graph));
  
  console.log('✅ Updated Routine node progress to 50% (5/10)');
  
  // Также обновим несколько других узлов для разнообразия
  const otherNodes = graph.nodes.filter(n => n.id !== 'bbc5eaea-86ab-4704-a5d6-7a23a29adc30');
  
  if (otherNodes[0]) {
    otherNodes[0].currentCompletions = 3;
    otherNodes[0].totalCompletions = 10;
    console.log(`✅ Updated ${otherNodes[0].title} progress to 30% (3/10)`);
  }
  
  if (otherNodes[1]) {
    otherNodes[1].currentCompletions = 7;
    otherNodes[1].totalCompletions = 10;
    console.log(`✅ Updated ${otherNodes[1].title} progress to 70% (7/10)`);
  }
  
  // Сохраняем финальное состояние
  await redis.set(graphKey, JSON.stringify(graph));
  
  console.log('\n📈 Progress comparison should now show:');
  console.log('   - Routine: current=50%, historical=0%, trend=+50%');
  if (otherNodes[0]) {
    console.log(`   - ${otherNodes[0].title}: current=30%, no historical data`);
  }
  if (otherNodes[1]) {
    console.log(`   - ${otherNodes[1].title}: current=70%, no historical data`);
  }
  
  process.exit(0);
}

updateNodeProgress().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});