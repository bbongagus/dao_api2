import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Подключение к Redis
export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

// Простые операции с графом
export const graphOps = {
  // Сохранить состояние графа
  async saveGraph(graphId, data) {
    const key = `graph:${graphId}`;
    await redis.set(key, JSON.stringify(data));
    const version = await redis.incr(`${key}:version`);
    console.log(`📝 Graph ${graphId} saved, version: ${version}`);
    return version;
  },

  // Получить граф
  async getGraph(graphId) {
    const data = await redis.get(`graph:${graphId}`);
    if (!data) {
      console.log(`📭 Graph ${graphId} not found, returning empty`);
      return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    }
    return JSON.parse(data);
  },

  // Получить версию графа
  async getVersion(graphId) {
    const version = await redis.get(`graph:${graphId}:version`);
    return parseInt(version) || 0;
  },

  // Обновить узел
  async updateNode(graphId, nodeId, updates) {
    const graph = await this.getGraph(graphId);
    const node = graph.nodes.find(n => n.id === nodeId || n.nodeId === nodeId);
    
    if (node) {
      Object.assign(node, updates);
      await this.saveGraph(graphId, graph);
      console.log(`✏️ Node ${nodeId} updated`);
      return node;
    }
    
    console.warn(`⚠️ Node ${nodeId} not found`);
    return null;
  },

  // Добавить узел
  async addNode(graphId, node) {
    const graph = await this.getGraph(graphId);
    
    // Генерируем ID если нет
    if (!node.id && !node.nodeId) {
      node.id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    graph.nodes.push(node);
    await this.saveGraph(graphId, graph);
    console.log(`➕ Node ${node.id || node.nodeId} added`);
    return node;
  },

  // Удалить узел
  async deleteNode(graphId, nodeId) {
    const graph = await this.getGraph(graphId);
    
    // Удаляем узел
    const originalLength = graph.nodes.length;
    graph.nodes = graph.nodes.filter(n => n.id !== nodeId && n.nodeId !== nodeId);
    
    // Удаляем связанные рёбра
    graph.edges = graph.edges.filter(e => 
      e.source !== nodeId && e.target !== nodeId &&
      e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
    );
    
    await this.saveGraph(graphId, graph);
    
    const deletedCount = originalLength - graph.nodes.length;
    console.log(`🗑️ Node ${nodeId} deleted (${deletedCount} nodes removed)`);
    
    return { deleted: nodeId, nodesDeleted: deletedCount };
  },

  // Добавить ребро
  async addEdge(graphId, edge) {
    const graph = await this.getGraph(graphId);
    
    // Генерируем ID если нет
    if (!edge.id && !edge.edgeId) {
      edge.id = `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    graph.edges = graph.edges || [];
    graph.edges.push(edge);
    await this.saveGraph(graphId, graph);
    console.log(`🔗 Edge ${edge.id || edge.edgeId} added`);
    return edge;
  },

  // Удалить ребро
  async deleteEdge(graphId, edgeId) {
    const graph = await this.getGraph(graphId);
    
    graph.edges = graph.edges.filter(e => e.id !== edgeId && e.edgeId !== edgeId);
    await this.saveGraph(graphId, graph);
    console.log(`✂️ Edge ${edgeId} deleted`);
    
    return { deleted: edgeId };
  },

  // Обновить viewport
  async updateViewport(graphId, viewport) {
    const graph = await this.getGraph(graphId);
    graph.viewport = viewport;
    await this.saveGraph(graphId, graph);
    console.log(`📍 Viewport updated for graph ${graphId}`);
    return viewport;
  },

  // Batch update - обновить несколько узлов сразу
  async batchUpdate(graphId, updates) {
    const graph = await this.getGraph(graphId);
    let updatedCount = 0;

    if (updates.nodes) {
      updates.nodes.forEach(update => {
        const node = graph.nodes.find(n => n.id === update.id || n.nodeId === update.nodeId);
        if (node) {
          Object.assign(node, update);
          updatedCount++;
        }
      });
    }

    if (updates.edges) {
      graph.edges = updates.edges;
    }

    if (updates.viewport) {
      graph.viewport = updates.viewport;
    }

    await this.saveGraph(graphId, graph);
    console.log(`📦 Batch update: ${updatedCount} nodes updated`);
    return { updatedCount, version: await this.getVersion(graphId) };
  }
};