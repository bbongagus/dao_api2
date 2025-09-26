FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm ci --only=production

# Копируем исходный код
COPY src ./src
COPY .env* ./

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Переключаемся на пользователя nodejs
USER nodejs

# Открываем порты
EXPOSE 3000 8080

# Запускаем приложение
CMD ["npm", "start"]