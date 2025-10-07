# Streaming Analytics Setup Guide

## Prerequisites

1. **Redis должен быть запущен**:
```bash
# Если Redis не запущен, запустите его:
redis-server

# Или через Docker:
docker run -d -p 6379:6379 redis:latest
```

2. **Установить зависимости**:
```bash
cd dao_api2
npm install
```

## Запуск сервера

### Вариант 1: Локальный запуск
```bash
# В терминале 1: запустить сервер
cd dao_api2
npm start

# Дождитесь сообщения:
# ╔═══════════════════════════════════════╗
# ║   Optimistic UI Server (Figma Style)  ║
# ╠═══════════════════════════════════════╣
# ║   WebSocket: ws://localhost:3001      ║
# ║   REST API:  http://localhost:3001    ║
# ║   Redis:     localhost:6379           ║
# ╚═══════════════════════════════════════╝
# ✅ Progress Snapshots Service initialized
```

### Вариант 2: Docker запуск
```bash
cd dao_api2
docker-compose up -d
```

## Тестирование

После запуска сервера, в новом терминале:

```bash
# Запустить тесты снимков
cd dao_api2
npm run test:snapshots
```

### Ручное тестирование через curl

1. **Создать снимок**:
```bash
curl -X POST http://localhost:3001/api/analytics/snapshot
```

2. **Получить сравнение прогресса**:
```bash
# Сначала нужно получить ID узлов из графа
curl http://localhost:3001/api/graphs/main

# Затем запросить сравнение (замените node1,node2 на реальные ID)
curl "http://localhost:3001/api/analytics/progress-comparison?period=30d&nodeIds=node1,node2"
```

3. **Получить доступные снимки для узла**:
```bash
curl http://localhost:3001/api/analytics/snapshots/{nodeId}
```

## Troubleshooting

### Error: ECONNREFUSED
- Убедитесь, что сервер запущен (npm start)
- Проверьте, что порт 3001 не занят: `lsof -i :3001`

### Error: Redis connection failed
- Убедитесь, что Redis запущен
- Проверьте подключение: `redis-cli ping` (должен ответить PONG)

### Error: Cannot find module
- Убедитесь, что установлены все зависимости: `npm install`
- Если ошибка с ES6 модулями, проверьте что в package.json есть `"type": "module"`

### Error: Progress Snapshots Service not initialized
- Это может произойти в первые секунды после запуска сервера
- Подождите 5 секунд после запуска для инициализации

## Как работает система

1. **Автоматические снимки**: Каждый день в полночь создаются снимки прогресса всех узлов
2. **Ручные снимки**: Можно создать через API endpoint `/api/analytics/snapshot`
3. **Сравнение**: При запросе сравнения система ищет исторический снимок для заданного периода
4. **Хранение**: Данные хранятся в Redis Sorted Sets с TTL 90 дней

## Frontend интеграция

Dashboard автоматически использует API сравнения при переключении периодов:
- All time: тренды не показываются
- 30 days: сравнение с прогрессом 30 дней назад
- 7 days: сравнение с прогрессом 7 дней назад  
- Today: сравнение с вчерашним днем

## Мониторинг

Проверить работу снимков в Redis:
```bash
# Подключиться к Redis
redis-cli

# Посмотреть все ключи снимков
KEYS progress:daily:*

# Посмотреть снимки для конкретного узла
ZRANGE progress:daily:nodeId 0 -1 WITHSCORES