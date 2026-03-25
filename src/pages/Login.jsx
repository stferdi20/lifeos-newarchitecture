import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';
import { shouldUseSupabaseAuth } from '@/lib/runtime-config';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function Login() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [mode, setMode] = useState('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [linkError, setLinkError] = useState('');
  const redirectTarget = useMemo(() => `${window.location.origin}/Login`, []);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const errorCode = hashParams.get('error_code') || searchParams.get('error_code');
    const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

    if (!errorCode && !errorDescription) return;

    const decoded = decodeURIComponent(errorDescription || '').replace(/\+/g, ' ') || 'The sign-in link is invalid or has expired.';
    const message = errorCode === 'otp_expired'
      ? 'That magic link has expired. Request a fresh one below and use the newest email.'
      : decoded;

    setLinkError(message);
    toast.error(message);

    if (window.location.hash || window.location.search) {
      window.history.replaceState({}, document.title, '/Login');
    }
  }, []);

  if (!shouldUseSupabaseAuth()) {
    return <Navigate to="/" replace />;
  }

  if (!isLoadingAuth && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const getClient = () => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      toast.error('Supabase auth is not configured yet.');
      return null;
    }

    return client;
  };

  const handleMagicLink = async () => {
    if (!email.trim()) return;

    const client = getClient();
    if (!client) return;

    setSending(true);
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTarget,
        },
      });

      if (error) throw error;
      setLinkError('');
      toast.success(`Magic link sent. Check your email and open the newest link for ${new URL(redirectTarget).host}.`);
    } catch (error) {
      toast.error(error?.message || 'Failed to send magic link.');
    } finally {
      setSending(false);
    }
  };

  const handlePasswordSignIn = async () => {
    if (!email.trim() || !password) return;

    const client = getClient();
    if (!client) return;

    setSending(true);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;
      setLinkError('');
      toast.success('Signed in to LifeOS.');
    } catch (error) {
      toast.error(error?.message || 'Unable to sign in with email and password.');
    } finally {
      setSending(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!fullName.trim() || !email.trim() || !password) return;
    if (password.length < 8) {
      toast.error('Use at least 8 characters for your password.');
      return;
    }

    const client = getClient();
    if (!client) return;

    setSending(true);
    try {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTarget,
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (error) throw error;
      setLinkError('');

      if (data.session) {
        toast.success(`Welcome to LifeOS, ${fullName.trim()}.`);
        return;
      }

      toast.success('Account created. Check your email if confirmation is required, then sign in.');
      setMode('sign-in');
    } catch (error) {
      toast.error(error?.message || 'Unable to create your account.');
    } finally {
      setSending(false);
    }
  };

  const modeCopy = {
    'sign-in': {
      title: 'Sign in with your LifeOS account',
      description: 'Use your email and password so each browser or device can log in directly.',
      button: 'Sign In',
      icon: <LockKeyhole className="h-4 w-4" />,
      action: handlePasswordSignIn,
    },
    'sign-up': {
      title: 'Create your LifeOS profile',
      description: 'Set up a reusable account with your name, email, and password.',
      button: 'Create Account',
      icon: <UserRound className="h-4 w-4" />,
      action: handleCreateAccount,
    },
    'magic-link': {
      title: 'Use magic link instead',
      description: 'Fallback option if you prefer email-based sign-in on this device.',
      button: 'Send Magic Link',
      icon: <Mail className="h-4 w-4" />,
      action: handleMagicLink,
    },
  };

  return (
    <div className="min-h-screen bg-[#0e1117] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="grid w-full gap-8 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30 lg:grid-cols-[1.1fr_0.9fr] lg:p-10">
          <div className="space-y-6">
            <p className="text-xs uppercase tracking-[0.35em] text-sky-300/80">LifeOS Account</p>
            <div className="space-y-3">
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Sign in once, then use LifeOS anywhere.
              </h1>
              <p className="max-w-lg text-sm leading-6 text-slate-300">
                Your account is already backed by Supabase, so we can use a normal email and password flow instead of sending
                a new magic link for every browser or device.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-sky-400/20 bg-[#101826] p-6">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/[0.04] p-1">
                {[
                  ['sign-in', 'Sign In'],
                  ['sign-up', 'Create'],
                  ['magic-link', 'Magic Link'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`rounded-xl px-3 py-2 text-sm transition ${
                      mode === value ? 'bg-sky-400/20 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-sm font-medium text-white">{modeCopy[mode].title}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {modeCopy[mode].description}
                </p>
                {linkError ? (
                  <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    {linkError}
                  </div>
                ) : null}
              </div>

              {mode === 'sign-up' ? (
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.25em] text-slate-500">Full Name</label>
                  <Input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Your name"
                    className="border-white/10 bg-white/5 text-white"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-500">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>

              {mode !== 'magic-link' ? (
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.25em] text-slate-500">Password</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === 'sign-up' ? 'At least 8 characters' : 'Your password'}
                    className="border-white/10 bg-white/5 text-white"
                  />
                </div>
              ) : null}

              <Button
                className="w-full gap-2"
                onClick={modeCopy[mode].action}
                disabled={sending || !email.trim() || (mode === 'sign-up' && (!fullName.trim() || !password)) || (mode === 'sign-in' && !password)}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : modeCopy[mode].icon}
                {modeCopy[mode].button}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
