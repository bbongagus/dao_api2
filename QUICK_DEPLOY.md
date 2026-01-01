# 🚀 Быстрый деплой на Railway

## Шаги (5 минут)

### 1. Создайте проект на Railway
- Откройте [railway.app](https://railway.app)
- Нажмите "Start a New Project"
- Выберите "Deploy from GitHub repo"
- Выберите репозиторий `dao_api2`

### 2. Добавьте Redis
- В проекте нажмите "+ New"
- Выберите "Database" → "Add Redis"
- Railway автоматически создаст `REDIS_PRIVATE_URL`

### 3. Настройте переменные
Добавьте только эти переменные (остальные автоматические):

```bash
NODE_ENV=production
CORS_ORIGINS=https://your-frontend.vercel.app
```

Опционально (только если используете):
```bash
OPENAI_API_KEY=sk-your-key
```

### 4. Деплой
Railway автоматически задеплоит ваш код!

### 5. Получите URL
После деплоя вы получите URL типа:
```
https://dao-api2-production.up.railway.app
```

### 6. Проверьте
```bash
curl https://your-app.up.railway.app/health
```

## Готово! 🎉

**WebSocket:** `wss://your-app.up.railway.app`  
**REST API:** `https://your-app.up.railway.app/api`  
**Redis:** Работает автоматически

---

📖 Подробная инструкция: [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md)