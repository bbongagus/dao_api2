# План реализации чистой Optimistic UI архитектуры

## Шаг 1: Новый Backend (упрощенный)

### 1.1 Простой WebSocket сервер без BullMQ
```javascript
// dao_api2/src/simple-server.js
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const redis = new Redis();

app.use(cors());
app.use(express.json());

// Состояние клиентов
const clients = new Map();

// REST endpoint для загрузки графа
app.get('/api/graphs/:graphId', async (req, res) => {
  const data = await redis.get(`graph:${req.params.graphId}`);
  res.json(data ? JSON.parse(data) : {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  });
});

// WebSocket для optimistic операций
wss.on('connection', (ws) => {
  const clientId = Date.now();
  clients.set(clientId, ws);
  
  ws.on('message', async (message) => {
    const { type, operation, graphId } = JSON.parse(message);
    
    if (type === 'OPERATION') {
      try {
        // Применяем операцию к Redis
        const result = await applyOperation(graphId, operation);
        
        // Подтверждаем отправителю
        ws.send(JSON.stringify({
          type: 'ACK',
          operationId: operation.id,
          result
        }));
        
        // Broadcast всем остальным
        broadcastOperation(graphId, operation, clientId);
        
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          operationId: operation.id,
          error: error.message
        }));
      }
    }
  });
  
  ws.on('close', () => {
    clients.delete(clientId);
  });
});

async function applyOperation(graphId, op) {
  const key = `graph:${graphId}`;
  const graph = JSON.parse(await redis.get(key) || '{}');
  
  switch(op.type) {
    case 'ADD_NODE':
      graph.nodes = graph.nodes || [];
      graph.nodes.push(op.payload);
      break;
    case 'UPDATE_NODE':
      const node = graph.nodes?.find(n => n.id === op.payload.id);
      if (node) Object.assign(node, op.payload.updates);
      break;
    case 'DELETE_NODE':
      graph.nodes = graph.nodes?.filter(n => n.id !== op.payload.id);
      break;
  }
  
  await redis.set(key, JSON.stringify(graph));
  return { success: true };
}

function broadcastOperation(graphId, operation, excludeClient) {
  const message = JSON.stringify({
    type: 'REMOTE_OPERATION',
    graphId,
    operation
  });
  
  clients.forEach((ws, clientId) => {
    if (clientId !== excludeClient) {
      ws.send(message);
    }
  });
}

server.listen(3001, () => {
  console.log('Clean Optimistic Backend running on :3001');
});
```

## Шаг 2: Новый Frontend Store (без костылей)

### 2.1 OptimisticStore - чистая обертка
```javascript
// graphy/stores/OptimisticStore.js
import { makeAutoObservable, runInAction } from 'mobx';
import { v4 as uuid } from 'uuid';

export class OptimisticStore {
  baseStore = null;
  operations = [];
  ws = null;
  isConnected = false;
  
  constructor(baseStore) {
    this.baseStore = baseStore;
    makeAutoObservable(this);
    this.connect();
  }
  
  connect() {
    this.ws = new WebSocket('ws://localhost:3001');
    
    this.ws.onopen = () => {
      runInAction(() => {
        this.isConnected = true;
      });
      this.syncPendingOperations();
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleServerMessage(message);
    };
    
    this.ws.onclose = () => {
      runInAction(() => {
        this.isConnected = false;
      });
      // Переподключение через 1 сек
      setTimeout(() => this.connect(), 1000);
    };
  }
  
  // Применение операции (optimistic)
  applyOperation(type, payload) {
    const operation = {
      id: uuid(),
      type,
      payload,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    runInAction(() => {
      // 1. Добавляем в очередь
      this.operations.push(operation);
      
      // 2. Применяем локально
      this.applyLocal(operation);
      
      // 3. Отправляем на сервер
      if (this.isConnected) {
        this.sendToServer(operation);
      }
    });
    
    return operation.id;
  }
  
  applyLocal(operation) {
    switch(operation.type) {
      case 'ADD_NODE':
        // Прямое добавление в базовый store
        const newNode = {
          ...operation.payload,
          id: operation.payload.id || uuid()
        };
        this.baseStore.rootNodes.push(newNode);
        break;
        
      case 'UPDATE_NODE':
        const node = this.baseStore.findNodeById(operation.payload.id);
        if (node) {
          Object.assign(node, operation.payload.updates);
        }
        break;
        
      case 'DELETE_NODE':
        const index = this.baseStore.rootNodes.findIndex(
          n => n.id === operation.payload.id
        );
        if (index >= 0) {
          this.baseStore.rootNodes.splice(index, 1);
        }
        break;
    }
  }
  
  sendToServer(operation) {
    this.ws.send(JSON.stringify({
      type: 'OPERATION',
      graphId: this.baseStore.currentGraphId || 'main',
      operation
    }));
  }
  
  handleServerMessage(message) {
    runInAction(() => {
      switch(message.type) {
        case 'ACK':
          // Подтверждение операции
          const op = this.operations.find(o => o.id === message.operationId);
          if (op) op.status = 'confirmed';
          break;
          
        case 'ERROR':
          // Ошибка - откатываем
          this.rollbackOperation(message.operationId);
          break;
          
        case 'REMOTE_OPERATION':
          // Операция от другого клиента
          this.applyLocal(message.operation);
          break;
      }
    });
  }
  
  rollbackOperation(operationId) {
    const op = this.operations.find(o => o.id === operationId);
    if (!op) return;
    
    op.status = 'failed';
    
    // Генерируем обратную операцию
    switch(op.type) {
      case 'ADD_NODE':
        // Удаляем добавленный узел
        const index = this.baseStore.rootNodes.findIndex(
          n => n.id === op.payload.id
        );
        if (index >= 0) {
          this.baseStore.rootNodes.splice(index, 1);
        }
        break;
      // ... другие откаты
    }
  }
  
  syncPendingOperations() {
    // Отправляем все pending операции
    this.operations
      .filter(op => op.status === 'pending')
      .forEach(op => this.sendToServer(op));
  }
  
  // API для компонентов
  addNode(title, position) {
    return this.applyOperation('ADD_NODE', {
      title,
      position,
      id: uuid()
    });
  }
  
  updateNode(id, updates) {
    return this.applyOperation('UPDATE_NODE', {
      id,
      updates
    });
  }
  
  deleteNode(id) {
    return this.applyOperation('DELETE_NODE', { id });
  }
}
```

### 2.2 React Hook для использования
```javascript
// graphy/hooks/useOptimisticStore.js
import { useEffect, useState } from 'react';
import { OptimisticStore } from '../stores/OptimisticStore';

export function useOptimisticStore(baseStore) {
  const [optimisticStore] = useState(
    () => new OptimisticStore(baseStore)
  );
  
  useEffect(() => {
    return () => {
      // Cleanup при unmount
      optimisticStore.ws?.close();
    };
  }, []);
  
  return optimisticStore;
}
```

### 2.3 Использование в компоненте
```javascript
// graphy/components/FlowDiagram/FlowDiagramClean.jsx
import { observer } from 'mobx-react-lite';
import { useStores } from '../../stores/StoreProvider';
import { useOptimisticStore } from '../../hooks/useOptimisticStore';

export const FlowDiagramClean = observer(() => {
  const { treeDaoStore } = useStores();
  const optimistic = useOptimisticStore(treeDaoStore);
  
  const handleAddNode = () => {
    // Просто вызываем - никаких костылей!
    optimistic.addNode('New Node', { 
      x: Math.random() * 400, 
      y: Math.random() * 400 
    });
  };
  
  const handleDeleteNode = (nodeId) => {
    optimistic.deleteNode(nodeId);
  };
  
  return (
    <div>
      <button onClick={handleAddNode}>
        Add Node {optimistic.isConnected ? '🟢' : '🔴'}
      </button>
      
      {treeDaoStore.rootNodes.map(node => (
        <div key={node.id}>
          {node.title}
          <button onClick={() => handleDeleteNode(node.id)}>Delete</button>
        </div>
      ))}
      
      {/* Показываем pending операции */}
      <div>
        Pending: {optimistic.operations.filter(op => op.status === 'pending').length}
      </div>
    </div>
  );
});
```

## Шаг 3: Миграция существующего кода

### 3.1 Удаляем костыли
```javascript
// УДАЛИТЬ:
// - graphy/stores/models/OptimisticTreeDaoStore.js
// - graphy/stores/mixins/OptimisticMixin.js  
// - graphy/services/optimisticAdapter.js
// - graphy/services/optimisticApi.js

// ОСТАВИТЬ:
// - graphy/stores/models/TreeDaoStore.js (без изменений)
```

### 3.2 Обновляем импорты
```javascript
// Было:
import { TreeDaoStore } from './models/OptimisticTreeDaoStore';

// Стало:
import { TreeDaoStore } from './models/TreeDaoStore';
import { OptimisticStore } from './OptimisticStore';
```

## Шаг 4: Тестирование

### 4.1 Unit тесты для OptimisticStore
```javascript
// graphy/stores/__tests__/OptimisticStore.test.js
describe('OptimisticStore', () => {
  it('should apply operations optimistically', () => {
    const baseStore = { rootNodes: [] };
    const optimistic = new OptimisticStore(baseStore);
    
    optimistic.addNode('Test', { x: 0, y: 0 });
    
    expect(baseStore.rootNodes).toHaveLength(1);
    expect(optimistic.operations).toHaveLength(1);
    expect(optimistic.operations[0].status).toBe('pending');
  });
  
  it('should rollback failed operations', () => {
    const baseStore = { rootNodes: [] };
    const optimistic = new OptimisticStore(baseStore);
    
    const opId = optimistic.addNode('Test', { x: 0, y: 0 });
    expect(baseStore.rootNodes).toHaveLength(1);
    
    optimistic.rollbackOperation(opId);
    expect(baseStore.rootNodes).toHaveLength(0);
  });
});
```

## Шаг 5: Deployment

### 5.1 Docker для нового backend
```dockerfile
# dao_api2/Dockerfile.clean
FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY src/simple-server.js ./src/
CMD ["node", "src/simple-server.js"]
```

### 5.2 docker-compose
```yaml
# dao_api2/docker-compose.clean.yml
version: '3.8'
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
      
  backend:
    build:
      context: .
      dockerfile: Dockerfile.clean
    ports:
      - "3001:3001"
    depends_on:
      - redis
    environment:
      REDIS_URL: redis://redis:6379
```

## Преимущества новой реализации

1. **Нет костылей** - никаких `_optimistic_bypass` и prototype хаков
2. **Простота** - всего 2 файла вместо 5+
3. **Надежность** - автоматические откаты и переподключение
4. **Производительность** - прямые мутации без overhead
5. **Тестируемость** - легко мокать и тестировать

## Итоговая структура

```
graphy/
├── stores/
│   ├── OptimisticStore.js       # Новый чистый store
│   └── models/
│       └── TreeDaoStore.js      # Оригинальный без изменений
├── hooks/
│   └── useOptimisticStore.js    # React hook
└── components/
    └── FlowDiagramClean.jsx     # Чистый компонент

dao_api2/
├── src/
│   └── simple-server.js         # Упрощенный backend
├── Dockerfile.clean
└── docker-compose.clean.yml
```

## Команды для запуска

```bash
# Backend
cd dao_api2
docker-compose -f docker-compose.clean.yml up

# Frontend
cd graphy
npm run dev
```

Эта архитектура в 10 раз проще и в духе Figma/Miro - прямолинейная, без лишних абстракций.