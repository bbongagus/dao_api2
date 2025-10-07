# TreeDao Progress & Analytics Architecture (Simplified MVP)

## Система расчета прогресса

### Типы нод (Node Types)

#### 1. **DAO Nodes** (`nodeType: "dao"`)
Основные рабочие узлы, представляющие конкретные задачи или действия.

**Подтипы:**
- `simple` - простая нода без детей
- `withChildren` - нода с дочерними элементами

**Характеристики:**
- Имеют состояние `isDone` (выполнено/не выполнено)
- Поддерживают многократное выполнение через `requiredCompletions` и `currentCompletions`
- Прогресс для simple: `isDone ? 1 : 0`
- Прогресс для withChildren: среднее арифметическое прогресса всех DAO-детей
- При многократном выполнении: `currentCompletions / requiredCompletions`

#### 2. **Fundamental Nodes** (`nodeType: "fundamental"`)
Концептуальные узлы для группировки и организации DAO нод.

**Подтипы:**
- `category` - группировка по категории (считает детей)
- `upstream` - агрегация входящих потоков
- `downstream` - агрегация исходящих потоков
- `simple` - простая fundamental нода

**Характеристики:**
- Прогресс всегда рассчитывается автоматически
- `category`: среднее арифметическое прогресса DAO-детей
- `upstream`: среднее прогресса всех upstream-связанных DAO нод
- `downstream`: среднее прогресса всех downstream-связанных DAO нод
- Игнорируют собственное состояние `isDone` для расчета прогресса

### Полный алгоритм расчета прогресса

```javascript
// Полный алгоритм с учетом всех типов
function calculateProgress(node, graph) {
  // 1. Простые DAO ноды
  if (node.type === 'dao' && node.subtype === 'simple') {
    if (node.requiredCompletions > 1) {
      return node.currentCompletions / node.requiredCompletions;
    }
    return node.isDone ? 1 : 0;
  }
  
  // 2. DAO с детьми
  if (node.type === 'dao' && node.subtype === 'withChildren') {
    const daoChildren = node.children.filter(child => child.type === 'dao');
    if (daoChildren.length === 0) return node.isDone ? 1 : 0;
    
    const childProgresses = daoChildren.map(child => calculateProgress(child, graph));
    return childProgresses.reduce((sum, p) => sum + p, 0) / childProgresses.length;
  }
  
  // 3. Fundamental категория
  if (node.type === 'fundamental' && node.subtype === 'category') {
    const daoChildren = node.children.filter(child => child.type === 'dao');
    if (daoChildren.length === 0) return 0;
    
    const childProgresses = daoChildren.map(child => calculateProgress(child, graph));
    return childProgresses.reduce((sum, p) => sum + p, 0) / childProgresses.length;
  }
  
  // 4. Fundamental upstream - собирает все ноды, текущие В эту ноду
  if (node.type === 'fundamental' && node.subtype === 'upstream') {
    const upstreamNodes = [];
    const visited = new Set();
    
    // Рекурсивно собираем все upstream DAO ноды
    function collectUpstream(currentNode) {
      const upstreamIds = currentNode.linkedNodeIds?.upstream || [];
      
      for (const nodeId of upstreamIds) {
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        
        const upstreamNode = graph.findNode(nodeId);
        if (!upstreamNode) continue;
        
        if (upstreamNode.type === 'dao') {
          upstreamNodes.push(upstreamNode);
          collectUpstream(upstreamNode); // Продолжаем вверх по цепочке
        } else if (upstreamNode.type === 'fundamental') {
          // Fundamental ноды пропускаем, но продолжаем через них
          collectUpstream(upstreamNode);
        }
      }
    }
    
    collectUpstream(node);
    
    if (upstreamNodes.length === 0) return 0;
    
    const progresses = upstreamNodes.map(n => calculateProgress(n, graph));
    return progresses.reduce((sum, p) => sum + p, 0) / progresses.length;
  }
  
  // 5. Fundamental downstream - собирает все ноды, текущие ИЗ этой ноды
  if (node.type === 'fundamental' && node.subtype === 'downstream') {
    const downstreamNodes = [];
    const visited = new Set();
    
    // Рекурсивно собираем все downstream DAO ноды
    function collectDownstream(currentNode) {
      const downstreamIds = currentNode.linkedNodeIds?.downstream || [];
      
      for (const nodeId of downstreamIds) {
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        
        const downstreamNode = graph.findNode(nodeId);
        if (!downstreamNode) continue;
        
        if (downstreamNode.type === 'dao') {
          downstreamNodes.push(downstreamNode);
          collectDownstream(downstreamNode); // Продолжаем вниз по цепочке
        } else if (downstreamNode.type === 'fundamental') {
          // Fundamental ноды пропускаем, но продолжаем через них
          collectDownstream(downstreamNode);
        }
      }
    }
    
    collectDownstream(node);
    
    if (downstreamNodes.length === 0) return 0;
    
    const progresses = downstreamNodes.map(n => calculateProgress(n, graph));
    return progresses.reduce((sum, p) => sum + p, 0) / progresses.length;
  }
  
  // По умолчанию
  return 0;
}
```

## Упрощенная MVP архитектура

### 1. Хранение всех событий в Redis

```javascript
// Redis структура - все храним в Redis без усложнений
redis = {
  // Все события пользователя (Sorted Set по timestamp)
  'events:{userId}:{graphId}': SortedSet([
    { score: timestamp, value: JSON.stringify(event) }
  ]),
  
  // Текущий прогресс каждой ноды (обновляется с каждым событием)
  'progress:{graphId}:{nodeId}': {
    calculatedProgress: number,
    isDone: boolean,
    currentCompletions: number,
    requiredCompletions: number,
    lastUpdated: timestamp
  },
  
  // Агрегированные метрики (пересчитываются с каждым событием)
  'metrics:{userId}:{graphId}': {
    totalNodes: number,
    completedNodes: number,
    overallProgress: number,
    lastActivity: timestamp,
    todayNodes: number,
    weekData: [...] // массив последних 7 дней
  },
  
  // Счетчик дней подряд
  'streak:{userId}': {
    current: number,
    lastDate: 'YYYY-MM-DD'
  }
}
```

### 2. Простая структура событий

```javascript
// Событие изменения прогресса
{
  eventId: uuid,
  eventType: 'PROGRESS_UPDATE',
  timestamp: Date.now(),
  nodeId: string,
  nodeTitle: string,
  nodeType: 'dao' | 'fundamental',
  nodeSubtype: string,
  oldProgress: number,
  newProgress: number,
  isDone: boolean,
  currentCompletions: number,
  requiredCompletions: number
}

// Событие изменения графа
{
  eventId: uuid,
  eventType: 'NODE_ADDED' | 'NODE_DELETED' | 'EDGE_ADDED' | 'EDGE_DELETED',
  timestamp: Date.now(),
  payload: { /* детали операции */ }
}
```

### 3. Обработка событий на backend

```javascript
// В simple-server.js - обработка пришедшего события
async function handleProgressEvent(event, ws) {
  const { userId, graphId } = ws;
  const key = `events:${userId}:${graphId}`;
  
  // 1. Сохраняем событие
  await redis.zadd(key, event.timestamp, JSON.stringify(event));
  
  // 2. Обновляем прогресс ноды
  await redis.hset(`progress:${graphId}:${event.nodeId}`, {
    calculatedProgress: event.newProgress,
    isDone: event.isDone,
    currentCompletions: event.currentCompletions,
    requiredCompletions: event.requiredCompletions,
    lastUpdated: event.timestamp
  });
  
  // 3. Пересчитываем общие метрики
  await recalculateMetrics(userId, graphId);
  
  // 4. Обновляем streak
  await updateStreak(userId);
  
  // 5. Отправляем обновленные метрики всем подключенным клиентам
  broadcast(graphId, {
    type: 'METRICS_UPDATED',
    metrics: await getMetrics(userId, graphId)
  });
}

// Простой пересчет метрик
async function recalculateMetrics(userId, graphId) {
  // Получаем текущий граф из Redis
  const graphData = await redis.get(`graph:${graphId}`);
  const graph = JSON.parse(graphData);
  
  let totalNodes = 0;
  let completedNodes = 0;
  let totalProgress = 0;
  
  // Обходим все ноды
  function traverseNodes(nodes) {
    for (const node of nodes) {
      if (node.nodeType === 'dao') {
        totalNodes++;
        const progress = calculateProgress(node, graph);
        totalProgress += progress;
        if (progress === 1) completedNodes++;
      }
      if (node.children) {
        traverseNodes(node.children);
      }
    }
  }
  
  traverseNodes(graph.nodes);
  
  // Сохраняем метрики
  const overallProgress = totalNodes > 0 ? totalProgress / totalNodes : 0;
  
  await redis.hset(`metrics:${userId}:${graphId}`, {
    totalNodes,
    completedNodes,
    overallProgress,
    lastActivity: Date.now()
  });
}
```

### 4. WebSocket интеграция

```javascript
// Добавляем в WebSocket обработчик
ws.on('message', async (message) => {
  const data = JSON.parse(message);
  
  // Обработка событий аналитики
  if (data.type === 'ANALYTICS_EVENT') {
    const event = {
      ...data.event,
      eventId: uuidv4(),
      timestamp: Date.now()
    };
    
    await handleProgressEvent(event, ws);
    return;
  }
  
  // Существующие операции (ADD_NODE, UPDATE_NODE и т.д.)
  // При каждой операции также генерируем событие для аналитики
  if (data.type === 'UPDATE_NODE') {
    // ... существующая логика обновления ...
    
    // Генерируем событие прогресса
    if (data.payload.updates.isDone !== undefined || 
        data.payload.updates.currentCompletions !== undefined) {
      
      const progressEvent = {
        eventType: 'PROGRESS_UPDATE',
        nodeId: data.payload.nodeId,
        // ... остальные поля
      };
      
      await handleProgressEvent(progressEvent, ws);
    }
  }
});
```

### 5. REST API endpoints

```javascript
// Получить текущие метрики
GET /api/analytics/metrics/:graphId
Response: {
  totalNodes: number,
  completedNodes: number,
  overallProgress: number,
  todayNodes: number,
  weekData: [
    { day: 'Mon', progress: 0.45, completed: 5 },
    { day: 'Tue', progress: 0.62, completed: 8 },
    // ...
  ]
}

// Получить события (для дебага)
GET /api/analytics/events/:graphId
Query: { limit?: 100, offset?: 0 }
Response: {
  events: [...],
  total: number
}

// Получить streak
GET /api/analytics/streak/:userId
Response: {
  currentStreak: 15,
  lastActivity: '2025-09-26'
}
```

### 6. BullMQ для фоновых задач

```javascript
const { Queue, Worker } = require('bullmq');

// Простая очередь для периодических задач
const metricsQueue = new Queue('metrics');

// Ежедневный сброс метрик (опционально)
metricsQueue.add('daily-reset', {}, {
  repeat: { cron: '0 0 * * *' }
});

// Worker
const worker = new Worker('metrics', async (job) => {
  if (job.name === 'daily-reset') {
    // Обновляем дневные счетчики
    const users = await redis.smembers('active_users');
    
    for (const userId of users) {
      const metricsKey = `metrics:${userId}:*`;
      // Сбрасываем todayNodes
      await redis.hset(metricsKey, 'todayNodes', 0);
    }
  }
});
```

### 7. Frontend интеграция

```javascript
// В TreeDaoStore добавляем отправку событий
class TreeDaoStore {
  toggleDone() {
    const oldProgress = self.calculatedProgress;
    
    // ... существующая логика ...
    
    // Отправляем событие аналитики
    if (optimisticIntegration.isConnected) {
      optimisticIntegration.sendAnalyticsEvent({
        eventType: 'PROGRESS_UPDATE',
        nodeId: self.id,
        nodeTitle: self.title,
        nodeType: self.nodeType,
        nodeSubtype: self.nodeSubtype,
        oldProgress,
        newProgress: self.calculatedProgress,
        isDone: self.isDone,
        currentCompletions: self.currentCompletions,
        requiredCompletions: self.requiredCompletions
      });
    }
  }
}

// В OptimisticIntegration
class OptimisticIntegration {
  sendAnalyticsEvent(event) {
    if (!this.isConnected) return;
    
    this.ws.send(JSON.stringify({
      type: 'ANALYTICS_EVENT',
      event
    }));
  }
}
```

## Итоговая архитектура MVP

1. **Все события сохраняются в Redis** - никаких hot/cold разделений
2. **С каждым событием пересчитываем метрики** - простой синхронный подход
3. **BullMQ только для периодических задач** - daily reset и т.п.
4. **Прогресс считается на лету** - при каждом запросе или событии
5. **WebSocket для real-time обновлений** - метрики обновляются у всех клиентов

Это максимально простая архитектура, которую можно реализовать быстро и которая будет работать для MVP. Позже можно добавить оптимизации:
- Кеширование расчетов прогресса
- Батчирование событий
- Асинхронный пересчет метрик
- PostgreSQL для долгосрочного хранения
- Kafka для масштабирования