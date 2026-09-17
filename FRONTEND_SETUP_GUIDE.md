# Frontend Setup Guide - Подключение к Optimistic Backend

## 🚀 Быстрый старт

### 1. Запустите Backend в Docker

```bash
cd dao_api2
docker-compose up -d
```

Убедитесь что backend работает:
```bash
curl http://localhost:3001/health
```

### 2. Настройте Frontend переменные окружения

В папке `graphy` создайте или обновите файл `.env`:

```env
# API Configuration
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
VITE_GRAPH_ID=main
VITE_USER_ID=test-user-001
```

### 3. Запустите Frontend

```bash
cd graphy
npm install
npm run dev
```

Frontend будет доступен на http://localhost:5173

## 📋 Проверка интеграции

### 1. WebSocket соединение
- Откройте браузер на http://localhost:5173
- Откройте DevTools (F12) → Network → WS
- Должно быть активное WebSocket соединение к `ws://localhost:3001`
- В консоли должны быть сообщения о подключении

### 2. REST API
- При загрузке страницы должны загрузиться графы
- В Network → XHR должны быть запросы к `http://localhost:3001/api/graphs/main`

### 3. Аналитика и тренды
- Перейдите в Dashboard
- Выберите период (30d, 7d, today)
- Должны отображаться реальные тренды из backend

## 🔧 Конфигурация Frontend

### Файл: `graphy/config/settings.js`

```javascript
export const API_CONFIG = {
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  wsURL: import.meta.env.VITE_WS_URL || 'ws://localhost:3001',
  graphId: import.meta.env.VITE_GRAPH_ID || 'main',
  userId: import.meta.env.VITE_USER_ID || 'test-user-001'
};
```

### Файл: `graphy/services/api.js`

Уже настроен и использует правильные endpoints:
- REST: `http://localhost:3001/api/`
- WebSocket: `ws://localhost:3001`

### Файл: `graphy/services/websocket/WebSocketService.js`

WebSocket сервис уже интегрирован с Optimistic UI Store.

## 🎯 Основные функции для проверки

### 1. Создание и редактирование нод
- Создайте новую ноду
- Должна появиться мгновенно (optimistic update)
- Синхронизация с backend через WebSocket
- Откройте второй tab - изменения должны синхронизироваться

### 2. Прогресс и выполнение
- Отметьте ноду как выполненную
- Прогресс должен обновиться
- В Dashboard должны обновиться метрики

### 3. Исторические тренды
- Создайте снимок: 
```bash
curl -X POST http://localhost:3001/api/analytics/snapshot
```
- Подождите день или измените дату в системе
- Тренды покажут изменения

### 4. Daily Reset
- Включите daily reset в настройках
- На следующий день прогресс обнулится автоматически

## 📊 Dashboard и аналитика

### Endpoints используемые Dashboard:

1. **Основная аналитика**
```javascript
GET /api/analytics/main
```

2. **Категории**
```javascript
GET /api/analytics/categories/main
```

3. **Сравнение прогресса (тренды)**
```javascript
GET /api/analytics/progress-comparison?nodeIds=node1,node2&period=30
```

### Компоненты использующие backend:

- `DashboardNew.jsx` - основной dashboard
- `RecentActivityFocus.jsx` - тренды и прогресс
- `PeriodSelector.jsx` - выбор периода
- `EffortDistribution.jsx` - распределение усилий

## 🐛 Отладка

### Проверка WebSocket сообщений

В консоли браузера:
```javascript
// Проверить состояние WebSocket
window.wsService?.getConnectionState()

// Отправить тестовое сообщение
window.wsService?.send({ type: 'PING' })
```

### Проверка Store

```javascript
// Получить текущее состояние
window.rootStore?.toJSON()

// Проверить оптимистичные обновления
window.rootStore?.optimisticUI?.pendingOperations
```

### Логи Backend

```bash
# Все логи
docker-compose logs -f backend

# Только ошибки
docker-compose logs backend | grep "❌"

# WebSocket события
docker-compose logs backend | grep "📨"
```

## 🔄 Синхронизация между вкладками

1. Откройте приложение в двух вкладках
2. Создайте/измените ноду в одной вкладке
3. Изменения должны появиться во второй вкладке через WebSocket

## 🎨 Optimistic UI паттерн

Frontend использует Optimistic UI:
1. **Мгновенное обновление UI** при действии пользователя
2. **Отправка операции** на backend через WebSocket
3. **Получение подтверждения** от backend
4. **Синхронизация состояния** если есть конфликты

## 📝 Checklist интеграции

- [ ] Backend запущен в Docker
- [ ] Frontend подключен к backend (проверьте .env)
- [ ] WebSocket соединение активно
- [ ] REST API отвечает
- [ ] Графы загружаются при старте
- [ ] Изменения синхронизируются между вкладками
- [ ] Dashboard показывает реальные данные
- [ ] Тренды работают с выбором периода
- [ ] Снимки прогресса создаются ежедневно
- [ ] Daily reset работает (если включен)

## 🚨 Частые проблемы

### CORS ошибки
Убедитесь что backend использует правильные CORS настройки (уже настроено в simple-server.js)

### WebSocket не подключается
- Проверьте что порт 3001 открыт
- Проверьте URL в .env файле
- Убедитесь что backend запущен

### Данные не сохраняются
- Проверьте Redis: `docker-compose exec redis redis-cli ping`
- Проверьте логи: `docker-compose logs backend`

### Тренды показывают 0%
- Создайте снимок: `curl -X POST http://localhost:3001/api/analytics/snapshot`
- Подождите или создайте исторические данные

## 📚 Дополнительная документация

- [Архитектура Optimistic UI](./OPTIMISTIC_UI_ARCHITECTURE.md)
- [Руководство по миграции](./MIGRATION_PLAN.md)
- [API документация](./SIMPLE_ARCHITECTURE.md)
