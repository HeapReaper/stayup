'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

/** TOTP codes are always six digits; a backup code is the escape hatch when the phone isn't. */
const TOTP_LENGTH = 6;

export default function TwoFactorClientPage({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [backupCode, setBackupCode] = React.useState('');
  const [useBackupCode, setUseBackupCode] = React.useState(false);
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function submit(verify: () => Promise<{ error?: { message?: string } | null }>) {
    setError(null);
    setLoading(true);

    try {
      const res = await verify();
      if (res.error) {
        setError(res.error.message || 'That code was not accepted.');
        setCode('');
        return;
      }
      router.push(callbackUrl);
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  const handleTotp = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== TOTP_LENGTH) return;
    void submit(() => authClient.twoFactor.verifyTotp({ code, trustDevice }));
  };

  const handleBackupCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupCode.trim()) return;
    void submit(() => authClient.twoFactor.verifyBackupCode({ code: backupCode.trim() }));
  };

  return (
    <div className="min-h-screen bg-muted/40 text-foreground flex flex-col justify-between">
      <main className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-md"
        >
          <Card className="shadow-lg">
            <CardHeader className="text-center space-y-2 pb-6">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="w-6 h-6" strokeWidth={2} />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">Two-Factor Authentication</CardTitle>
              <CardDescription className="text-sm">
                {useBackupCode
                  ? 'Enter one of the backup codes you saved when you set this up.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {error && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mb-6">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}

              {useBackupCode ? (
                <form onSubmit={handleBackupCode} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="backupCode">Backup code</Label>
                    <Input
                      id="backupCode"
                      autoComplete="one-time-code"
                      placeholder="xxxxx-xxxxx"
                      value={backupCode}
                      onChange={(e) => setBackupCode(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Each backup code works once. After signing in, generate a fresh set from your
                      profile if you are running low.
                    </p>
                  </div>

                  <Button type="submit" disabled={loading || !backupCode.trim()} className="w-full" size="lg">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>
                      <span>Verify</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleTotp} className="space-y-4">
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={TOTP_LENGTH}
                      value={code}
                      onChange={setCode}
                      // Submitting on the sixth digit is the whole interaction:
                      // there is nothing else on this form to fill in.
                      onComplete={(value) =>
                        void submit(() => authClient.twoFactor.verifyTotp({ code: value, trustDevice }))
                      }
                      autoFocus
                    >
                      <InputOTPGroup>
                        {Array.from({ length: TOTP_LENGTH }, (_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  <label className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={trustDevice}
                      onChange={(e) => setTrustDevice(e.target.checked)}
                    />
                    Don&apos;t ask again on this device for 60 days
                  </label>

                  <Button type="submit" disabled={loading || code.length !== TOTP_LENGTH} className="w-full" size="lg">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>
                      <span>Verify</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>}
                  </Button>
                </form>
              )}

              <div className="mt-6 flex flex-col items-center gap-2 text-sm">
                <button
                  type="button"
                  className="text-primary hover:underline font-medium"
                  onClick={() => {
                    setUseBackupCode((prev) => !prev);
                    setError(null);
                  }}
                >
                  {useBackupCode ? 'Use my authenticator app instead' : 'I lost my device — use a backup code'}
                </button>
                <Link href="/login" className="text-muted-foreground hover:underline">
                  Back to sign in
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
