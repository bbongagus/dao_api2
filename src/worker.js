import { Worker } from 'bullmq';
import { redis, graphOps } from './redis.js';
import { broadcast } from './websocket.js';

// Создаем worker для обработки команд
const worker = new Worker(
  'commands',
  async (job) => {
    const { type, graphId, payload } = job.data;
    
    console.log(`⚙️ Processing ${type} for graph ${graphId}`);
    
    // Обновляем прогресс
    await job.updateProgress(10);
    
    let result;
    
    try {
      switch(type) {
        case 'UPDATE_NODE':
          result = await graphOps.updateNode(
            graphId, 
            payload.nodeId, 
            payload.updates
          );
          break;
          
        case 'UPDATE_NODE_POSITION':
          result = await graphOps.updateNode(
            graphId,
            payload.nodeId,
            { position: payload.position }
          );
          break;
          
        case 'ADD_NODE':
          result = await graphOps.addNode(graphId, payload);
          break;
          
        case 'DELETE_NODE':
          result = await graphOps.deleteNode(graphId, payload.nodeId);
          break;
          
        case 'ADD_EDGE':
          result = await graphOps.addEdge(graphId, payload);
          break;
          
        case 'DELETE_EDGE':
          result = await graphOps.deleteEdge(graphId, payload.edgeId);
          break;
          
        case 'UPDATE_VIEWPORT':
          result = await graphOps.updateViewport(graphId, payload);
          break;
          
        case 'BATCH_UPDATE':
          result = await graphOps.batchUpdate(graphId, payload);
          break;
          
        case 'SAVE_GRAPH':
          // Полное сохранение графа
          result = await graphOps.saveGraph(graphId, payload);
          break;
          
        default:
          throw new Error(`Unknown command type: ${type}`);
      }
      
      await job.updateProgress(90);
      
      // Получаем актуальную версию
      const version = await graphOps.getVersion(graphId);
      
      // Отправляем обновление через WebSocket
      broadcast({
        type: 'COMMAND_EXECUTED',
        commandType: type,
        graphId,
        result,
        version,
        jobId: job.id,
        success: true
      });
      
      await job.updateProgress(100);
      
      console.log(`✅ ${type} completed for graph ${graphId}`);
      
      return { 
        success: true, 
        result,
        version
      };
      
    } catch (error) {
      console.error(`❌ Error processing ${type}:`, error);
      
      // Отправляем ошибку через WebSocket
      broadcast({
        type: 'COMMAND_FAILED',
        commandType: type,
        graphId,
        error: error.message,
        jobId: job.id,
        success: false
      });
      
      throw error;
    }
  },
  {
    connection: redis.duplicate(),
    concurrency: 5,  // Обрабатываем до 5 команд параллельно
    limiter: {
      max: 100,       // Максимум 100 задач
      duration: 1000  // в секунду
    }
  }
);

// Обработка событий worker'а
worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err.message);
});

worker.on('stalled', (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled and will be retried`);
});

worker.on('error', (err) => {
  console.error('❌ Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📛 SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});

console.log('🤖 Worker started and listening for commands...');

export default worker;