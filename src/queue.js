import { Queue } from 'bullmq';
import { redis } from './redis.js';

// Создаем очередь для команд
export const commandQueue = new Queue('commands', {
  connection: redis.duplicate(),
  defaultJobOptions: {
    removeOnComplete: 100,  // Хранить последние 100 выполненных
    removeOnFail: 50,       // Хранить последние 50 неудачных
    attempts: 3,            // Повторить 3 раза при ошибке
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
});

// Добавить команду в очередь
export async function addCommand(type, data) {
  try {
    const job = await commandQueue.add(type, data, {
      // Можно добавить приоритет для разных типов команд
      priority: type === 'DELETE_NODE' ? 1 : 0
    });
    
    console.log(`📨 Command ${type} queued with job ID: ${job.id}`);
    return job.id;
  } catch (error) {
    console.error(`❌ Failed to queue command ${type}:`, error);
    throw error;
  }
}

// Получить статус задачи
export async function getJobStatus(jobId) {
  try {
    const job = await commandQueue.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }
    
    const state = await job.getState();
    const progress = job.progress;
    
    return {
      id: job.id,
      status: state,
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason
    };
  } catch (error) {
    console.error(`❌ Failed to get job status:`, error);
    return { status: 'error', error: error.message };
  }
}

// Очистить старые задачи
export async function cleanQueue() {
  try {
    await commandQueue.clean(1000 * 60 * 60, 100); // Удалить задачи старше часа
    await commandQueue.clean(1000 * 60 * 60, 100, 'failed');
    console.log('🧹 Queue cleaned');
  } catch (error) {
    console.error('❌ Failed to clean queue:', error);
  }
}

// Мониторинг очереди
commandQueue.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

commandQueue.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err.message);
});

commandQueue.on('stalled', (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled`);
});