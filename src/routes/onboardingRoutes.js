/**
 * Onboarding Routes — what an account has seen of the introduction and the
 * lessons, so none of it is offered twice (plans/2026-09-18-first-run-onboarding-design.md).
 *
 * One record per account, not per graph: `user:<userId>:onboarding`. It does
 * not match `user:*:graph:*`, so graph scans pass it by.
 *
 * Mounted behind requireUser (server.js): req.userId is the user the request's
 * token proves.
 */

import express from 'express';
import { logger } from '../utils/logger.js';

export const onboardingKey = (userId) => `user:${userId}:onboarding`;

const INTRO_STATUSES = new Set(['in_progress', 'completed', 'declined']);
const STORIES = new Set(['trip', 'license', 'move']);
const ROLES = new Set(['kai', 's1', 's2', 'mi1']);
const MAX_ID = 64;
const MAX_STEP = 10;
const MAX_LESSONS = 32;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;

/** The patch's own problem as a sentence, or null when it is acceptable. */
function refuse(patch) {
  if (!isPlainObject(patch)) return 'the body must be an object';
  for (const key of Object.keys(patch)) {
    if (key !== 'intro' && key !== 'lessons') return `unknown field ${key}`;
  }

  if (patch.intro !== undefined) {
    const intro = patch.intro;
    if (!isPlainObject(intro)) return 'intro must be an object';
    for (const [key, value] of Object.entries(intro)) {
      switch (key) {
        case 'status':
          if (!INTRO_STATUSES.has(value)) return 'unknown intro status';
          break;
        case 'story':
          if (!STORIES.has(value)) return 'unknown story';
          break;
        case 'sphereId':
          if (!isId(value)) return 'sphereId must be a short string';
          break;
        case 'step':
          if (!Number.isInteger(value) || value < 0 || value > MAX_STEP) return 'step out of range';
          break;
        case 'roles':
          if (!isPlainObject(value)) return 'roles must be an object';
          for (const [role, id] of Object.entries(value)) {
            if (!ROLES.has(role)) return `unknown role ${role}`;
            if (!isId(id)) return 'a role must name a short id';
          }
          break;
        default:
          return `unknown intro field ${key}`;
      }
    }
  }

  if (patch.lessons !== undefined) {
    if (!isPlainObject(patch.lessons)) return 'lessons must be an object';
    for (const [lesson, status] of Object.entries(patch.lessons)) {
      if (!isId(lesson)) return 'a lesson id must be a short string';
      if (status !== 'completed') return 'a lesson can only be completed';
    }
  }
  return null;
}

async function read(redis, userId) {
  const raw = await redis.get(onboardingKey(userId));
  if (!raw) return {};
  try {
    const record = JSON.parse(raw);
    return isPlainObject(record) ? record : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ redis: { get: Function, set: Function } }} deps
 */
export function setupOnboardingRoutes({ redis }) {
  // Per call, not per module: see graphRoutes.js.
  const router = express.Router();

  router.get('/onboarding', async (req, res) => {
    try {
      res.json(await read(redis, req.userId));
    } catch (error) {
      logger.error('Onboarding read failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/onboarding', async (req, res) => {
    const problem = refuse(req.body);
    if (problem) return res.status(400).json({ error: problem });

    try {
      const record = await read(redis, req.userId);
      const next = { ...record };
      if (req.body.intro) {
        next.intro = { ...record.intro, ...req.body.intro, updatedAt: new Date().toISOString() };
      }
      if (req.body.lessons) {
        next.lessons = { ...record.lessons, ...req.body.lessons };
        if (Object.keys(next.lessons).length > MAX_LESSONS) {
          return res.status(400).json({ error: 'too many lessons' });
        }
      }
      await redis.set(onboardingKey(req.userId), JSON.stringify(next));
      res.json(next);
    } catch (error) {
      logger.error('Onboarding save failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
