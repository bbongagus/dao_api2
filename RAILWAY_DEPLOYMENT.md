# 🚂 Railway Deployment Guide

Полное руководство по развертыванию DAO API Backend на Railway.

## 🎯 Почему Railway?

- ✅ **Полная поддержка WebSocket** - работают все функции real-time синхронизации
- ✅ **Встроенный Redis** - не нужны внешние сервисы
- ✅ **Простой деплой** - подключаете GitHub и все работает
- ✅ **Автоматические переменные** - Railway сам настроит Redis URL
- ✅ **Бесплатный тариф** - $5 кредитов в месяц, достаточно для разработки
- ✅ **Мгновенный деплой** - изменения в GitHub автоматически деплоятся

## 📋 Что вам понадобится

1. **Аккаунт на Railway**: [railway.app](https://railway.app)
2. **GitHub репозиторий** с вашим кодом
3. **5-10 минут** времени

## 🚀 Пошаговая инструкция

### Шаг 1: Создание проекта на Railway

1. Откройте [railway.app](https://railway.app)
2. Нажмите **"Start a New Project"**
3. Выберите **"Deploy from GitHub repo"**
4. Авторизуйте Railway для доступа к вашим репозиториям
5. Выберите репозиторий `dao_api2`

### Шаг 2: Добавление Redis

1. В вашем проекте нажмите **"+ New"**
2. Выберите **"Database"**
3. Выберите **"Add Redis"**
4. Railway автоматически создаст Redis и добавит переменные:
   - `REDIS_URL` - публичный URL
   - `REDIS_PRIVATE_URL` - внутренний URL (используйте его)

### Шаг 3: Настройка переменных окружения

В настройках вашего сервиса добавьте следующие переменные:

#### Обязательные переменные:

```bash
# PORT будет установлен Railway автоматически
NODE_ENV=production

# CORS Origins - добавьте URL вашего фронтенда
CORS_ORIGINS=https://your-frontend.vercel.app,https://your-domain.com
```

#### Опциональные переменные:

```bash
# Только если используете AI Planning
OPENAI_API_KEY=sk-...your-key-here
```

**Важно**: 
- `REDIS_URL` и `REDIS_PRIVATE_URL` добавятся автоматически при добавлении Redis
- `PORT` устанавливается Railway автоматически
- Используйте `REDIS_PRIVATE_URL` для лучшей производительности

### Шаг 4: Конфигурация деплоя

Railway автоматически определит настройки из файлов:

- ✅ [`package.json`](./package.json) - определяет Node.js версию и зависимости
- ✅ [`Procfile`](./Procfile) - команда запуска: `node src/simple-server.js`
- ✅ [`railway.json`](./railway.json) - дополнительные настройки

Ничего менять не нужно - все уже настроено!

### Шаг 5: Деплой

1. Railway автоматически начнет первый деплой
2. Следите за логами в реальном времени
3. После завершения деплоя вы получите URL типа:
   ```
   https://dao-api2-production.up.railway.app
   ```

### Шаг 6: Проверка работоспособности

#### 1. Health Check
```bash
curl https://your-app.up.railway.app/health
```

Ожидаемый ответ:
```json
{
  "status": "healthy",
  "redis": true,
  "websocket": 0,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### 2. API Test
```bash
curl https://your-app.up.railway.app/api/graphs/main
```

#### 3. WebSocket Test
```javascript
const ws = new WebSocket('wss://your-app.up.railway.app');
ws.onopen = () => console.log('✅ WebSocket connected');
```

## 🔧 Настройка автодеплоя

Railway автоматически деплоит изменения из вашей главной ветки:

1. Сделайте изменения в коде
2. Закоммитьте и запушьте в GitHub
3. Railway автоматически обнаружит изменения и задеплоит их
4. Следите за процессом в Dashboard

### Настройка Branch Deployments

Можно деплоить разные ветки:

1. В настройках проекта выберите **"Settings"**
2. Раздел **"Environments"**
3. Добавьте новый Environment для другой ветки (например, `develop`)
4. Настройте отдельные переменные для этого окружения

## 🌐 Настройка кастомного домена

1. Перейдите в **"Settings"** вашего сервиса
2. Раздел **"Domains"**
3. Нажмите **"Generate Domain"** - получите бесплатный `.up.railway.app` домен
4. Или добавьте свой домен:
   - Нажмите **"Custom Domain"**
   - Введите ваш домен (например, `api.yourdomain.com`)
   - Добавьте CNAME запись в DNS вашего домена

### Пример DNS настройки:

```
Type:  CNAME
Name:  api (или ваш субдомен)
Value: your-app.up.railway.app
TTL:   3600
```

## 🔐 Безопасность

### Environment Variables

Все чувствительные данные храните в переменных окружения:

```bash
# ❌ НЕ ХРАНИТЕ API ключи в коде
const apiKey = 'sk-1234567890';

# ✅ Используйте переменные окружения
const apiKey = process.env.OPENAI_API_KEY;
```

### CORS Configuration

Всегда указывайте конкретные домены в `CORS_ORIGINS`:

```bash
# ❌ Плохо - разрешает любой домен
CORS_ORIGINS=*

# ✅ Хорошо - только разрешенные домены
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

## 📊 Мониторинг и логи

### Просмотр логов

1. Откройте ваш проект в Railway
2. Перейдите в раздел **"Deployments"**
3. Выберите активный деплой
4. Раздел **"Logs"** - здесь вы увидите все логи в реальном времени

### Метрики

Railway показывает:
- 💾 **Memory Usage** - использование памяти
- 📈 **CPU Usage** - загрузка процессора
- 🌐 **Network** - входящий/исходящий трафик
- ⏱️ **Response Times** - время ответа

### Алерты

Настройте уведомления в Discord/Slack:

1. **Settings** → **Webhooks**
2. Добавьте webhook URL
3. Выберите события для уведомлений

## 💰 Тарифы и лимиты

### Бесплатный тариф (Starter)

- 💵 **$5 кредитов в месяц** (около 500 часов работы)
- 🔌 **512MB RAM**
- 💾 **1GB Disk**
- 🌐 **100GB Transfer**

### Расчет стоимости

```
CPU: $0.000463/min = ~$20/месяц при 100% загрузке
RAM: $0.000231/MB/min = ~$7.70/месяц для 512MB

Обычно для API: $2-5/месяц
```

### Оптимизация расходов

1. **Используйте Horizontal Scaling** только если нужно
2. **Настройте Sleep** для dev окружений (не используется → выключается)
3. **Мониторьте** использование ресурсов
4. **Очищайте** неиспользуемые окружения

## 🐛 Решение проблем

### Redis не подключается

```bash
# Проверьте переменные
echo $REDIS_PRIVATE_URL

# Проверьте логи
# Railway Dashboard → Logs → найдите "Redis connection error"
```

**Решение:**
1. Убедитесь что Redis сервис запущен
2. Проверьте что `REDIS_PRIVATE_URL` установлена автоматически
3. Используйте `REDIS_PRIVATE_URL` вместо `REDIS_URL` для внутренних соединений

### WebSocket не работает

**Проверка:**
```javascript
const ws = new WebSocket('wss://your-app.up.railway.app');
// Обратите внимание на wss:// (не ws://)
```

**Решение:**
1. Всегда используйте `wss://` (защищенный WebSocket) для production
2. Проверьте CORS настройки
3. Убедитесь что порт не указан в URL

### Application Crash

**Где смотреть:**
1. Railway Dashboard → Deployments → View Logs
2. Найдите строки с `Error` или `❌`

**Частые причины:**
- Missing environment variables
- Redis connection timeout
- Port already in use (Railway управляет портом автоматически)

### Медленный Cold Start

**Причина:** Railway "засыпает" неактивные сервисы после 5 минут простоя

**Решение:**
1. Upgrade на **Developer Plan** ($5/месяц) - без sleep
2. Используйте **Health Check Pings** каждые 4 минуты
3. Настройте **Cron Job** для keep-alive запросов

### Превышен лимит памяти

**Проверка:**
```bash
# В логах ищите: "Out of memory" или "SIGKILL"
```

**Решение:**
1. Оптимизируйте Redis queries
2. Добавьте `maxRetriesPerRequest` в Redis config
3. Upgrade на план с большей памятью

## 🔄 CI/CD и автоматизация

### GitHub Actions Integration

Railway автоматически деплоит из GitHub, но вы можете добавить дополнительные проверки:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```

### Railway CLI

Для локального управления установите CLI:

```bash
# Установка
npm i -g @railway/cli

# Авторизация
railway login

# Связать проект
railway link

# Посмотреть логи
railway logs

# Выполнить команду в production
railway run node scripts/migrate.js

# Открыть проект
railway open
```

## 📱 Подключение фронтенда

### Обновите конфигурацию фронтенда

```javascript
// frontend/src/config.js
const API_URL = import.meta.env.PROD 
  ? 'https://your-app.up.railway.app'
  : 'http://localhost:3001';

const WS_URL = import.meta.env.PROD
  ? 'wss://your-app.up.railway.app'
  : 'ws://localhost:3001';

export { API_URL, WS_URL };
```

### CORS настройка

Не забудьте добавить URL вашего фронтенда в Railway переменные:

```bash
CORS_ORIGINS=https://your-frontend.vercel.app
```

## 🎓 Best Practices

1. **Используйте переменные окружения** для всех конфигураций
2. **Настройте health check** endpoint для мониторинга
3. **Логируйте важные события** но не спамьте
4. **Используйте REDIS_PRIVATE_URL** для внутренних соединений
5. **Настройте alerts** для критических ошибок
6. **Регулярно проверяйте** метрики использования
7. **Документируйте** изменения в deployment

## 🆘 Поддержка

- 📖 **Railway Docs**: [docs.railway.app](https://docs.railway.app)
- 💬 **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
- 🐛 **GitHub Issues**: для багов в коде
- 🎫 **Railway Help**: для проблем с платформой

## 📚 Дополнительные ресурсы

- [Railway Templates](https://railway.app/templates)
- [Railway Blog](https://blog.railway.app)
- [Railway Status](https://status.railway.app)
- [Railway Pricing Calculator](https://railway.app/pricing)

## ✅ Checklist перед деплоем

- [ ] Все переменные окружения настроены
- [ ] Redis подключен и работает
- [ ] CORS настроен с правильными доменами
- [ ] Health check endpoint отвечает
- [ ] WebSocket тест проходит успешно
- [ ] Логи не показывают критических ошибок
- [ ] Фронтенд подключен к правильному URL
- [ ] Кастомный домен настроен (если нужно)
- [ ] Мониторинг и алерты настроены
- [ ] Документация обновлена

---

**Готово!** 🎉 Ваш backend теперь работает на Railway с полной поддержкой WebSocket и Redis!