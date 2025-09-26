# Как работает синхронизация между окнами/пользователями

## Пошаговое объяснение процесса синхронизации

### 📍 Шаг 1: Пользователь А делает изменение

Например, кликает на чекбокс ноды в своем окне браузера.

```javascript
// В graphy/stores/models/TreeDaoStore.js, метод toggleDone():
toggleDone() {
  // 1. Сначала меняем локальное состояние (Optimistic UI)
  self.isDone = !self.isDone;
  
  // 2. Отправляем изменение через WebSocket на сервер
  if (optimisticIntegration.isConnected) {
    optimisticIntegration.interceptNodeUpdate(self.id, { 
      isDone: self.isDone,
      currentCompletions: self.currentCompletions
    });
  }
}
```

### 📍 Шаг 2: Операция отправляется на сервер через WebSocket

```javascript
// graphy/stores/mixins/OptimisticIntegration.js
interceptNodeUpdate(nodeId, updates) {
  this.sendOperation('UPDATE_NODE', {
    id: nodeId,
    updates: updates
  });
}

// Это преобразуется в WebSocket сообщение:
ws.send(JSON.stringify({
  type: 'OPERATION',
  payload: {
    type: 'UPDATE_NODE',
    payload: { 
      id: 'node-123', 
      updates: { 
        isDone: true,
        currentCompletions: 1 
      }
    }
  }
}));
```

### 📍 Шаг 3: Сервер получает операцию и рассылает ВСЕМ клиентам

```javascript
// dao_api2/src/simple-server.js
case 'OPERATION':
  console.log(`🔧 Applying operation: ${data.payload.type} to graph ${clientInfo.graphId}`);
  
  // 1. Применяет изменение к графу в памяти
  const result = await applyOperation(clientInfo.graphId, data.payload);
  
  // 2. Сохраняет в Redis
  await saveGraph(graphId, graph);
  
  // 3. Рассылает ВСЕМ подключенным клиентам этого графа
  const broadcastMessage = JSON.stringify({
    type: 'OPERATION_APPLIED',
    payload: data.payload,
    userId: clientInfo.userId,
    clientId: clientId,  // ID отправителя
    timestamp: Date.now()
  });
  
  clients.forEach((client, id) => {
    if (client.graphId === clientInfo.graphId && 
        client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(broadcastMessage);  // Отправляет ВСЕМ, включая отправителя
      console.log(`  → Sent to client ${id} (${id === clientId ? 'sender' : 'other tab'})`);
    }
  });
```

### 📍 Шаг 4: Пользователь Б получает обновление через WebSocket

```javascript
// graphy/services/optimisticApi.js
handleWebSocketMessage(message) {
  console.log('📨 WebSocket message:', message);
  
  switch(message.type) {
    case 'OPERATION_APPLIED':
      // Операция была применена на сервере и отправлена всем клиентам
      console.log('🔄 Remote operation received:', message.payload?.type);
      
      // Вызывает callback для удаленных операций
      if (this.onRemoteOperation) {
        this.onRemoteOperation(message.payload);
      }
      break;
  }
}
```

### 📍 Шаг 5: OptimisticIntegration передает событие в TreeDaoStore

```javascript
// graphy/stores/mixins/OptimisticIntegration.js
// При инициализации устанавливает обработчик:
this.api.onRemoteOperation = (operation) => {
  console.log('🔄 OptimisticIntegration: Remote operation from other client:', operation);
  
  // Эмитит событие через EventBus
  if (window.optimisticEventBus) {
    window.optimisticEventBus.emit('remoteOperation', operation);
  }
};
```

### 📍 Шаг 6: TreeDaoStore применяет изменения от другого пользователя

```javascript
// graphy/stores/models/TreeDaoStore.js
// При инициализации подписывается на события:
window.optimisticEventBus.on('remoteOperation', (operation) => {
  console.log('📥 TreeDaoStore: Applying remote operation:', operation);
  
  // ВАЖНО: Проверяет что это не своя операция
  const myClientId = optimisticIntegration.api?.clientId;
  if (operation.clientId && operation.clientId === myClientId) {
    console.log('  → Skipping own operation');
    return;  // Пропускаем свои операции чтобы избежать дублирования
  }
  
  // Применяем операцию от другого клиента
  self.applyRemoteOperation(operation);
});

// Метод applyRemoteOperation:
applyRemoteOperation(operation) {
  const { type, payload } = operation;
  
  switch (type) {
    case 'UPDATE_NODE':
      const nodeToUpdate = self.findNodeById(payload.id);
      if (nodeToUpdate && payload.updates) {
        // ВАЖНО: Используем прямое присваивание, а не методы
        // чтобы не вызвать повторную отправку через WebSocket
        Object.keys(payload.updates).forEach(key => {
          if (key === 'isDone') {
            nodeToUpdate.isDone = payload.updates[key];
          } else if (key === 'title') {
            nodeToUpdate.title = payload.updates[key];
          } else if (key === 'currentCompletions') {
            nodeToUpdate.currentCompletions = payload.updates[key];
          }
        });
        console.log(`  ✅ Updated node: ${payload.id}`, payload.updates);
      }
      break;
    // ... другие типы операций
  }
}
```

### 📍 Результат: Пользователь Б видит изменение в реальном времени!

MobX автоматически обновляет UI когда изменяется состояние ноды.

## Визуальная схема процесса

```
Пользователь А                      Сервер                      Пользователь Б
(Вкладка 1)                    (Node.js + Redis)                 (Вкладка 2)
     |                               |                               |
     |-- 1. Клик на чекбокс ---------|                               |
     |   (isDone = true локально)    |                               |
     |                               |                               |
     |-- 2. WebSocket: UPDATE_NODE ->|                               |
     |                               |                               |
     |                          3. Сохраняет в Redis                 |
     |                               |                               |
     |<-- 4a. OPERATION_APPLIED -----|------ 4b. OPERATION_APPLIED ->|
     |    (clientId: 1)              |         (clientId: 1)         |
     |                               |                               |
     |-- 5a. Пропускает -------------|                               |
     |    (это моя операция)         |                               |
     |                               |                               |
     |                               |    5b. Применяет изменение ---|
     |                               |       (isDone = true)         |
     |                               |       UI обновляется          |
```

## Ключевые моменты реализации

### 1. Optimistic UI
- Пользователь А видит изменение мгновенно (не ждет подтверждения от сервера)
- Если операция не удалась, можно откатить изменение (пока не реализовано)

### 2. Broadcast всем клиентам
- Сервер отправляет операцию ВСЕМ подключенным клиентам, включая отправителя
- Это гарантирует что все клиенты имеют одинаковое состояние

### 3. Фильтрация по clientId
- Каждый клиент получает свой уникальный clientId при подключении
- Клиент пропускает операции со своим clientId чтобы не применять их дважды

### 4. Прямое присваивание при получении
- При получении чужих операций используем прямое присваивание (node.isDone = value)
- НЕ вызываем методы (toggleDone()), чтобы не зациклить отправку

### 5. Redis как источник правды
- Все изменения сохраняются в Redis
- При подключении нового клиента он получает актуальное состояние из Redis

## Поддерживаемые операции

Все эти операции синхронизируются между окнами:

1. **ADD_NODE** - создание новой ноды
2. **UPDATE_NODE** - обновление свойств ноды (title, isDone, etc.)
3. **UPDATE_NODE_POSITION** - перемещение ноды
4. **DELETE_NODE** - удаление ноды
5. **ADD_EDGE** - создание связи между нодами
6. **DELETE_EDGE** - удаление связи

## Отладка синхронизации

### В консоли браузера смотрите:
```
✅ WebSocket connected to: ws://localhost:3001
📤 OptimisticIntegration: Operation sent: UPDATE_NODE
📨 WebSocket message: {type: "OPERATION_APPLIED", ...}
🔄 Remote operation received: UPDATE_NODE
📥 TreeDaoStore: Applying remote operation: {type: "UPDATE_NODE", ...}
✅ Updated node: node-123 {isDone: true}
```

### На сервере в логах:
```
👤 Client 1 connected
📡 Client 1 subscribed to graph "main" as user user1
🔧 Applying operation: UPDATE_NODE to graph main
💾 Saving graph main: 3 nodes, 2 edges, version 5
✅ Graph main saved to Redis successfully
📢 Operation UPDATE_NODE broadcasted to 2 clients
  → Sent to client 1 (sender)
  → Sent to client 2 (other tab)
```

## Это тот же принцип что используют Figma и Miro!

Все пользователи видят изменения друг друга в реальном времени через WebSocket.