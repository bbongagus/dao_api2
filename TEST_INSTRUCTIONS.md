# Инструкция по тестированию Optimistic UI Backend

## Проверка текущего состояния

### 1. Проверить что есть в Redis:
```bash
docker exec -it optimistic-redis-clean redis-cli GET graph:main
```

### 2. Проверить работу REST API:
```bash
curl http://localhost:3001/api/graphs/main
```

## Тестирование в браузере

### 1. Запустить Graphy frontend:
```bash
cd graphy
npm run dev
```

### 2. Открыть в браузере:
```
http://localhost:5173
```

### 3. Тесты:

#### Тест 1: Загрузка при старте
1. Перезагрузить страницу (F5)
2. **Ожидаемый результат:** Данные должны загрузиться из Redis

#### Тест 2: Синхронизация между вкладками
1. Открыть вторую вкладку с тем же URL
2. Создать ноду в первой вкладке
3. **Ожидаемый результат:** Нода появляется во второй вкладке мгновенно

#### Тест 3: Сохранение в Redis
1. Создать несколько нод и связей
2. Проверить Redis: `docker exec -it optimistic-redis-clean redis-cli GET graph:main`
3. **Ожидаемый результат:** Все созданные ноды есть в JSON

#### Тест 4: Восстановление после перезапуска
1. Создать граф с нодами
2. Перезапустить backend: `docker-compose restart backend`
3. Перезагрузить страницу
4. **Ожидаемый результат:** Граф восстанавливается

## Проверка логов

### Backend логи:
```bash
docker logs optimistic-backend-clean -f
```

### В консоли браузера искать:
- `✅ WebSocket connected`
- `📊 TreeDaoStore: Loading initial graph state`
- `📤 Operation sent via WebSocket`
- `🔄 Remote operation received`

## Возможные проблемы

### Если данные не загружаются при старте:
1. Проверить что WebSocket подключен (смотреть консоль браузера)
2. Проверить что в Redis есть данные
3. Проверить логи backend на наличие ошибок

### Если синхронизация не работает:
1. Проверить что обе вкладки подключены к WebSocket
2. Проверить логи на `Operation broadcasted to X clients`

## Сброс данных

### Очистить Redis:
```bash
docker exec -it optimistic-redis-clean redis-cli DEL graph:main
```

### Перезапустить все:
```bash
cd dao_api2
docker-compose down
docker-compose up -d