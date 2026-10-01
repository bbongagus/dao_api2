// Results survive a browser closing. Jobs never apply graph changes themselves.
export const JOB_TTL = 24 * 60 * 60;
export const JOB_TIMEOUT_MS = 8 * 60 * 1000;
const part = (value) => encodeURIComponent(value);
const keys = (user, id, graph) => ({
  job: `ai:job:${part(user)}:${part(id)}`,
  active: `ai:active:${part(user)}`,
  latest: `ai:latest:${part(user)}:${part(graph)}`,
});
export function createChatJobStore(redis) {
  return {
    async create(user, job) {
      const k = keys(user, job.id, job.graphId);
      const result = await redis.eval(`
        if redis.call('EXISTS', KEYS[1]) == 1 then return 'existing' end
        if redis.call('EXISTS', KEYS[2]) == 1 then return 'busy' end
        redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
        redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
        redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[2])
        return 'created'`, 3, k.job, k.active, k.latest, JSON.stringify(job), JOB_TTL, job.id, Math.ceil(JOB_TIMEOUT_MS / 1000) + 60);
      return result;
    },
    async get(user, id) { const value = await redis.get(keys(user, id).job); return value ? JSON.parse(value) : null; },
    async latest(user, graph) { const id = await redis.get(keys(user, '', graph).latest); return id ? this.get(user, id) : null; },
    async save(user, job) { await redis.set(keys(user, job.id).job, JSON.stringify(job), 'EX', JOB_TTL); },
    async release(user, id) {
      await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, keys(user, id).active, id);
    },
    async cancel(user, id) { await redis.set(`${keys(user, id).job}:cancel`, '1', 'EX', JOB_TTL); },
    async cancelled(user, id) { return Boolean(await redis.get(`${keys(user, id).job}:cancel`)); },
    async acknowledge(user, id) { await redis.set(`${keys(user, id).job}:seen`, '1', 'EX', JOB_TTL); },
    async acknowledged(user, id) { return Boolean(await redis.get(`${keys(user, id).job}:seen`)); },
  };
}
