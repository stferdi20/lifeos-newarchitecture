import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRoutes from './routes/auth.js';
import habitRoutes from './routes/habits.js';
import habitLogRoutes from './routes/habit-logs.js';
import workspaceRoutes from './routes/workspaces.js';
import listRoutes from './routes/lists.js';
import cardRoutes from './routes/cards.js';
import taskRoutes from './routes/tasks.js';
import resourceRoutes from './routes/resources.js';
import snippetRoutes from './routes/snippets.js';
import lifeAreaRoutes from './routes/life-areas.js';
import projectResourceRoutes from './routes/project-resources.js';
import cardResourceRoutes from './routes/card-resources.js';
import promptTemplateRoutes from './routes/prompt-templates.js';
import mediaRoutes from './routes/media.js';
import investmentRoutes from './routes/investments.js';
import creatorRoutes from './routes/creator-inspo.js';
import noteRoutes from './routes/notes.js';
import toolRoutes from './routes/tools.js';
import newsRoutes from './routes/news.js';
import trendRoutes from './routes/trends.js';
import projectCategoryRoutes from './routes/project-categories.js';
import calendarRoutes from './routes/calendar.js';
import eventTemplateRoutes from './routes/event-templates.js';
import googleRoutes from './routes/google.js';
import instagramDownloaderRoutes from './routes/instagram-downloader.js';
import youtubeTranscriptRoutes from './routes/youtube-transcript.js';
import fileRoutes from './routes/files.js';
import aiRoutes from './routes/ai.js';
import tcgRoutes from './routes/tcg.js';
import compatRoutes from './routes/compat.js';
import { getServerEnv, hasSupabaseServerConfig } from './config/env.js';
import { jsonError } from './lib/http.js';

function registerApiRoutes(app) {
  app.get('/health', (c) => {
    const env = getServerEnv();
    return c.json({
      ok: true,
      service: 'lifeos-api',
      supabaseConfigured: hasSupabaseServerConfig(),
      authBypassEnabled: env.NODE_ENV !== 'production' && Boolean(env.LIFEOS_DEV_USER_ID),
    });
  });

  app.route('/auth', authRoutes);
  app.route('/habits', habitRoutes);
  app.route('/habit-logs', habitLogRoutes);
  app.route('/workspaces', workspaceRoutes);
  app.route('/lists', listRoutes);
  app.route('/cards', cardRoutes);
  app.route('/tasks', taskRoutes);
  app.route('/resources', resourceRoutes);
  app.route('/snippets', snippetRoutes);
  app.route('/life-areas', lifeAreaRoutes);
  app.route('/project-resources', projectResourceRoutes);
  app.route('/card-resources', cardResourceRoutes);
  app.route('/prompt-templates', promptTemplateRoutes);
  app.route('/media', mediaRoutes);
  app.route('/investments', investmentRoutes);
  app.route('/creator-inspo', creatorRoutes);
  app.route('/notes', noteRoutes);
  app.route('/tools', toolRoutes);
  app.route('/news', newsRoutes);
  app.route('/trends', trendRoutes);
  app.route('/project-categories', projectCategoryRoutes);
  app.route('/calendar', calendarRoutes);
  app.route('/event-templates', eventTemplateRoutes);
  app.route('/google', googleRoutes);
  app.route('/instagram-downloader', instagramDownloaderRoutes);
  app.route('/youtube-transcript', youtubeTranscriptRoutes);
  app.route('/files', fileRoutes);
  app.route('/ai', aiRoutes);
  app.route('/tcg', tcgRoutes);
  app.route('/compat', compatRoutes);
}

const rootApp = new Hono();
rootApp.use('*', logger());
rootApp.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

const directApi = new Hono();
registerApiRoutes(directApi);

const prefixedApi = new Hono();
registerApiRoutes(prefixedApi);

rootApp.route('/', directApi);
rootApp.route('/api', prefixedApi);

rootApp.onError((error, c) => jsonError(c, error));

export default rootApp;
