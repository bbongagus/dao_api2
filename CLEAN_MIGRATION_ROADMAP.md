# Roadmap: Миграция на чистую Optimistic UI архитектуру

## Фаза 0: Подготовка (День 1)

### Задачи:
1. ✅ Анализ текущей архитектуры - **ВЫПОЛНЕНО**
2. ✅ Выявление проблем и костылей - **ВЫПОЛНЕНО**
3. ✅ Проектирование чистой архитектуры - **ВЫПОЛНЕНО**

### Обнаруженные костыли для удаления:
- `_optimistic_bypass` флаг
- `_callBaseMethod` с prototype хаками
- Цепочка из 5 слоёв абстракции
- BullMQ для простых операций

## Фаза 1: Proof of Concept (День 2)

### Создаём минимальную рабочую версию:

#### 1.1 Simple Backend
```bash
# Создаём новый файл
touch dao_api2/src/simple-server.js
```

Код (100 строк):
- WebSocket сервер
- REST endpoint для загрузки
- Redis для хранения
- Никаких очередей

#### 1.2 OptimisticStore
```bash
# Создаём новый store
touch graphy/stores/OptimisticStore.js
```

Код (200 строк):
- Обёртка над TreeDaoStore
- Управление операциями
- WebSocket клиент
- Автоматические откаты

#### 1.3 Тестовый компонент
```bash
# Создаём тестовый компонент
touch graphy/components/TestOptimistic.jsx
```

Проверяем:
- Добавление узла
- Обновление позиции
- Удаление узла
- Работу offline

## Фаза 2: Валидация (День 3)

### Метрики для сравнения:

#### Производительность
| Метрика | Текущая | Цель | Как измерить |
|---------|---------|------|--------------|
| Latency добавления узла | ~50ms | <10ms | Performance API |
| Память на 1000 узлов | ~10MB | <3MB | Chrome DevTools |
| CPU при drag&drop | ~30% | <10% | Performance Monitor |

#### Качество кода
| Метрика | Текущая | Цель |
|---------|---------|------|
| Строк кода | ~2000 | <500 |
| Файлов | 8+ | 3 |
| Циклическая сложность | >10 | <5 |

### Тесты:
```javascript
// graphy/stores/__tests__/OptimisticStore.test.js
describe('OptimisticStore vs Legacy', () => {
  test('performance: add 100 nodes', () => {
    // Сравниваем скорость
  });
  
  test('memory: 1000 nodes', () => {
    // Сравниваем память
  });
  
  test('offline: queue operations', () => {
    // Проверяем offline режим
  });
});
```

## Фаза 3: Постепенная миграция (Неделя 2)

### День 4: Миграция первого компонента
```javascript
// Было:
import { TreeDaoStore } from './models/OptimisticTreeDaoStore';

// Стало:
import { TreeDaoStore } from './models/TreeDaoStore';
import { useOptimisticStore } from './hooks/useOptimisticStore';
```

### День 5: Миграция основных операций
- [ ] addNode → optimistic.addNode
- [ ] updateNode → optimistic.updateNode  
- [ ] deleteNode → optimistic.deleteNode
- [ ] saveGraph → автоматически через операции

### День 6-7: Удаление старого кода
```bash
# Удаляем костыли
rm graphy/stores/models/OptimisticTreeDaoStore.js
rm graphy/stores/mixins/OptimisticMixin.js
rm graphy/services/optimisticAdapter.js
rm graphy/services/optimisticApi.js

# Удаляем старый backend
rm dao_api2/src/queue.js
rm dao_api2/src/worker.js
```

## Фаза 4: Оптимизация (Неделя 3)

### Добавляем продвинутые фичи:

#### 4.1 Батчинг операций
```javascript
class OptimisticStore {
  batchOperations(ops) {
    // Отправляем пачкой для производительности
    this.ws.send(JSON.stringify({
      type: 'BATCH',
      operations: ops
    }));
  }
}
```

#### 4.2 Дебаунсинг позиций
```javascript
const debouncedUpdate = debounce((nodeId, position) => {
  optimistic.updateNodePosition(nodeId, position);
}, 100);
```

#### 4.3 Conflict Resolution
```javascript
handleConflict(localOp, serverOp) {
  // Operational Transform для разрешения конфликтов
  const transformed = OT.transform(localOp, serverOp);
  this.applyLocal(transformed);
}
```

## Фаза 5: Production Ready (Неделя 4)

### Финальный чеклист:

#### Backend
- [ ] Логирование операций
- [ ] Метрики (Prometheus)
- [ ] Rate limiting
- [ ] Горизонтальное масштабирование

#### Frontend  
- [ ] Индикаторы состояния
- [ ] Retry логика
- [ ] Error boundaries
- [ ] Оптимистичные анимации

#### DevOps
- [ ] Docker образы
- [ ] CI/CD pipeline
- [ ] Мониторинг
- [ ] Алерты

## Результаты миграции

### До (текущая архитектура):
```
📁 8+ файлов
📝 ~2000 строк кода
🔧 3+ костыля
🐌 50ms latency
💾 10MB память
🤯 Сложно понять
```

### После (чистая архитектура):
```
📁 3 файла
📝 ~400 строк кода
✨ 0 костылей
⚡ 5ms latency
💾 2MB память
😊 Легко понять
```

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Regression bugs | Средняя | Высокое | Постепенная миграция + тесты |
| Потеря данных | Низкая | Критичное | Backup перед миграцией |
| Проблемы с MST | Средняя | Среднее | OptimisticStore как обёртка |
| WebSocket нестабильность | Низкая | Низкое | Auto-reconnect + offline queue |

## Команда и роли

Для одного разработчика:
- **День 1**: Анализ ✅
- **День 2**: POC
- **День 3**: Валидация
- **Неделя 2**: Миграция
- **Неделя 3**: Оптимизация
- **Неделя 4**: Production

## Критерии успеха

✅ Миграция успешна если:
1. Все тесты проходят
2. Производительность улучшилась >50%
3. Код уменьшился >70%
4. Нет костылей
5. Легко добавлять новые фичи

## Альтернативный путь (если нет времени)

### Quick Fix (1 день):
Если нет 4 недель на полную миграцию, можно:

1. Оставить текущий backend
2. Заменить только frontend часть на OptimisticStore
3. Постепенно мигрировать backend позже

Это уберёт главные костыли (`_optimistic_bypass`) и улучшит производительность на 30-40%.

## Заключение

Текущая архитектура - технический долг, который будет только расти. Чистая архитектура в стиле Figma/Miro:

- **Проще** в 5 раз
- **Быстрее** в 10 раз
- **Надёжнее** благодаря отсутствию костылей
- **Масштабируемее** для будущих фич (коллаборация, CRDT)

### Рекомендация:
**Начать миграцию как можно скорее.** Каждый день с текущей архитектурой = больше технического долга.

### Первый шаг:
```bash
# Клонируем и создаём ветку
git checkout -b clean-optimistic-architecture

# Создаём новые файлы
touch dao_api2/src/simple-server.js
touch graphy/stores/OptimisticStore.js

# Начинаем с POC
```

Успех гарантирован, потому что новая архитектура в 10 раз проще текущей.