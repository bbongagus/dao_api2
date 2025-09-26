import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Создаем HTTP сервер для WebSocket
const server = createServer();
const wss = new WebSocketServer({ server });

// Хранилище клиентов
const clients = new Map();
let clientIdCounter = 0;

// Обработка подключений
wss.on('connection', (ws, req) => {
  const clientId = ++clientIdCounter;
  const clientInfo = {
    id: clientId,
    ws,
    graphId: null,
    isAlive: true
  };
  
  clients.set(clientId, clientInfo);
  console.log(`👤 Client ${clientId} connected (Total: ${clients.size})`);
  
  // Отправляем приветствие
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    clientId,
    message: 'Connected to Optimistic UI WebSocket'
  }));
  
  // Обработка сообщений от клиента
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch(data.type) {
        case 'SUBSCRIBE':
          // Клиент подписывается на граф
          clientInfo.graphId = data.graphId;
          console.log(`📡 Client ${clientId} subscribed to graph ${data.graphId}`);
          ws.send(JSON.stringify({
            type: 'SUBSCRIBED',
            graphId: data.graphId
          }));
          break;
          
        case 'PING':
          // Heartbeat
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
          
        default:
          console.log(`📨 Message from client ${clientId}:`, data);
      }
    } catch (error) {
      console.error(`❌ Error processing message from client ${clientId}:`, error);
    }
  });
  
  // Обработка pong для проверки соединения
  ws.on('pong', () => {
    clientInfo.isAlive = true;
  });
  
  // Обработка закрытия соединения
  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`👋 Client ${clientId} disconnected (Total: ${clients.size})`);
  });
  
  // Обработка ошибок
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for client ${clientId}:`, error);
  });
});

// Функция для отправки обновлений всем клиентам
export function broadcast(data) {
  const message = JSON.stringify({
    ...data,
    timestamp: Date.now()
  });
  
  let sent = 0;
  clients.forEach((client) => {
    // Отправляем только если клиент подписан на этот граф
    if (!data.graphId || client.graphId === data.graphId) {
      if (client.ws.readyState === 1) { // OPEN
        client.ws.send(message);
        sent++;
      }
    }
  });
  
  console.log(`📢 Broadcasted to ${sent} clients: ${data.type}`);
}

// Функция для отправки конкретному клиенту
export function sendToClient(clientId, data) {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// Проверка живых соединений каждые 30 секунд
const heartbeatInterval = setInterval(() => {
  clients.forEach((client) => {
    if (client.isAlive === false) {
      console.log(`💀 Terminating inactive client ${client.id}`);
      client.ws.terminate();
      clients.delete(client.id);
      return;
    }
    
    client.isAlive = false;
    client.ws.ping();
  });
}, 30000);

// Запуск WebSocket сервера
export function startWebSocketServer(port = 8080) {
  server.listen(port, () => {
    console.log(`🌐 WebSocket server listening on port ${port}`);
  });
}

// Остановка сервера
export function stopWebSocketServer() {
  clearInterval(heartbeatInterval);
  
  // Закрываем все соединения
  clients.forEach((client) => {
    client.ws.close(1001, 'Server shutting down');
  });
  clients.clear();
  
  // Закрываем сервер
  server.close(() => {
    console.log('🛑 WebSocket server stopped');
  });
}

// Экспорт для использования в других модулях
export default {
  broadcast,
  sendToClient,
  startWebSocketServer,
  stopWebSocketServer,
  getClientsCount: () => clients.size
};