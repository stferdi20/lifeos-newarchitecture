import React, { Suspense, lazy } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { featureFlags, isFeatureEnabled } from '@/lib/featureFlags';
import { getKanbanV2MigrationState } from '@/lib/kanbanMigration';
import { shouldUseSupabaseAuth } from '@/lib/runtime-config';
import RouteErrorBoundary from '@/components/layout/RouteErrorBoundary';
import PageTransition from '@/components/ui/PageTransition';
import Media from './pages/Media';

const PageNotFound = lazy(() => import('./lib/PageNotFound'));
const UserNotRegisteredError = lazy(() => import('@/components/UserNotRegisteredError'));
const AppLayout = lazy(() => import('./components/layout/AppLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProjectsV2 = lazy(() => import('./pages/ProjectsV2'));
const ProjectsLegacy = lazy(() => import('./pages/ProjectsLegacy'));
const Habits = lazy(() => import('./pages/Habits'));
const Notes = lazy(() => import('./pages/Notes'));
const News = lazy(() => import('./pages/News'));
const Ideas = lazy(() => import('./pages/Ideas'));
const Investments = lazy(() => import('./pages/Investments'));
const Tools = lazy(() => import('./pages/Tools'));
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Trends = lazy(() => import('./pages/Trends'));
const CreatorVault = lazy(() => import('./pages/CreatorVault'));
const PromptWizard = lazy(() => import('./pages/PromptWizard'));
const Resources = lazy(() => import('./pages/Resources'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Login = lazy(() => import('./pages/Login'));
const Settings = lazy(() => import('./pages/Settings'));

function RouteFallback() {
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
    </div>
  );
}

function RouteElement({ children }) {
  // Disable transition for settings if it handles dialogs, otherwise generic wrapper
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <PageTransition>
          {children}
        </PageTransition>
      </Suspense>
    </RouteErrorBoundary>
  );
}

const ProjectsRoute = () => {
  const migrationVerified = getKanbanV2MigrationState() === 'verified';
  const kanbanV2Enabled = isFeatureEnabled('kanban_v2_enabled') || featureFlags.kanban_v2_enabled;
  return kanbanV2Enabled && migrationVerified ? <ProjectsV2 /> : <ProjectsLegacy />;
};

function isRecoveryLoginUrl(location) {
  if (location?.pathname !== '/Login') return false;

  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, authStateEvent, navigateToLogin, isAuthenticated } = useAuth();
  const location = useLocation();
  const usingSupabaseAuth = shouldUseSupabaseAuth();
  const isRecoveringPassword = authStateEvent === 'PASSWORD_RECOVERY' || isRecoveryLoginUrl(location);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return <RouteFallback />;
  }

  if (usingSupabaseAuth && (!isAuthenticated || isRecoveringPassword)) {
    return (
      <Routes>
        <Route path="/Login" element={<RouteElement><Login /></RouteElement>} />
        <Route path="*" element={<Navigate to="/Login" replace />} />
      </Routes>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }

    if (authError.type === 'missing_config') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0e1117] p-6 text-center text-white">
          <div className="max-w-lg rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <h1 className="text-2xl font-semibold">Supabase Auth Needs Configuration</h1>
            <p className="mt-3 text-sm text-slate-300">
              Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, or switch `VITE_LIFEOS_AUTH_MODE` back to `base44`
              while you migrate the rest of the app.
            </p>
          </div>
        </div>
      );
    }

    if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/Login" element={<Navigate to="/" replace />} />
      <Route element={<RouteElement><AppLayout /></RouteElement>}>
        <Route path="/" element={<Navigate to="/Dashboard" replace />} />
        <Route path="/Dashboard" element={<RouteElement><Dashboard /></RouteElement>} />
        <Route path="/Projects" element={<RouteElement><ProjectsRoute /></RouteElement>} />
        <Route path="/ProjectsLegacy" element={<RouteElement><ProjectsLegacy /></RouteElement>} />
        <Route path="/Tasks" element={<RouteElement><Tasks /></RouteElement>} />
        <Route path="/Habits" element={<RouteElement><Habits /></RouteElement>} />
        <Route path="/Notes" element={<RouteElement><Notes /></RouteElement>} />
        <Route path="/News" element={<RouteElement><News /></RouteElement>} />
        <Route path="/Ideas" element={<RouteElement><Ideas /></RouteElement>} />
        <Route path="/Media" element={<RouteElement><Media /></RouteElement>} />
        <Route path="/Investments" element={<RouteElement><Investments /></RouteElement>} />
        <Route path="/Tools" element={<RouteElement><Tools /></RouteElement>} />
        <Route path="/KnowledgeGraph" element={<RouteElement><KnowledgeGraph /></RouteElement>} />
        <Route path="/Calendar" element={<RouteElement><Calendar /></RouteElement>} />
        <Route path="/Trends" element={<RouteElement><Trends /></RouteElement>} />
        <Route path="/CreatorVault" element={<RouteElement><CreatorVault /></RouteElement>} />
        <Route path="/PromptWizard" element={<RouteElement><PromptWizard /></RouteElement>} />
        <Route path="/Resources" element={<RouteElement><Resources /></RouteElement>} />
        <Route path="/Settings" element={<RouteElement><Settings /></RouteElement>} />
      </Route>
      <Route path="*" element={<RouteElement><PageNotFound /></RouteElement>} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
