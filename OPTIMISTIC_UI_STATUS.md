# Optimistic UI Backend - Текущий статус

## ✅ Что работает

### Backend (порт 3001)
- **REST API**: Полностью функционален
  - `/health` - проверка здоровья сервера
  - `/api/users/:userId` - получение информации о пользователе
  - `/api/users/:userId/graphs` - список графов пользователя
  - `/api/graphs/:graphId` - загрузка/сохранение графов
  
- **WebSocket**: Работает для real-time операций
  - Подключение клиентов
  - Подписка на графы
  - Обработка optimistic операций
  - Broadcasting изменений другим клиентам

- **Redis**: Используется как единственный источник правды
  - Хранение графов
  - Версионирование
  - Быстрый доступ к данным

### Архитектура
- **Чистая реализация в стиле Figma/Miro**
  - Простой WebSocket сервер (309 строк кода)
  - Прямые операции с Redis
  - Без BullMQ и лишних абстракций
  - Event-driven подход

## 🔧 Конфигурация

### Docker контейнеры
```bash
# Запущены и работают:
- optimistic-backend-clean (порт 3001)
- optimistic-redis-clean (порт 6379)
```

### Frontend настройки
- `graphy/services/api.js` - настроен на порт 3001
- `graphy/services/graphApi.js` - настроен на порт 3001
- WebSocket URL: `ws://localhost:3001`

## 📊 Тестирование

### Тестовая страница
Открыта в браузере: `graphy/test-optimistic.html`

Позволяет тестировать:
- REST API endpoints
- WebSocket подключение
- Optimistic операции (ADD_NODE, UPDATE_NODE, DELETE_NODE)
- Real-time синхронизацию

### Проверенные операции
- ✅ Health check
- ✅ User API 
- ✅ WebSocket подключение
- ✅ Отправка операций
- ✅ Broadcasting изменений

## 🚀 Как использовать

### 1. Убедитесь, что контейнеры запущены
```bash
cd dao_api2
docker-compose -f docker-compose.clean.yml ps
```

### 2. Проверьте здоровье сервера
```bash
curl http://localhost:3001/health
```

### 3. Откройте тестовую страницу
```bash
open graphy/test-optimistic.html
```

### 4. В браузере:
1. Нажмите "Connect WebSocket" для подключения
2. Нажмите "Subscribe" для подписки на граф
3. Используйте кнопки для операций с нодами
4. Наблюдайте логи в правой панели

## 📝 Примеры использования

### REST API
```javascript
// Получить граф
fetch('http://localhost:3001/api/graphs/main')
  .then(res => res.json())
  .then(data => console.log(data));

// Сохранить граф
fetch('http://localhost:3001/api/graphs/main', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nodes: [...],
    edges: [...],
    viewport: { x: 0, y: 0, zoom: 1 }
  })
});
```

### WebSocket операции
```javascript
const ws = new WebSocket('ws://localhost:3001');

// Подписка на граф
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  graphId: 'main'
}));

// Добавить ноду (optimistic)
ws.send(JSON.stringify({
  type: 'OPERATION',
  graphId: 'main',
  operation: {
    id: 'op_1',
    type: 'ADD_NODE',
    payload: {
      id: 'node_123',
      title: 'New Node',
      position: { x: 100, y: 100 }
    }
  }
}));
```

## 🎯 Следующие шаги

### Интеграция с основным приложением Graphy
1. Подключить OptimisticStore к TreeDaoStore
2. Заменить старые API вызовы на новые
3. Добавить WebSocket listeners в компоненты
4. Реализовать offline mode с queue

### Улучшения
- [ ] Добавить авторизацию и сессии
- [ ] Реализовать conflict resolution при одновременных изменениях
- [ ] Добавить метрики и мониторинг
- [ ] Оптимизировать broadcasting для больших графов
- [ ] Добавить поддержку файловых attachments

## 🔍 Отладка

### Логи backend
```bash
docker-compose -f docker-compose.clean.yml logs -f backend
```

### Логи Redis
```bash
docker-compose -f docker-compose.clean.yml exec redis redis-cli MONITOR
```

### Проверка данных в Redis
```bash
docker-compose -f docker-compose.clean.yml exec redis redis-cli
> KEYS graph:*
> GET graph:main
```

## ⚠️ Известные проблемы

1. **CORS**: Может потребоваться настройка для production
2. **Авторизация**: Пока отсутствует, все операции доступны всем
3. **Размер графов**: Большие графы могут замедлить broadcasting

## 📚 Документация

- [Архитектура](./SIMPLE_ARCHITECTURE.md)
- [План миграции](./CLEAN_MIGRATION_ROADMAP.md)
- [Руководство по тестированию](./CLEAN_TESTING_GUIDE.md)
- [Сравнение архитектур](./ARCHITECTURE_COMPARISON.md)

---

**Статус**: ✅ Optimistic UI Backend полностью функционален и готов к интеграции