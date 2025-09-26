#!/bin/bash

# Clean Optimistic Backend Startup Script
# Простой запуск без сложностей

echo "🧹 Clean Optimistic Backend Launcher"
echo "===================================="
echo ""

# Проверяем Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed!"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Проверяем Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed!"
    echo "Please install Docker Compose first"
    exit 1
fi

# Останавливаем старые контейнеры (если есть)
echo "🛑 Stopping old containers..."
docker-compose -f docker-compose.yml down 2>/dev/null
docker-compose -f docker-compose.clean.yml down 2>/dev/null

# Запускаем чистую версию
echo ""
echo "🚀 Starting Clean Optimistic Backend..."
echo ""

docker-compose -f docker-compose.clean.yml up --build -d

# Ждём запуска
echo ""
echo "⏳ Waiting for services to start..."
sleep 3

# Проверяем здоровье
echo ""
echo "🔍 Checking health..."
curl -s http://localhost:3001/health | python3 -m json.tool || echo "⚠️ Backend not ready yet"

echo ""
echo "✅ Clean Optimistic Backend is running!"
echo ""
echo "📡 API:       http://localhost:3001"
echo "🌐 WebSocket: ws://localhost:3001"
echo "💚 Health:    http://localhost:3001/health"
echo "📊 Redis:     localhost:6379"
echo ""
echo "📝 Logs: docker-compose -f docker-compose.clean.yml logs -f"
echo "🛑 Stop: docker-compose -f docker-compose.clean.yml down"
echo ""
echo "This clean implementation:"
echo "  ✅ No BullMQ queues"
echo "  ✅ No complex workers"
echo "  ✅ Simple WebSocket"
echo "  ✅ Direct Redis operations"
echo "  ✅ ~400 lines of code total"