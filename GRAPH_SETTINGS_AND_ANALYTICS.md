# Graph Settings и Система Аналитики

## 📊 Текущее состояние

### Graph Settings - что отправляется на backend

#### ✅ Что СОХРАНЯЕТСЯ корректно:

1. **Через REST API** (`/api/graphs/:graphId`):
   - `nodes` - вся иерархия нод с детьми
   - `edges` - все связи между нодами
   - `viewport` - позиция и масштаб canvas
   - `settings` - настройки графа (после наших исправлений)

2. **Структура settings**:
```javascript
{
  resetProgressEnabled: boolean,  // Включен ли daily reset
  resetFrequency: 'daily' | 'weekly' | 'monthly',
  lastProgressReset: ISO_DATE_STRING,
  lastUpdated: ISO_DATE_STRING
}
```

3. **Данные прогресса в нодах**:
```javascript
{
  isDone: boolean,           // Завершена ли задача
  currentCompletions: number, // Текущее количество выполнений
  requiredCompletions: number,// Требуемое количество выполнений
  calculatedProgress: number  // 0-1, вычисляется динамически
}
```

### ❌ Что НЕ СОБИРАЕТСЯ (аналитика):

1. **Временные метрики**:
   - Время работы над задачами (Focus Time захардкожено как "24h")
   - История изменений прогресса
   - Временные метки начала/завершения задач
   - Продолжительность сессий

2. **Исторические данные**:
   - Когда задача была создана
   - Когда задача была впервые начата
   - Сколько раз задача переоткрывалась
   - Тренды прогресса во времени

3. **Пользовательская активность**:
   - Клики и навигация
   - Время на каждом уровне иерархии
   - Частота использования функций
   - Паттерны работы

## 🔄 Как работает система сейчас

### Frontend (graphy)

1. **PersistenceMixin.js**:
   - Сохраняет в localStorage как backup
   - Отправляет на backend через GraphFacade

2. **GraphFacade.js**:
   - Собирает snapshot всех данных
   - Отправляет POST на `/api/graphs/:graphId`
   - Включает settings в payload

3. **TreeDaoStore.js**:
   - Хранит settings в Map: `graphSettings`
   - Применяет daily reset при загрузке
   - НЕ отслеживает время работы

4. **AdaptiveDashboard**:
   - Вычисляет метрики на лету из текущего состояния
   - Focus Time = "24h" (захардкожено)
   - Overall Progress = среднее арифметическое
   - Active Items = ноды с прогрессом > 0

### Backend (dao_api2)

1. **simple-server.js**:
   - Сохраняет в Redis: `graph:${graphId}`
   - Проверяет daily reset при подключении
   - НЕ логирует события для аналитики
   - НЕ сохраняет историю изменений

2. **Что хранится в Redis**:
```javascript
{
  nodes: [...],      // Полная иерархия
  edges: [...],      // Связи
  viewport: {...},   // Позиция canvas
  settings: {...},   // Настройки графа
  version: number,   // Версия для оптимистичных обновлений
  lastUpdated: ISO_STRING
}
```

## 🚨 Проблемы

1. **Нет реальной аналитики** - все метрики вычисляются из текущего snapshot
2. **Focus Time фейковый** - всегда показывает "24h"
3. **Нет истории** - невозможно показать тренды или прогресс во времени
4. **Нет event tracking** - не отслеживаются действия пользователя

## 💡 Рекомендации для внедрения аналитики

### Фаза 1: Event Tracking
```javascript
// Новая структура события
{
  eventType: 'progress_update',
  nodeId: 'uuid',
  timestamp: Date.now(),
  userId: 'user1',
  sessionId: 'session-uuid',
  data: {
    oldValue: 0.5,
    newValue: 0.7,
    trigger: 'manual' | 'auto'
  }
}
```

### Фаза 2: Analytics Storage
- Добавить Redis Streams для событий
- BullMQ worker для обработки
- Отдельная структура для метрик:
```javascript
// analytics:node:${nodeId}
{
  totalTimeSpent: seconds,
  firstStarted: ISO_STRING,
  lastActive: ISO_STRING,
  completionHistory: [
    { timestamp: ISO_STRING, value: 0.5 }
  ],
  sessionsCount: number
}
```

### Фаза 3: Real-time Metrics
- WebSocket канал для аналитики
- Агрегация метрик в реальном времени
- Обновление dashboard с реальными данными

## 📋 Checklist исправлений

- [x] Settings сохраняются в REST API endpoint
- [x] Settings загружаются при GET запросе
- [x] Settings передаются через WebSocket
- [ ] Добавить event tracking
- [ ] Реализовать сохранение временных меток
- [ ] Создать analytics storage
- [ ] Реализовать real focus time tracking
- [ ] Добавить historical data API

## Заключение

Текущая система работает для MVP, но не предоставляет реальной аналитики. Graph Settings корректно сохраняются после внесенных исправлений, но для полноценной аналитики требуется внедрение Event-Driven архитектуры с отдельным хранилищем для временных рядов данных.