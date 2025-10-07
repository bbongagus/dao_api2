# Реализация userId в системе

## 📌 Текущая реализация

Для поддержки многопользовательской работы в будущем, система уже сейчас использует константный `userId` для всех операций.

### Константный userId для тестирования
```javascript
const DEFAULT_USER_ID = 'test-user-001';
```

## 🔧 Изменения в Backend (`dao_api2/src/simple-server.js`)

### Redis ключи
Все данные теперь сохраняются с префиксом пользователя:
- **Было**: `graph:${graphId}`
- **Стало**: `user:${userId}:graph:${graphId}`

### Функции для работы с графами
```javascript
// Загрузка графа
async function getGraph(graphId, userId = DEFAULT_USER_ID) {
  // Сначала проверяем user-specific ключ
  let data = await redis.get(`user:${userId}:graph:${graphId}`);
  
  // Для обратной совместимости проверяем старый формат
  if (!data) {
    data = await redis.get(`graph:${graphId}`);
  }
  // ...
}

// Сохранение графа
async function saveGraph(graphId, graph, userId = DEFAULT_USER_ID) {
  const redisKey = `user:${userId}:graph:${graphId}`;
  await redis.set(redisKey, graphData);
  // Автоматическая миграция и удаление старых ключей
}
```

### REST API endpoints
```javascript
// GET /api/graphs/:graphId
const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
const graph = await getGraph(graphId, userId);

// POST /api/graphs/:graphId  
const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
await saveGraph(graphId, updatedGraph, userId);
```

### WebSocket подключения
```javascript
case 'SUBSCRIBE':
  clientInfo.userId = data.userId || DEFAULT_USER_ID;
  const graph = await getGraph(data.graphId, clientInfo.userId);
```

## 🎨 Изменения в Frontend

### `GraphFacade.js`
```javascript
export class GraphFacade {
  constructor(store) {
    this.store = store;
    this.DEFAULT_USER_ID = 'test-user-001';
  }

  getUserId() {
    return this.store.userId || this.DEFAULT_USER_ID;
  }

  // Все запросы теперь включают X-User-Id header
  async saveGraph() {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': this.getUserId()
      }
    });
  }
}
```

### `optimisticApi.js`
```javascript
class OptimisticAPI {
  constructor(config = {}) {
    this.userId = config.userId || 'test-user-001';
  }

  // WebSocket подписка
  this.ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    graphId: this.graphId,
    userId: this.userId
  }));

  // REST запросы с userId
  async loadGraph() {
    const response = await fetch(url, {
      headers: {
        'X-User-Id': this.userId
      }
    });
  }
}
```

## 🚀 Миграция на многопользовательскую систему

### Шаг 1: Аутентификация (будущее)
```javascript
// Получение userId из JWT токена или сессии
const userId = req.auth?.userId || DEFAULT_USER_ID;
```

### Шаг 2: Динамический userId
```javascript
// Frontend - получение из auth context
const userId = useAuth().userId;

// Backend - валидация прав доступа
if (userId !== graph.userId && !hasSharedAccess(userId, graphId)) {
  return res.status(403).json({ error: 'Access denied' });
}
```

### Шаг 3: Совместная работа
```javascript
// Разделение графов между пользователями
`shared:${graphId}:users` // Set с userId пользователей с доступом
`user:${userId}:shared_graphs` // List графов, к которым есть доступ
```

## 📊 Структура данных в Redis

### Текущая структура (с userId)
```
user:test-user-001:graph:main → {
  nodes: [...],
  edges: [...],
  viewport: {...},
  settings: {...},
  userId: 'test-user-001',
  version: 1,
  lastUpdated: '2024-01-01T00:00:00Z'
}
```

### Будущая структура (multi-user)
```
# Графы пользователя
user:{userId}:graph:{graphId} → {...}

# Права доступа
graph:{graphId}:permissions → {
  owner: 'userId1',
  editors: ['userId2', 'userId3'],
  viewers: ['userId4']
}

# Активные сессии
session:{sessionId} → {
  userId: 'userId1',
  graphId: 'graphId1',
  connectedAt: '...'
}
```

## ✅ Преимущества текущей реализации

1. **Готовность к масштабированию** - Система уже использует userId во всех операциях
2. **Обратная совместимость** - Автоматическая миграция старых данных
3. **Изоляция данных** - Каждый пользователь имеет свое пространство имен
4. **Простота тестирования** - Константный userId упрощает разработку
5. **Минимальные изменения в будущем** - Только нужно добавить аутентификацию

## 🔒 Безопасность

В продакшене необходимо добавить:
- JWT токены для аутентификации
- Валидация userId на backend
- Проверка прав доступа к графам
- Rate limiting по userId
- Аудит лог операций пользователей

## 📝 TODO для полной multi-user поддержки

- [ ] Добавить систему аутентификации
- [ ] Реализовать управление правами доступа
- [ ] Добавить UI для sharing графов
- [ ] Реализовать real-time коллаборацию
- [ ] Добавить user presence (кто сейчас онлайн)
- [ ] Система уведомлений об изменениях