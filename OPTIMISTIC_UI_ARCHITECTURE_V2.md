# Архитектура Optimistic UI Backend v2.0
## На основе анализа Graphy Frontend

## 📊 Анализ существующей архитектуры Graphy

### Frontend Stack:
- **State Management**: MobX-State-Tree (MST)
- **UI**: React Flow для диаграмм
- **Real-time**: WebSocket через OptimisticIntegration
- **API**: REST + WebSocket гибридный подход
- **Storage**: localStorage для оффлайн режима

### Ключевые компоненты:
1. **TreeDaoStore** - основное хранилище состояния
   - Управляет узлами (nodes) и связями (edges)
   - Поддерживает навигацию по уровням
   - Отслеживает прогресс выполнения задач

2. **OptimisticIntegration** - WebSocket интеграция
   - Перехватывает все операции из TreeDaoStore
   - Отправляет операции на backend через WebSocket
   - Обрабатывает удаленные операции от других клиентов
   - Имеет очередь для оффлайн операций

3. **GraphAPI** - REST API для CRUD операций
   - Загрузка/сохранение полного состояния графа
   - Управление пользователями и графами
   - Настройки и метаданные

## 🎯 Цели новой архитектуры

1. **Простота** - минимум абстракций, как в Figma/Miro
2. **Производительность** - мгновенные обновления UI
3. **Надежность** - Redis как единственный источник правды
4. **Масштабируемость** - готовность к multi-user коллаборации

## 🏗️ Архитектура Backend (dao_api2)

### Уровень 1: WebSocket Server
```javascript
// Простой WebSocket сервер без лишних абстракций
class OptimisticServer {
  // Прямая работа с Redis
  // Broadcast изменений всем клиентам
  // Минимальная валидация
}
```

### Уровень 2: Redis Storage
```javascript
// Структура данных в Redis
{
  // Граф пользователя
  "graph:main": {
    nodes: [],
    edges: [],
    viewport: {},
    version: 1
  },
  
  // Операции (для истории/undo)
  "operations:main": [
    { type: "ADD_NODE", payload: {...}, timestamp: ... }
  ],
  
  // Сессии пользователей
  "sessions": {
    "user1": { graphId: "main", lastSeen: ... }
  }
}
```

### Операции через WebSocket

```javascript
// Frontend -> Backend
{
  type: "ADD_NODE",
  payload: {
    id: "node-1",
    title: "New Task",
    position: { x: 100, y: 200 },
    nodeType: "dao"
  }
}

// Backend -> All Clients
{
  type: "NODE_ADDED",
  payload: { ... },
  userId: "user1",
  timestamp: 1234567890
}
```

## 🔄 Поток данных

### Optimistic Update Flow:
1. **Пользователь** делает действие (добавляет узел)
2. **TreeDaoStore** сразу обновляет локальное состояние
3. **OptimisticIntegration** перехватывает операцию
4. **WebSocket** отправляет операцию на сервер
5. **Server** применяет к Redis и broadcast всем
6. **Другие клиенты** получают и применяют изменение

### Загрузка/Сохранение:
1. **REST API** для полной загрузки графа при старте
2. **WebSocket** для всех runtime операций
3. **Периодическое сохранение** полного snapshot в Redis

## 📁 Структура проекта dao_api2

```
dao_api2/
├── src/
│   ├── server.js           # Основной WebSocket + REST сервер
│   ├── redis.js            # Redis клиент и операции
│   ├── operations.js       # Обработчики операций
│   └── validation.js       # Простая валидация
├── docker-compose.yml      # Redis + Node.js контейнеры
├── Dockerfile
├── package.json
└── .env.example
```

## 🔌 API Endpoints

### REST (для совместимости с существующим кодом):
- `GET /api/graphs/:graphId` - загрузить граф
- `POST /api/graphs/:graphId` - сохранить граф
- `GET /api/users/:userId/graphs` - список графов пользователя

### WebSocket Events:
- `connection` - подключение клиента
- `subscribe` - подписка на граф
- `operation` - выполнение операции
- `sync` - запрос полной синхронизации

## 🚀 Преимущества подхода

1. **Совместимость** - frontend почти не меняется
2. **Простота** - 300-400 строк кода вместо тысяч
3. **Скорость** - прямая работа с Redis
4. **Гибкость** - легко добавлять новые типы операций
5. **Отладка** - все операции логируются и прозрачны

## 🔧 Технологии

- **Node.js** - сервер
- **ws** - WebSocket библиотека
- **Redis** - хранилище
- **Express** - REST API
- **Docker** - контейнеризация

## 📝 Миграция с текущего backend

### Этап 1: Параллельная работа
- Новый backend на порту 3001
- Старый backend продолжает работать
- Frontend может переключаться между ними

### Этап 2: Постепенный перенос
- Начинаем с WebSocket операций
- REST endpoints остаются для совместимости
- Данные мигрируются в Redis

### Этап 3: Полный переход
- Отключаем старый backend
- Все операции через новый Optimistic Backend
- Cleanup старого кода

## 🎨 Примеры кода

### Server (простой и понятный):
```javascript
const WebSocket = require('ws');
const redis = require('./redis');

const wss = new WebSocket.Server({ port: 3001 });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const { type, payload } = JSON.parse(data);
    
    // Применяем операцию к Redis
    await redis.applyOperation(type, payload);
    
    // Broadcast всем клиентам
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, payload }));
      }
    });
  });
});
```

### Redis Operations:
```javascript
async function applyOperation(type, payload) {
  const graph = await getGraph(payload.graphId);
  
  switch(type) {
    case 'ADD_NODE':
      graph.nodes.push(payload.node);
      break;
    case 'DELETE_NODE':
      graph.nodes = graph.nodes.filter(n => n.id !== payload.nodeId);
      break;
    case 'UPDATE_NODE':
      const node = graph.nodes.find(n => n.id === payload.id);
      Object.assign(node, payload.updates);
      break;
  }
  
  await saveGraph(payload.graphId, graph);
}
```

## 📊 Сравнение с текущей архитектурой

| Аспект | Текущая (dao_api) | Новая (dao_api2) |
|--------|-------------------|------------------|
| Сложность | Высокая (BullMQ, воркеры) | Низкая (прямой WebSocket) |
| Код | ~2000+ строк | ~400 строк |
| Зависимости | 15+ пакетов | 5 пакетов |
| Latency | 50-100ms | <10ms |
| Масштабирование | Сложное | Простое (Redis Cluster) |

## ✅ Checklist для реализации

- [ ] Создать базовую структуру проекта
- [ ] Настроить Docker с Redis
- [ ] Реализовать WebSocket сервер
- [ ] Добавить обработчики операций
- [ ] Создать REST endpoints для совместимости
- [ ] Написать тесты
- [ ] Документировать API
- [ ] Провести нагрузочное тестирование
- [ ] Подготовить миграционные скрипты

## 🔮 Будущие улучшения

1. **Conflict Resolution** - разрешение конфликтов при одновременном редактировании
2. **Undo/Redo** - история операций в Redis
3. **Permissions** - права доступа к графам
4. **Presence** - показ курсоров других пользователей
5. **Offline Support** - полноценная работа без интернета