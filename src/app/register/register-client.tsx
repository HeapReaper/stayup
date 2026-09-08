'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Lock, User, Mail, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { registerSchema } from '@/validations/auth';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function RegisterClientPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    const rawData = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    };

    const validationResult = registerSchema.safeParse(rawData);

    if (!validationResult.success) {
      const formattedErrors = validationResult.error.format();
      setFieldErrors({
        name: formattedErrors.name?._errors[0],
        email: formattedErrors.email?._errors[0],
        password: formattedErrors.password?._errors[0],
      });
      return;
    }

    setLoading(true);

    try {
      const res = await authClient.signUp.email({
        name: validationResult.data.name,
        email: validationResult.data.email,
        password: validationResult.data.password,
      });

      if (res.error) {
        setError(res.error.message || 'Something went wrong.');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

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
                <Lock className="w-6 h-6" strokeWidth={2} />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                Create Account
              </CardTitle>
              <CardDescription className="text-sm">
                Get started with your StayUp application
              </CardDescription>
            </CardHeader>

            <CardContent>
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mb-6"
                >
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <div className="relative">
                    <User className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="name"
                      name="name"
                      type="text"
                      placeholder="John Doe"
                      className="pl-9"
                      aria-invalid={!!fieldErrors.name}
                    />
                  </div>
                  {fieldErrors.name && (
                    <p className="text-xs text-destructive font-medium">{fieldErrors.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="john@example.com"
                      className="pl-9"
                      aria-invalid={!!fieldErrors.email}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="text-xs text-destructive font-medium">{fieldErrors.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="••••••••"
                      className="pl-9"
                      aria-invalid={!!fieldErrors.password}
                    />
                  </div>
                  {fieldErrors.password && (
                    <p className="text-xs text-destructive font-medium">{fieldErrors.password}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2"
                  size="lg"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Create Account</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>

            <CardFooter className="justify-center border-t p-6 mt-2">
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  href="/login"
                  className="text-primary hover:underline font-semibold transition-colors"
                >
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
