# Исправление проблемы с иерархией при WebSocket операциях

## Проблема
При использовании WebSocket операций (создание нод в реальном времени) иерархия parent-child сохраняется корректно в Redis на сервере, но при загрузке этих данных на клиенте происходит "сплющивание" структуры - все ноды становятся корневыми.

## Причина
1. Сервер правильно сохраняет иерархическую структуру в Redis (строки 170-192 в `simple-server.js`)
2. При отправке `GRAPH_STATE` сервер отправляет правильную иерархическую структуру
3. Но клиент в обработчике `handleGraphState` неправильно обрабатывает эту структуру

## Текущий поток данных

### При сохранении через WebSocket:
1. Клиент создает ноду с `parentId`
2. Сервер правильно добавляет ноду как child в `applyOperation`
3. Сервер сохраняет иерархию в Redis
4. Сервер отправляет операцию всем клиентам

### При загрузке (проблема здесь):
1. Клиент подключается и запрашивает `SUBSCRIBE`
2. Сервер отправляет `GRAPH_STATE` с иерархической структурой
3. Клиент в `handleGraphState` вызывает `setRootNodes(graphState.nodes)`
4. `setRootNodes` обрабатывает весь массив как корневые ноды

## Решение

### Вариант 1: Исправить на клиенте
Обновить обработчик `handleGraphState` чтобы он правильно обрабатывал иерархию:

```javascript
const handleGraphState = (graphState) => {
  console.log('📊 TreeDaoStore: Loading initial graph state', graphState);
  if (graphState && graphState.nodes) {
    // graphState.nodes уже содержит правильную иерархическую структуру
    // с children внутри каждой ноды
    self.setRootNodes(graphState.nodes);
    
    if (graphState.edges) {
      self.setAllEdges(graphState.edges);
    }
    console.log('  ✅ Graph state loaded successfully');
  }
};
```

### Вариант 2: Валидация на сервере
Убедиться что сервер всегда отправляет правильную структуру:

```javascript
// В simple-server.js, при отправке GRAPH_STATE
const graph = await getGraph(data.graphId);

// Логирование для отладки
console.log('Graph structure check:');
graph.nodes.forEach((node, i) => {
  console.log(`  Node ${i}: ${node.title}, children: ${node.children?.length || 0}`);
});

ws.send(JSON.stringify({
  type: 'GRAPH_STATE',
  payload: graph
}));
```

## Проверка решения

1. Очистить Redis:
```bash
docker exec -it optimistic-redis redis-cli FLUSHALL
```

2. Перезапустить сервер:
```bash
docker-compose restart optimistic-backend
```

3. Создать структуру:
   - Создать корневую ноду
   - Навигироваться в неё
   - Создать дочернюю ноду
   - Обновить страницу

4. Проверить что иерархия сохранилась

## Дополнительная отладка

Добавить логирование в `setRootNodes`:

```javascript
setRootNodes(nodes) {
  console.log('TreeDaoStore.setRootNodes called with:', nodes);
  console.log('First node structure:', JSON.stringify(nodes[0], null, 2));
  
  // Проверить что это действительно только корневые ноды
  const allNodeIds = new Set();
  const childNodeIds = new Set();
  
  const collectIds = (nodeArray) => {
    nodeArray.forEach(node => {
      allNodeIds.add(node.id);
      if (node.children && node.children.length > 0) {
        node.children.forEach(child => childNodeIds.add(child.id));
        collectIds(node.children);
      }
    });
  };
  
  collectIds(nodes);
  console.log(`Total nodes: ${allNodeIds.size}, Child nodes: ${childNodeIds.size}`);
  console.log(`Root nodes: ${allNodeIds.size - childNodeIds.size}`);
  
  // Остальной код...
}
```

## Финальное решение

Проблема в том, что `setRootNodes` корректно обрабатывает иерархическую структуру, но нужно убедиться что сервер отправляет именно иерархическую структуру, а не плоский массив всех нод.

В Redis данные хранятся правильно (с children), поэтому проблема только в том, как эти данные интерпретируются при загрузке.