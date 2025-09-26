import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { graphOps } from './redis.js';
import { addCommand, getJobStatus } from './queue.js';
import { startWebSocketServer } from './websocket.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Optimistic UI API',
    timestamp: new Date().toISOString()
  });
});

// ===== User API Routes (REST - Figma/Miro style) =====

// Получить информацию о пользователе
app.get('/api/users/:userId', async (req, res) => {
  try {
    res.json({
      userId: req.params.userId,
      exists: true,
      managedBy: 'optimistic-backend',
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить список графов пользователя (REST для загрузки)
app.get('/api/users/:userId/graphs', async (req, res) => {
  try {
    const graphIds = await graphOps.listGraphs(req.params.userId);
    
    const graphs = graphIds.map(graphId => ({
      graphId,
      name: getGraphDisplayName(graphId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    
    res.json({
      userId: req.params.userId,
      graphs
    });
  } catch (error) {
    console.error('Error listing user graphs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Создать новый граф для пользователя (REST)
app.post('/api/users/:userId/graphs', async (req, res) => {
  try {
    const { graphId, name, viewport } = req.body;
    
    const initialData = {
      nodes: [],
      edges: [],
      viewport: viewport || { x: 0, y: 0, zoom: 1 }
    };
    
    const version = await graphOps.saveGraph(graphId, initialData);
    
    res.json({
      success: true,
      graphId,
      name: name || getGraphDisplayName(graphId),
      viewport: initialData.viewport,
      version,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating user graph:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== Graph API Routes (Hybrid - REST для загрузки, WebSocket для операций) =====

// Получить граф (синхронно из Redis)
app.get('/api/graphs/:graphId', async (req, res) => {
  try {
    const graph = await graphOps.getGraph(req.params.graphId);
    const version = await graphOps.getVersion(req.params.graphId);
    
    res.json({ 
      ...graph,
      version
    });
  } catch (error) {
    console.error('Error fetching graph:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получить версию графа
app.get('/api/graphs/:graphId/version', async (req, res) => {
  try {
    const version = await graphOps.getVersion(req.params.graphId);
    res.json({ version });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Сохранить весь граф (для начальной загрузки или полного обновления)
app.post('/api/graphs/:graphId', async (req, res) => {
  try {
    const version = await graphOps.saveGraph(req.params.graphId, req.body);
    res.json({ 
      success: true,
      version
    });
  } catch (error) {
    console.error('Error saving graph:', error);
    res.status(500).json({ error: error.message });
  }
});

// Выполнить команду (optimistic)
app.post('/api/graphs/:graphId/command', async (req, res) => {
  try {
    const { type, payload, operationId } = req.body;
    const { graphId } = req.params;
    
    // Добавляем команду в очередь
    const jobId = await addCommand(type, {
      graphId,
      payload,
      operationId
    });
    
    // Сразу возвращаем успех (optimistic)
    res.json({ 
      success: true, 
      jobId,
      operationId: operationId || jobId,
      // Возвращаем payload для немедленного обновления UI
      optimisticResult: payload 
    });
    
  } catch (error) {
    console.error('Error queuing command:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch команды
app.post('/api/graphs/:graphId/batch', async (req, res) => {
  try {
    const { commands } = req.body;
    const { graphId } = req.params;
    
    const jobIds = await Promise.all(
      commands.map(cmd => 
        addCommand(cmd.type, {
          graphId,
          payload: cmd.payload
        })
      )
    );
    
    res.json({ 
      success: true, 
      jobIds,
      count: jobIds.length
    });
    
  } catch (error) {
    console.error('Error queuing batch commands:', error);
    res.status(500).json({ error: error.message });
  }
});

// Проверить статус операции
app.get('/api/operations/:jobId', async (req, res) => {
  try {
    const status = await getJobStatus(req.params.jobId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Специфичные операции для совместимости с frontend =====

// Создать/обновить узел
app.post('/api/graphs/:graphId/nodes', async (req, res) => {
  try {
    const jobId = await addCommand('ADD_NODE', {
      graphId: req.params.graphId,
      payload: req.body
    });
    
    res.json({ 
      success: true, 
      jobId,
      node: req.body
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Обновить позицию узла
app.patch('/api/graphs/:graphId/nodes/:nodeId/position', async (req, res) => {
  try {
    const jobId = await addCommand('UPDATE_NODE_POSITION', {
      graphId: req.params.graphId,
      payload: {
        nodeId: req.params.nodeId,
        position: req.body
      }
    });
    
    res.json({ 
      success: true, 
      jobId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Удалить узел
app.delete('/api/graphs/:graphId/nodes/:nodeId', async (req, res) => {
  try {
    const jobId = await addCommand('DELETE_NODE', {
      graphId: req.params.graphId,
      payload: {
        nodeId: req.params.nodeId
      }
    });
    
    res.json({ 
      success: true, 
      jobId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Создать ребро
app.post('/api/graphs/:graphId/edges', async (req, res) => {
  try {
    const jobId = await addCommand('ADD_EDGE', {
      graphId: req.params.graphId,
      payload: req.body
    });
    
    res.json({ 
      success: true, 
      jobId,
      edge: req.body
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Удалить ребро
app.delete('/api/graphs/:graphId/edges/:edgeId', async (req, res) => {
  try {
    const jobId = await addCommand('DELETE_EDGE', {
      graphId: req.params.graphId,
      payload: {
        edgeId: req.params.edgeId
      }
    });
    
    res.json({ 
      success: true, 
      jobId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: err.message || 'Internal server error'
  });
});

// Запуск серверов
app.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});

// Запуск WebSocket сервера
const WS_PORT = process.env.WS_PORT || 8080;
startWebSocketServer(WS_PORT);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// ===== Helper Functions =====

// Получить отображаемое имя графа
function getGraphDisplayName(graphId) {
  if (graphId === 'main') return 'Main Graph';
  if (graphId === 'project1') return 'Project 1';
  if (graphId === 'ideas') return 'Ideas';
  
  // Извлечь имя из ID
  if (graphId.includes('_graph_')) {
    const parts = graphId.split('_graph_');
    const afterGraph = parts[1];
    
    if (afterGraph && afterGraph.includes('_')) {
      const customParts = afterGraph.split('_');
      if (customParts.length > 1) {
        return customParts.slice(1).join(' ');
      }
    }
  }
  return graphId;
}

export default app;