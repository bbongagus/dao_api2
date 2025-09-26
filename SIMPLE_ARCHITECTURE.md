# Минималистичная Optimistic UI архитектура
## Простое решение для быстрого старта

### 🎯 Принципы
- **Максимальная простота** - никаких лишних абстракций
- **Один пользователь** - без сложной синхронизации
- **Легко дорабатывать** - чистый код, понятная структура
- **Redis + BullMQ** - только самое необходимое

---

## 📁 Простая структура проекта

```
dao_api2/
├── src/
│   ├── index.js           # Express сервер
│   ├── redis.js           # Redis подключение
│   ├── queue.js           # BullMQ очередь
│   ├── worker.js          # Обработчик команд
│   └── websocket.js       # WebSocket сервер
├── .env
├── package.json
└── docker-compose.yml
```

Всего 5 файлов кода!

---

## 1️⃣ Redis - Источник правды

### redis.js (30 строк)
```javascript
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379
});

// Простые операции с графом
export const graphOps = {
  // Сохранить состояние графа
  async saveGraph(graphId, data) {
    await redis.set(`graph:${graphId}`, JSON.stringify(data));
    await redis.incr(`graph:${graphId}:version`);
  },

  // Получить граф
  async getGraph(graphId) {
    const data = await redis.get(`graph:${graphId}`);
    return data ? JSON.parse(data) : null;
  },

  // Обновить узел
  async updateNode(graphId, nodeId, updates) {
    const graph = await this.getGraph(graphId);
    const node = graph.nodes.find(n => n.id === nodeId);
    Object.assign(node, updates);
    await this.saveGraph(graphId, graph);
    return node;
  }
};
```

---

## 2️⃣ BullMQ - Обработка команд

### queue.js (20 строк)
```javascript
import { Queue } from 'bullmq';
import { redis } from './redis.js';

// Одна очередь для всех команд
export const commandQueue = new Queue('commands', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

// Добавить команду в очередь
export async function addCommand(type, data) {
  const job = await commandQueue.add(type, data);
  return job.id;
}
```

### worker.js (40 строк)
```javascript
import { Worker } from 'bullmq';
import { redis, graphOps } from './redis.js';
import { broadcast } from './websocket.js';

// Простой обработчик команд
new Worker('commands', async (job) => {
  const { type, graphId, payload } = job.data;
  
  let result;
  
  switch(type) {
    case 'UPDATE_NODE':
      result = await graphOps.updateNode(
        graphId, 
        payload.nodeId, 
        payload.updates
      );
      break;
      
    case 'ADD_NODE':
      const graph = await graphOps.getGraph(graphId);
      graph.nodes.push(payload);
      await graphOps.saveGraph(graphId, graph);
      result = payload;
      break;
      
    case 'DELETE_NODE':
      const g = await graphOps.getGraph(graphId);
      g.nodes = g.nodes.filter(n => n.id !== payload.nodeId);
      g.edges = g.edges.filter(e => 
        e.source !== payload.nodeId && e.target !== payload.nodeId
      );
      await graphOps.saveGraph(graphId, g);
      result = { deleted: payload.nodeId };
      break;
  }
  
  // Отправить обновление через WebSocket
  broadcast({ type, graphId, result });
  
  return result;
}, { connection: redis });
```

---

## 3️⃣ API сервер

### index.js (50 строк)
```javascript
import express from 'express';
import cors from 'cors';
import { graphOps } from './redis.js';
import { addCommand } from './queue.js';

const app = express();
app.use(cors());
app.use(express.json());

// Получить граф (синхронно из Redis)
app.get('/api/graphs/:graphId', async (req, res) => {
  const graph = await graphOps.getGraph(req.params.graphId);
  res.json(graph || { nodes: [], edges: [] });
});

// Выполнить команду (optimistic)
app.post('/api/graphs/:graphId/command', async (req, res) => {
  const { type, payload } = req.body;
  const jobId = await addCommand(type, {
    graphId: req.params.graphId,
    payload
  });
  
  // Сразу возвращаем успех (optimistic)
  res.json({ 
    success: true, 
    jobId,
    // Возвращаем то что отправили для немедленного обновления UI
    optimisticResult: payload 
  });
});

// Сохранить весь граф (для начальной загрузки)
app.post('/api/graphs/:graphId', async (req, res) => {
  await graphOps.saveGraph(req.params.graphId, req.body);
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('API running on :3000');
});
```

---

## 4️⃣ WebSocket для обновлений

### websocket.js (30 строк)
```javascript
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
  
  ws.on('error', console.error);
});

// Отправить всем клиентам
export function broadcast(data) {
  const message = JSON.stringify(data);
  
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

console.log('WebSocket server on :8080');
```

---

## 5️⃣ Frontend интеграция (упрощенная)

### Frontend Service (50 строк)
```javascript
// services/simpleOptimisticApi.js
class SimpleOptimisticAPI {
  constructor() {
    this.ws = null;
    this.graphId = 'main'; // Один граф для пользователя
  }

  connect() {
    this.ws = new WebSocket('ws://localhost:8080');
    
    this.ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      // Обновить store когда сервер подтвердил
      if (this.onServerUpdate) {
        this.onServerUpdate(update);
      }
    };
  }

  async loadGraph() {
    const res = await fetch(`http://localhost:3000/api/graphs/${this.graphId}`);
    return res.json();
  }

  async executeCommand(type, payload) {
    // Отправить команду на сервер
    const res = await fetch(`http://localhost:3000/api/graphs/${this.graphId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload })
    });
    
    return res.json();
  }

  // Обёртки для удобства
  async updateNode(nodeId, updates) {
    return this.executeCommand('UPDATE_NODE', { nodeId, updates });
  }

  async addNode(node) {
    return this.executeCommand('ADD_NODE', node);
  }

  async deleteNode(nodeId) {
    return this.executeCommand('DELETE_NODE', { nodeId });
  }
}

export const api = new SimpleOptimisticAPI();
```

### Store Integration (30 строк)
```javascript
// В TreeDaoStore
const addNodeOptimistic = (title, position) => {
  // 1. Добавить узел локально сразу
  const tempNode = {
    id: `temp_${Date.now()}`,
    title,
    position,
    isOptimistic: true
  };
  self.nodes.push(tempNode);
  
  // 2. Отправить на сервер
  api.addNode({
    ...tempNode,
    id: undefined // Сервер создаст настоящий ID
  }).then(result => {
    // 3. Заменить временный ID на настоящий
    const node = self.nodes.find(n => n.id === tempNode.id);
    if (node && result.optimisticResult) {
      node.id = result.optimisticResult.id;
      node.isOptimistic = false;
    }
  });
};

// Подписаться на обновления с сервера
api.onServerUpdate = (update) => {
  console.log('Server confirmed:', update);
  // Обновить состояние если нужно
};
```

---

## 🐳 Docker Compose (минимальный)

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  app:
    build: .
    ports:
      - "3000:3000"
      - "8080:8080"
    depends_on:
      - redis
    environment:
      - REDIS_HOST=redis
    volumes:
      - ./src:/app/src
    command: npm run dev

volumes:
  redis-data:
```

---

## 📦 Package.json (минимальный)

```json
{
  "name": "dao-api-simple",
  "type": "module",
  "scripts": {
    "start": "node src/index.js & node src/worker.js",
    "dev": "nodemon --watch src -e js --exec 'npm start'"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "ioredis": "^5.3.2",
    "bullmq": "^4.12.0",
    "ws": "^8.14.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

## 🚀 Запуск

```bash
# 1. Установить зависимости
npm install

# 2. Запустить Redis
docker-compose up redis

# 3. Запустить приложение
npm run dev
```

---

## ✨ Что получаем

### Работающую систему с:
- ✅ **Optimistic UI** - мгновенные обновления в интерфейсе
- ✅ **Redis** - единый источник правды
- ✅ **BullMQ** - надёжная обработка команд
- ✅ **WebSocket** - подтверждения от сервера

### Без лишнего:
- ❌ Нет сложной аутентификации (один пользователь)
- ❌ Нет разрешения конфликтов (один пользователь)
- ❌ Нет кластеризации (пока не нужно)
- ❌ Нет метрик и мониторинга (добавим позже)

---

## 📈 Как развивать дальше

### Этап 1: Базовые улучшения
```javascript
// Добавить больше типов команд
case 'UPDATE_EDGE':
case 'BATCH_UPDATE':
case 'UNDO':
```

### Этап 2: Производительность
```javascript
// Добавить кэширование
const cache = new Map();

async function getCachedGraph(graphId) {
  if (!cache.has(graphId)) {
    cache.set(graphId, await graphOps.getGraph(graphId));
  }
  return cache.get(graphId);
}
```

### Этап 3: Многопользовательность
```javascript
// Добавить userId в команды
const job = await commandQueue.add(type, {
  userId,
  graphId,
  payload
});

// Добавить разрешение конфликтов
if (conflict) {
  return resolveConflict(localState, serverState);
}
```

### Этап 4: Масштабирование
- Добавить Redis Cluster
- Добавить несколько worker'ов
- Добавить nginx для балансировки

---

## 💡 Почему это хорошее решение

1. **Просто начать** - 5 файлов, 200 строк кода
2. **Легко понять** - минимум абстракций
3. **Легко дорабатывать** - чистая структура
4. **Производительно** - Redis + асинхронная обработка
5. **Надёжно** - BullMQ гарантирует обработку

Это минимальный, но полностью рабочий костяк для Optimistic UI!