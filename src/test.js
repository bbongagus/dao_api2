/**
 * Простой тест для проверки работы Optimistic UI
 */

import { optimisticAPI } from '../client/optimisticApi.js';

async function runTests() {
  console.log('🧪 Starting Optimistic UI tests...\n');
  
  try {
    // 1. Подключаемся к WebSocket
    console.log('1. Connecting to WebSocket...');
    await optimisticAPI.connect();
    console.log('✅ Connected\n');
    
    // 2. Загружаем граф
    console.log('2. Loading graph...');
    const graph = await optimisticAPI.loadGraph();
    console.log(`✅ Graph loaded: ${graph.nodes?.length || 0} nodes, ${graph.edges?.length || 0} edges\n`);
    
    // 3. Добавляем новый узел (optimistic)
    console.log('3. Adding new node (optimistic)...');
    const newNode = await optimisticAPI.addNode({
      title: 'Test Node',
      position: { x: 100, y: 100 },
      nodeType: 'dao',
      isDone: false
    });
    console.log(`✅ Node added: ${newNode.id || newNode.nodeId}\n`);
    
    // Ждем подтверждения от сервера
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. Обновляем позицию узла
    if (newNode.id || newNode.nodeId) {
      console.log('4. Updating node position...');
      await optimisticAPI.updateNodePosition(
        newNode.id || newNode.nodeId,
        { x: 200, y: 200 }
      );
      console.log('✅ Position updated\n');
    }
    
    // 5. Добавляем еще один узел
    console.log('5. Adding second node...');
    const secondNode = await optimisticAPI.addNode({
      title: 'Second Test Node',
      position: { x: 300, y: 100 },
      nodeType: 'fundamental',
      isDone: false
    });
    console.log(`✅ Second node added: ${secondNode.id || secondNode.nodeId}\n`);
    
    // Ждем подтверждения
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 6. Создаем связь между узлами
    if ((newNode.id || newNode.nodeId) && (secondNode.id || secondNode.nodeId)) {
      console.log('6. Creating edge between nodes...');
      const edge = await optimisticAPI.addEdge({
        source: newNode.id || newNode.nodeId,
        target: secondNode.id || secondNode.nodeId,
        type: 'floating'
      });
      console.log(`✅ Edge created: ${edge.id || edge.edgeId}\n`);
      
      // Ждем подтверждения
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 7. Загружаем обновленный граф
    console.log('7. Loading updated graph...');
    const updatedGraph = await optimisticAPI.loadGraph();
    console.log(`✅ Updated graph: ${updatedGraph.nodes?.length || 0} nodes, ${updatedGraph.edges?.length || 0} edges\n`);
    
    // 8. Тестируем batch update
    console.log('8. Testing batch update...');
    await optimisticAPI.batchUpdate({
      nodes: [
        {
          id: newNode.id || newNode.nodeId,
          title: 'Updated Title'
        }
      ]
    });
    console.log('✅ Batch update sent\n');
    
    // Ждем обработки
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Отключаемся
    console.log('\nDisconnecting...');
    optimisticAPI.disconnect();
    process.exit(0);
  }
}

// Обработчики для WebSocket сообщений
optimisticAPI.onUpdate = (message) => {
  console.log('📨 Update from server:', message.type);
};

optimisticAPI.onError = (error) => {
  console.error('❌ Error from server:', error);
};

// Запуск тестов
console.log('========================================');
console.log('  Optimistic UI Backend Test Suite');
console.log('========================================\n');

runTests();