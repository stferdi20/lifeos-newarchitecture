import React, { createContext, useContext, useEffect, useState } from 'react';
import { hasSupabaseBrowserConfig } from '@/lib/runtime-config';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

const AuthContext = createContext();
const PASSWORD_RECOVERY_STORAGE_KEY = 'lifeos.password-recovery';

function hasRecoveryTypeInUrl() {
  if (typeof window === 'undefined') return false;

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
}

function markPasswordRecoveryActive() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PASSWORD_RECOVERY_STORAGE_KEY, '1');
}

function clearPasswordRecoveryFlag() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
}

function isPasswordRecoveryActive() {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(PASSWORD_RECOVERY_STORAGE_KEY) === '1';
}

function normalizeSupabaseUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);
  const [authStateEvent, setAuthStateEvent] = useState(
    hasRecoveryTypeInUrl() || isPasswordRecoveryActive() ? 'PASSWORD_RECOVERY' : null
  );

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !hasSupabaseBrowserConfig()) {
      setAuthError({
        type: 'missing_config',
        message: 'Supabase browser configuration is missing.',
      });
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
      return undefined;
    }

    checkSupabaseAuth(client);

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || hasRecoveryTypeInUrl()) {
        markPasswordRecoveryActive();
        setAuthStateEvent('PASSWORD_RECOVERY');
      } else if (event === 'SIGNED_OUT') {
        clearPasswordRecoveryFlag();
        setAuthStateEvent(null);
      } else {
        setAuthStateEvent(isPasswordRecoveryActive() ? 'PASSWORD_RECOVERY' : event);
      }

      const nextUser = normalizeSupabaseUser(session?.user);
      setUser(nextUser);
      setIsAuthenticated(Boolean(session?.user));
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
      setAppPublicSettings({ auth_provider: 'supabase' });
      setAuthError(session?.user ? null : {
        type: 'auth_required',
        message: 'Authentication required',
      });
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const checkSupabaseAuth = async (client = getSupabaseBrowserClient()) => {
    try {
      setIsLoadingAuth(true);
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      const { data, error } = await client.auth.getSession();
      if (error) throw error;

      const nextUser = normalizeSupabaseUser(data.session?.user);
      if (hasRecoveryTypeInUrl() || isPasswordRecoveryActive()) {
        markPasswordRecoveryActive();
        setAuthStateEvent('PASSWORD_RECOVERY');
      } else {
        setAuthStateEvent(null);
      }
      setUser(nextUser);
      setIsAuthenticated(Boolean(nextUser));
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
      setAppPublicSettings({ auth_provider: 'supabase' });
      if (!nextUser) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required',
        });
      }
    } catch (error) {
      console.error('Supabase auth check failed:', error);
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
      setAuthError({
        type: 'auth_required',
        message: error.message || 'Authentication required',
      });
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    clearPasswordRecoveryFlag();
    setAuthStateEvent(null);
    const client = getSupabaseBrowserClient();
    client?.auth.signOut().finally(() => {
      if (shouldRedirect) window.location.assign('/Login');
    });
  };

  const clearPasswordRecoveryState = () => {
    clearPasswordRecoveryFlag();
    setAuthStateEvent(null);
  };

  const navigateToLogin = () => {
    window.location.assign('/Login');
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      authStateEvent,
      appPublicSettings,
      authProvider: 'supabase',
      logout,
      clearPasswordRecoveryState,
      navigateToLogin,
      checkAppState: checkSupabaseAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
