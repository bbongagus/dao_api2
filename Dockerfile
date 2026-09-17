FROM node:22-alpine

WORKDIR /app

# Устанавливаем curl для healthcheck
RUN apk add --no-cache curl

# Копируем package.json и устанавливаем зависимости
# ВАЖНО: package.json содержит "type": "module" для ES6
COPY package*.json ./
RUN npm ci --only=production

# Копируем исходный код
COPY src ./src

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Переключаемся на пользователя nodejs
USER nodejs

# Открываем правильный порт (соответствует docker-compose.yml)
EXPOSE 3001

# The server refuses a dev key under NODE_ENV=production. The image sets it
# itself: that refusal must not depend on a variable the platform may not set.
ENV NODE_ENV=production

# Запускаем приложение (новый рефакторенный сервер)
# Используем node напрямую для ES6 модулей
CMD ["node", "src/server.js"]