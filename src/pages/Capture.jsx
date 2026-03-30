import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { captureResourceFromUrl } from '@/lib/resources-api';
import { isNormalizedResourceUrl, normalizeResourceUrl } from '@/lib/resource-url';

const RECENT_CAPTURE_WINDOW_MS = 30 * 1000;

function buildStorageKey(url) {
  return `lifeos.capture:${url}`;
}

export default function Capture() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [state, setState] = useState('pending');
  const [message, setMessage] = useState('Preparing your resource capture...');
  const submittedRef = useRef(false);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const rawUrl = params.get('url') || '';
  const projectId = params.get('projectId') || '';
  const source = params.get('source') || 'capture_page';
  const normalizedUrl = normalizeResourceUrl(rawUrl);

  useEffect(() => {
    if (!normalizedUrl || !isNormalizedResourceUrl(normalizedUrl)) {
      setState('invalid');
      setMessage('This shortcut did not pass a valid URL.');
      return;
    }

    if (isLoadingAuth) return;

    if (!isAuthenticated) {
      const next = `${location.pathname}${location.search}`;
      navigate(`/Login?next=${encodeURIComponent(next)}`, { replace: true });
      return;
    }

    if (submittedRef.current) return;
    submittedRef.current = true;

    const storageKey = buildStorageKey(normalizedUrl);
    const lastSubmittedAt = Number(window.sessionStorage.getItem(storageKey) || 0);
    if (Date.now() - lastSubmittedAt <= RECENT_CAPTURE_WINDOW_MS) {
      setState('success');
      setMessage('This link was already submitted recently. Taking you back to Resources...');
      window.setTimeout(() => navigate('/Resources', { replace: true }), 700);
      return;
    }

    window.sessionStorage.setItem(storageKey, String(Date.now()));
    setState('submitting');
    setMessage('Saving this link to LifeOS...');

    captureResourceFromUrl({
      url: normalizedUrl,
      project_id: projectId || undefined,
      source,
    })
      .then((result) => {
        if (result?.resource?.id) {
          queryClient.setQueryData(['resources'], (current) => {
            const list = Array.isArray(current) ? current : [];
            return [result.resource, ...list.filter((entry) => entry?.id !== result.resource.id)];
          });
        }
        setState('success');
        setMessage('Queued successfully. Redirecting to Resources...');
        toast.success('Resource queued. We’ll keep processing it in the background.');
        window.setTimeout(() => navigate('/Resources', { replace: true }), 700);
      })
      .catch((error) => {
        setState('error');
        setMessage(error?.message || 'LifeOS could not queue this link.');
        toast.error(error?.message || 'Failed to queue resource capture.');
      });
  }, [isAuthenticated, isLoadingAuth, location.pathname, location.search, navigate, normalizedUrl, projectId, queryClient, source]);

  if (state === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <h1 className="text-lg font-semibold">Invalid capture link</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Link to="/Resources" className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline">
            Open Resources instead
          </Link>
        </div>
      </div>
    );
  }

  if (!isLoadingAuth && !isAuthenticated) {
    return <Navigate to="/Login" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Loader2 className={`h-6 w-6 ${state === 'error' ? '' : 'animate-spin'}`} />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Saving to LifeOS</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
