/**
 * Optimistic API Client for Graphy Frontend
 * Простой клиент для работы с Optimistic UI backend
 */

class OptimisticAPI {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'http://localhost:3000/api';
    this.wsUrl = config.wsUrl || 'ws://localhost:8080';
    this.graphId = config.graphId || 'main';
    this.ws = null;
    this.pendingOperations = new Map();
    this.onUpdate = null;
    this.onError = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = null;
  }

  // Подключение к WebSocket
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
        
        this.ws.onopen = () => {
          console.log('✅ WebSocket connected');
          this.reconnectAttempts = 0;
          
          // Подписываемся на граф
          this.ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            graphId: this.graphId
          }));
          
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          reject(error);
        };
        
        this.ws.onclose = () => {
          console.log('🔌 WebSocket disconnected');
          this.handleDisconnect();
        };
        
        // Heartbeat
        this.heartbeatInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 30000);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  // Обработка сообщений от WebSocket
  handleWebSocketMessage(message) {
    console.log('📨 WebSocket message:', message);
    
    switch(message.type) {
      case 'CONNECTED':
      case 'SUBSCRIBED':
      case 'PONG':
        // Служебные сообщения
        break;
        
      case 'COMMAND_EXECUTED':
        this.handleCommandExecuted(message);
        break;
        
      case 'COMMAND_FAILED':
        this.handleCommandFailed(message);
        break;
        
      default:
        if (this.onUpdate) {
          this.onUpdate(message);
        }
    }
  }

  // Обработка успешного выполнения команды
  handleCommandExecuted(message) {
    const { jobId, result, version } = message;
    
    // Удаляем из pending
    const operation = this.pendingOperations.get(jobId);
    if (operation) {
      this.pendingOperations.delete(jobId);
      console.log(`✅ Operation ${jobId} confirmed`);
    }
    
    // Вызываем callback
    if (this.onUpdate) {
      this.onUpdate({
        type: 'CONFIRMED',
        ...message
      });
    }
  }

  // Обработка ошибки команды
  handleCommandFailed(message) {
    const { jobId, error } = message;
    
    // Удаляем из pending
    const operation = this.pendingOperations.get(jobId);
    if (operation) {
      this.pendingOperations.delete(jobId);
      console.error(`❌ Operation ${jobId} failed:`, error);
      
      // Нужно откатить optimistic update
      if (this.onError) {
        this.onError({
          type: 'REVERT',
          operation,
          error
        });
      }
    }
  }

  // Обработка отключения
  handleDisconnect() {
    clearInterval(this.heartbeatInterval);
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      this.reconnectTimeout = setTimeout(() => {
        this.connect().catch(console.error);
      }, delay);
    } else {
      console.error('❌ Max reconnection attempts reached');
    }
  }

  // Отключение
  disconnect() {
    clearInterval(this.heartbeatInterval);
    clearTimeout(this.reconnectTimeout);
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ===== API методы =====

  // Загрузить граф
  async loadGraph() {
    const response = await fetch(`${this.apiUrl}/graphs/${this.graphId}`);
    if (!response.ok) {
      throw new Error(`Failed to load graph: ${response.statusText}`);
    }
    return response.json();
  }

  // Сохранить весь граф
  async saveGraph(graphData) {
    const response = await fetch(`${this.apiUrl}/graphs/${this.graphId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphData)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save graph: ${response.statusText}`);
    }
    return response.json();
  }

  // Выполнить команду (optimistic)
  async executeCommand(type, payload) {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const response = await fetch(`${this.apiUrl}/graphs/${this.graphId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          payload,
          operationId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Command failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Сохраняем в pending
      this.pendingOperations.set(result.jobId, {
        type,
        payload,
        operationId,
        timestamp: Date.now()
      });
      
      return result;
      
    } catch (error) {
      console.error(`Failed to execute command ${type}:`, error);
      throw error;
    }
  }

  // ===== Удобные методы для операций =====

  async addNode(node) {
    // Генерируем временный ID если нужно
    if (!node.id && !node.nodeId) {
      node.id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      node.isOptimistic = true;
    }
    
    const result = await this.executeCommand('ADD_NODE', node);
    return { ...node, ...result };
  }

  async updateNode(nodeId, updates) {
    return this.executeCommand('UPDATE_NODE', {
      nodeId,
      updates
    });
  }

  async updateNodePosition(nodeId, position) {
    return this.executeCommand('UPDATE_NODE_POSITION', {
      nodeId,
      position
    });
  }

  async deleteNode(nodeId) {
    return this.executeCommand('DELETE_NODE', {
      nodeId
    });
  }

  async addEdge(edge) {
    // Генерируем временный ID если нужно
    if (!edge.id && !edge.edgeId) {
      edge.id = `temp_edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      edge.isOptimistic = true;
    }
    
    const result = await this.executeCommand('ADD_EDGE', edge);
    return { ...edge, ...result };
  }

  async deleteEdge(edgeId) {
    return this.executeCommand('DELETE_EDGE', {
      edgeId
    });
  }

  async updateViewport(viewport) {
    return this.executeCommand('UPDATE_VIEWPORT', viewport);
  }

  async batchUpdate(updates) {
    return this.executeCommand('BATCH_UPDATE', updates);
  }

  // Проверить статус операции
  async checkOperationStatus(jobId) {
    const response = await fetch(`${this.apiUrl}/operations/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to check operation status: ${response.statusText}`);
    }
    return response.json();
  }
}

// Экспорт для использования
export default OptimisticAPI;

// Создание singleton экземпляра
export const optimisticAPI = new OptimisticAPI();