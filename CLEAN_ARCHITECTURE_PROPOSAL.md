# Clean Optimistic UI Architecture (Figma/Miro Style)

## Основные принципы

### 1. Разделение состояний
```typescript
interface AppState {
  local: LocalState;      // Немедленные изменения
  server: ServerState;    // Подтвержденное состояние
  pending: Operation[];   // Ожидающие операции
}
```

### 2. Операции вместо мутаций
```typescript
interface Operation {
  id: string;
  type: 'ADD_NODE' | 'UPDATE_NODE' | 'DELETE_NODE';
  payload: any;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
}
```

## Frontend архитектура (без костылей)

### OptimisticStore (чистая реализация)
```javascript
class OptimisticStore {
  constructor(baseStore) {
    this.baseStore = baseStore;     // Оригинальный TreeDaoStore
    this.operations = [];            // Очередь операций
    this.socket = null;              // WebSocket соединение
  }

  // Применяем операцию optimistically
  async applyOperation(op) {
    // 1. Добавляем в очередь
    this.operations.push(op);
    
    // 2. Применяем к локальному состоянию
    this.applyToLocalState(op);
    
    // 3. Отправляем на сервер
    if (this.socket?.connected) {
      this.socket.emit('operation', op);
    } else {
      // Сохраняем в localStorage для синхронизации позже
      this.queueForSync(op);
    }
  }

  // Применяем к локальному состоянию
  applyToLocalState(op) {
    switch(op.type) {
      case 'ADD_NODE':
        // Напрямую добавляем в store без всяких bypass флагов
        this.baseStore.nodes.push(op.payload);
        break;
      case 'UPDATE_NODE':
        const node = this.baseStore.nodes.find(n => n.id === op.payload.id);
        if (node) Object.assign(node, op.payload.updates);
        break;
      case 'DELETE_NODE':
        this.baseStore.nodes = this.baseStore.nodes.filter(
          n => n.id !== op.payload.nodeId
        );
        break;
    }
  }

  // Обработка подтверждения от сервера
  handleServerConfirmation(opId, serverData) {
    const op = this.operations.find(o => o.id === opId);
    if (op) {
      op.status = 'confirmed';
      // Обновляем ID если сервер присвоил новый
      if (serverData.newId) {
        this.updateTempId(op.payload.tempId, serverData.newId);
      }
    }
  }

  // Откат операции при ошибке
  rollbackOperation(opId) {
    const op = this.operations.find(o => o.id === opId);
    if (op) {
      op.status = 'failed';
      // Генерируем обратную операцию
      const reverseOp = this.createReverseOperation(op);
      this.applyToLocalState(reverseOp);
    }
  }
}
```

### Интеграция с React (простая и чистая)
```javascript
// hooks/useOptimistic.js
export function useOptimistic(store) {
  const [optimisticStore] = useState(() => new OptimisticStore(store));
  
  useEffect(() => {
    // Подключаемся к WebSocket
    optimisticStore.connect();
    return () => optimisticStore.disconnect();
  }, []);

  // Методы для UI
  const addNode = useCallback((node) => {
    optimisticStore.applyOperation({
      id: uuid(),
      type: 'ADD_NODE',
      payload: { ...node, tempId: uuid() },
      timestamp: Date.now()
    });
  }, []);

  return { addNode, updateNode, deleteNode };
}
```

### В компоненте (без сложности)
```javascript
function FlowDiagram() {
  const store = useTreeStore();
  const { addNode } = useOptimistic(store);
  
  const handleAddNode = () => {
    // Просто вызываем - всё остальное происходит автоматически
    addNode({ 
      title: 'New Node',
      position: { x: 100, y: 100 }
    });
  };
  
  return <button onClick={handleAddNode}>Add Node</button>;
}
```

## Backend архитектура (упрощенная)

### Простой Event Handler
```javascript
// server.js
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';

const redis = new Redis();
const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const operation = JSON.parse(data);
    
    try {
      // Применяем операцию
      const result = await applyOperation(operation);
      
      // Подтверждаем клиенту
      ws.send(JSON.stringify({
        type: 'CONFIRMED',
        opId: operation.id,
        result
      }));
      
      // Broadcast другим клиентам
      broadcast(operation, ws);
      
    } catch (error) {
      // Откат
      ws.send(JSON.stringify({
        type: 'FAILED',
        opId: operation.id,
        error: error.message
      }));
    }
  });
});

async function applyOperation(op) {
  const graphKey = `graph:${op.graphId}`;
  
  // Транзакция в Redis
  const pipeline = redis.pipeline();
  
  switch(op.type) {
    case 'ADD_NODE':
      pipeline.hset(graphKey, `node:${op.payload.id}`, JSON.stringify(op.payload));
      break;
    case 'UPDATE_NODE':
      pipeline.hset(graphKey, `node:${op.payload.id}`, JSON.stringify(op.payload));
      break;
    case 'DELETE_NODE':
      pipeline.hdel(graphKey, `node:${op.payload.nodeId}`);
      break;
  }
  
  await pipeline.exec();
  return { success: true };
}
```

## Преимущества новой архитектуры

### 1. Простота
- Нет костылей типа `_optimistic_bypass`
- Нет сложных цепочек вызовов
- Чистое разделение ответственности

### 2. Надежность
- Операции могут быть переиграны
- Автоматический rollback при ошибках
- Offline-first подход

### 3. Масштабируемость
- Легко добавить новые типы операций
- Можно добавить CRDT для коллаборации
- Event sourcing позволяет восстановить любое состояние

### 4. Производительность
- Минимум слоев абстракции
- Батчинг операций из коробки
- Эффективное использование Redis

## План миграции

### Фаза 1: Backend
1. Упростить WebSocket handler (убрать BullMQ)
2. Перейти на event-based архитектуру
3. Использовать Redis транзакции

### Фаза 2: Frontend Store
1. Создать чистый OptimisticStore
2. Убрать OptimisticMixin и OptimisticAdapter
3. Использовать простые операции вместо сложных мутаций

### Фаза 3: React интеграция
1. Создать хук useOptimistic
2. Убрать все костыли из компонентов
3. Тестирование

## Сравнение с текущей архитектурой

| Аспект | Текущая | Предлагаемая |
|--------|---------|--------------|
| Слои абстракции | 5+ | 2 |
| Костыли | _optimistic_bypass, prototype hacks | Нет |
| Сложность | Очень высокая | Низкая |
| Тестируемость | Сложно | Легко |
| Производительность | Много overhead | Минимальный overhead |

## Примеры из Figma/Miro

### Figma подход:
- Local mutations применяются мгновенно
- Server mutations применяются при получении
- Конфликты разрешаются через CRDT
- Нет сложных слоев - прямая работа с состоянием

### Miro подход:
- Event sourcing для всех изменений
- Optimistic UI через локальный event log
- Синхронизация через операционные трансформации
- Простой WebSocket протокол

## Итог

Текущая реализация слишком сложная из-за попыток "обойти" MST ограничения. Вместо борьбы с фреймворком, нужно:

1. **Отделить optimistic логику от store**
2. **Использовать операции вместо мутаций**
3. **Упростить backend до event handler**
4. **Убрать все промежуточные слои**

Это даст:
- Чистый, понятный код
- Легкую отладку
- Высокую производительность
- Возможность добавить коллаборацию в будущем