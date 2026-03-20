import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';
import { shouldUseSupabaseAuth } from '@/lib/runtime-config';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function Login() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  if (!shouldUseSupabaseAuth()) {
    return <Navigate to="/" replace />;
  }

  if (!isLoadingAuth && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleMagicLink = async () => {
    if (!email.trim()) return;

    const client = getSupabaseBrowserClient();
    if (!client) {
      toast.error('Supabase auth is not configured yet.');
      return;
    }

    setSending(true);
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;
      toast.success('Magic link sent. Check your email to continue.');
    } catch (error) {
      toast.error(error?.message || 'Failed to send magic link.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e1117] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="grid w-full gap-8 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30 lg:grid-cols-[1.1fr_0.9fr] lg:p-10">
          <div className="space-y-6">
            <p className="text-xs uppercase tracking-[0.35em] text-sky-300/80">LifeOS Migration</p>
            <div className="space-y-3">
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Supabase auth is ready for the new architecture.
              </h1>
              <p className="max-w-lg text-sm leading-6 text-slate-300">
                This login screen is part of the Base44 exit path. Once you wire your Supabase keys, the app can authenticate
                without depending on Base44 and the migrated task APIs can run through your own backend.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-sky-400/20 bg-[#101826] p-6">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-white">Sign in with magic link</p>
                <p className="mt-1 text-sm text-slate-400">
                  Use the same email you want attached to your LifeOS account.
                </p>
              </div>

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

              <Button className="w-full gap-2" onClick={handleMagicLink} disabled={sending || !email.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Continue with email
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
