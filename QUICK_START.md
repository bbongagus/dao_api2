# 🚀 Quick Start - Optimistic UI Backend

## Запуск системы

### 1. Запустите Docker контейнеры
```bash
cd dao_api2
docker-compose up -d
```

### 2. Проверьте статус
```bash
docker-compose ps
```

Должны работать:
- `optimistic-backend` на порту 3001
- `optimistic-redis` на порту 6379

### 3. Запустите фронтенд
```bash
cd ../graphy
npm run dev
```

## Тестирование функций

### ✅ Real-time синхронизация
1. Откройте приложение в 2+ вкладках браузера
2. Создайте/измените ноду в одной вкладке
3. Изменения мгновенно появятся в других вкладках

### ✅ Сохранение иерархии
1. Создайте родительскую ноду (нажмите 'd')
2. Дважды кликните на ноду чтобы войти внутрь
3. Создайте дочернюю ноду (нажмите 'd')
4. Обновите страницу (F5)
5. Иерархия должна сохраниться

### ✅ Прогресс трекинг
1. Кликните на DAO ноду чтобы отметить как выполненную
2. Прогресс сохраняется и синхронизируется
3. Daily reset работает автоматически (если включен в настройках)

### ✅ Индикатор соединения
- 🟢 Зеленый = подключено к WebSocket
- 🔴 Красный = нет соединения
- Автоматическое переподключение при потере связи

## Управление данными

### Очистить все данные
```bash
docker exec -it optimistic-redis redis-cli FLUSHALL
```

### Просмотреть данные в Redis
```bash
docker exec -it optimistic-redis redis-cli
GET graph:main
exit
```

### Просмотреть логи сервера
```bash
docker logs -f optimistic-backend --tail 50
```

## Остановка системы

```bash
cd dao_api2
docker-compose down
```

## Проблемы и решения

### Проблема: Контейнеры не запускаются
```bash
# Пересоздать контейнеры
docker-compose down
docker-compose up --build -d
```

### Проблема: Порты заняты
```bash
# Проверить занятые порты
lsof -i :3001
lsof -i :6379

# Убить процессы или изменить порты в docker-compose.yml
```

### Проблема: Нет соединения с WebSocket
1. Проверьте что backend запущен: `docker-compose ps`
2. Проверьте логи: `docker logs optimistic-backend`
3. Проверьте консоль браузера (F12)

## Архитектура

```
Frontend (Graphy)          Backend (Node.js)         Storage (Redis)
     |                           |                        |
     |-- WebSocket ADD_NODE ---->|                        |
     |-- WebSocket UPDATE_NODE ->|----> Save to Redis --->|
     |                           |                        |
     |<-- Operation broadcast ---|<---- Load from Redis --|
     |                           |                        |
```

## Ключевые файлы

### Backend
- `dao_api2/src/simple-server.js` - основной сервер
- `dao_api2/docker-compose.yml` - Docker конфигурация

### Frontend интеграция
- `graphy/stores/models/TreeDaoStore.js` - главное хранилище
- `graphy/stores/mixins/OptimisticIntegration.js` - WebSocket клиент
- `graphy/services/websocket/WebSocketService.js` - WebSocket сервис

## Документация

- `SIMPLE_ARCHITECTURE.md` - Архитектура системы
- `HIERARCHY_SOLUTION.md` - Решение проблемы с иерархией
- `TEST_HIERARCHY.md` - Детальное тестирование иерархии
- `IMPLEMENTATION_GUIDE.md` - Руководство по реализации

## Поддержка

При возникновении проблем:
1. Проверьте логи Docker контейнеров
2. Проверьте консоль браузера
3. Убедитесь что все порты свободны
4. Попробуйте очистить Redis и начать заново

---
*Optimistic UI Backend v1.0 - Simple, Fast, Reliable*