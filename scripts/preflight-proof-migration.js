import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBase44Config,
  isUuid,
  loadLocalEnv,
  parseArgs,
} from './core-migration-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPaths = [
  path.resolve(__dirname, '../supabase/migrations/20260319170000_initial_architecture.sql'),
  path.resolve(__dirname, '../supabase/migrations/20260319193000_phase2_core_board.sql'),
];

function present(label, value) {
  if (!value) return `${label}: missing`;
  return `${label}: found`;
}

function mask(value, visible = 4) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= visible * 2) return text;
  return `${text.slice(0, visible)}...${text.slice(-visible)}`;
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();

  const base44 = getBase44Config();
  const report = {
    runtime: {
      authMode: process.env.VITE_LIFEOS_AUTH_MODE || 'supabase',
      apiMode: process.env.VITE_LIFEOS_API_MODE || 'hybrid',
    },
    base44: {
      appId: base44.appId ? mask(base44.appId, 6) : '',
      appBaseUrl: base44.appBaseUrl || '',
      accessTokenPresent: Boolean(base44.token),
      functionsVersionPresent: Boolean(base44.functionsVersion),
    },
    supabase: {
      browserUrlPresent: Boolean(process.env.VITE_SUPABASE_URL),
      browserKeyPresent: Boolean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY),
      serviceUrlPresent: Boolean(process.env.SUPABASE_URL),
      serviceRoleKeyPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET_UPLOADS || 'uploads',
    },
    importOwner: {
      value: args['user-id'] || process.env.LIFEOS_MIGRATION_USER_ID || '',
      validUuid: isUuid(args['user-id'] || process.env.LIFEOS_MIGRATION_USER_ID || ''),
    },
    migrations: migrationPaths.map((filePath) => ({
      filePath,
    })),
  };

  const nextSteps = [];
  if (!base44.appId || !base44.appBaseUrl) {
    nextSteps.push('Add BASE44_APP_ID and BASE44_APP_BASE_URL to .env.local.');
  }
  if (!base44.token) {
    nextSteps.push('Add BASE44_ACCESS_TOKEN to .env.local from your existing Base44 session/app.');
  }
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    nextSteps.push('Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from Supabase Project Settings.');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    nextSteps.push('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from Supabase Project Settings.');
  }
  if (!report.importOwner.validUuid) {
    nextSteps.push('Create a test auth user in Supabase and add its UUID as LIFEOS_MIGRATION_USER_ID or pass --user-id.');
  }

  console.log([
    'Proof migration preflight',
    `- ${present('Base44 app id', base44.appId)}`,
    `- ${present('Base44 base URL', base44.appBaseUrl)}`,
    `- ${present('Base44 access token', base44.token)}`,
    `- ${present('Supabase browser URL', process.env.VITE_SUPABASE_URL)}`,
    `- ${present('Supabase publishable key', process.env.VITE_SUPABASE_PUBLISHABLE_KEY)}`,
    `- ${present('Supabase service URL', process.env.SUPABASE_URL)}`,
    `- ${present('Supabase service role key', process.env.SUPABASE_SERVICE_ROLE_KEY)}`,
    `- Import owner UUID: ${report.importOwner.validUuid ? 'valid' : 'missing or invalid'}`,
    '',
    JSON.stringify(report, null, 2),
    '',
    'Next steps:',
    ...(nextSteps.length ? nextSteps.map((step) => `- ${step}`) : ['- Preflight looks complete. You can run export/import/verify next.']),
  ].join('\n'));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
