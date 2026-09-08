'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ShieldCheck, ShieldOff } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

/**
 * The Security block in the profile sheet: enrol in TOTP, or turn it off.
 *
 * Everything here talks to better-auth's twoFactor plugin directly rather
 * than through tRPC — the plugin owns the secret, the backup codes and the
 * verification state, and putting a router in front of it would only be a
 * second place for that state to be wrong.
 *
 * Deliberately no QR code. Rendering one needs an encoder, and the repo just
 * finished shedding dependencies it wasn't using; every authenticator app
 * accepts a typed setup key, and on a phone the otpauth:// link opens the app
 * directly. If a QR is wanted later it is one library and one <canvas> here.
 *
 * Written with divs and type="button" throughout: this renders *inside* the
 * profile form, and a nested <form> is invalid HTML that browsers resolve by
 * silently dropping one of them.
 */

type Stage =
  | { name: 'idle' }
  | { name: 'password'; intent: 'enable' | 'disable' }
  // Enrolment is two steps on purpose: better-auth hands over the secret
  // first and only flips twoFactorEnabled once a code proves the
  // authenticator actually has it. Skipping the proof is how people lock
  // themselves out of their own account.
  | { name: 'verify'; totpURI: string; backupCodes: string[] }
  | { name: 'saved'; backupCodes: string[] };

/** The shared secret out of an otpauth:// URI, for typing into an app by hand. */
function setupKeyFrom(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export default function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [stage, setStage] = React.useState<Stage>({ name: 'idle' });
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const refreshUser = () => {
    queryClient.invalidateQueries({ queryKey: trpc.user.me.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.user.getAll.queryKey() });
  };

  const reset = () => {
    setStage({ name: 'idle' });
    setPassword('');
    setCode('');
    setError(null);
  };

  const handlePasswordSubmit = async () => {
    if (stage.name !== 'password' || !password) return;
    setError(null);
    setBusy(true);

    try {
      if (stage.intent === 'disable') {
        const res = await authClient.twoFactor.disable({ password });
        if (res.error) {
          setError(res.error.message || 'That password was not accepted.');
          return;
        }
        refreshUser();
        reset();
        return;
      }

      const res = await authClient.twoFactor.enable({ password });
      if (res.error || !res.data) {
        setError(res.error?.message || 'That password was not accepted.');
        return;
      }
      // The plugin's response is a union over the second-factor methods it
      // was configured with. StayUp only enables TOTP (src/lib/auth.ts passes
      // no otpOptions), so this branch is always taken — narrowed rather than
      // cast, so wiring up e-mail OTP later is a compile error here instead of
      // an undefined at runtime.
      if (!('totpURI' in res.data)) {
        setError('This instance is not set up for authenticator apps.');
        return;
      }
      setPassword('');
      setStage({ name: 'verify', totpURI: res.data.totpURI, backupCodes: res.data.backupCodes });
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (stage.name !== 'verify' || code.length !== 6) return;
    setError(null);
    setBusy(true);

    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setError(res.error.message || 'That code was not accepted — check your device clock and try again.');
        setCode('');
        return;
      }
      refreshUser();
      setStage({ name: 'saved', backupCodes: stage.backupCodes });
      setCode('');
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setBusy(false);
    }
  };

  const copyBackupCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the codes are on screen either way.
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-normal">Two-factor authentication</Label>
        {enabled ? (
          <Badge variant="secondary" className="gap-1.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            <ShieldCheck className="h-3.5 w-3.5" />
            On
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5">
            <ShieldOff className="h-3.5 w-3.5" />
            Off
          </Badge>
        )}
      </div>

      {stage.name === 'idle' && (
        <>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? 'Signing in asks for a 6-digit code from your authenticator app after your password.'
              : 'An Admin here can reroute every alert and read every stored credential, so a password on its own is thin. Enrol an authenticator app and sign-in asks for a code as well.'}
          </p>
          <Button
            type="button"
            variant={enabled ? 'outline' : 'default'}
            size="sm"
            onClick={() => setStage({ name: 'password', intent: enabled ? 'disable' : 'enable' })}
          >
            {enabled ? 'Turn off' : 'Set up'}
          </Button>
        </>
      )}

      {stage.name === 'password' && (
        <div className="space-y-2">
          <Label htmlFor="tf-password" className="text-xs font-normal">
            Confirm your password
          </Label>
          <Input
            id="tf-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // Enter would otherwise submit the surrounding profile form.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handlePasswordSubmit();
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !password} onClick={() => void handlePasswordSubmit()}>
              {busy ? 'Checking…' : stage.intent === 'disable' ? 'Turn off' : 'Continue'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {stage.name === 'verify' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Add this key to your authenticator app, then enter the code it shows.
            </p>
            <code className="block rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">
              {setupKeyFrom(stage.totpURI)}
            </code>
            <a href={stage.totpURI} className="text-xs text-primary hover:underline">
              Open in an authenticator app
            </a>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tf-code" className="text-xs font-normal">
              6-digit code
            </Label>
            <Input
              id="tf-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleVerify();
                }
              }}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy || code.length !== 6} onClick={() => void handleVerify()}>
                {busy ? 'Verifying…' : 'Verify & turn on'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {stage.name === 'saved' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Two-factor authentication is on. Save these backup codes somewhere safe — each one works
            once, and they are the only way back in if you lose your device. This is the only time
            they are shown.
          </p>
          <div className="grid grid-cols-2 gap-1 rounded bg-muted p-2 font-mono text-xs">
            {stage.backupCodes.map((backupCode) => (
              <span key={backupCode}>{backupCode}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copyBackupCodes(stage.backupCodes)}>
              {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
              {copied ? 'Copied' : 'Copy codes'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
