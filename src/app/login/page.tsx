'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Lock, Mail, ArrowRight, Loader2, AlertCircle, LogIn } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { loginSchema } from '@/validations/auth';

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    const rawData = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    };

    const validationResult = loginSchema.safeParse(rawData);

    if (!validationResult.success) {
      const formattedErrors = validationResult.error.format();
      setFieldErrors({
        email: formattedErrors.email?._errors[0],
        password: formattedErrors.password?._errors[0],
      });
      return;
    }

    setLoading(true);

    try {
      const res = await authClient.signIn.email({
        email: validationResult.data.email,
        password: validationResult.data.password,
      });

      if (res.error) {
        setError(res.error.message || 'Something went wrong.');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-purple-50 text-purple-950 selection:bg-purple-200 flex flex-col justify-between">
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-md"
        >
          <div className="bg-white p-8 rounded-2xl border border-purple-100 shadow-xl shadow-purple-500/5">
            <div className="text-center mb-8">
              <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <LogIn className="w-6 h-6" strokeWidth={2} />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-purple-950 mb-2">
                Welcome Back
              </h1>
              <p className="text-sm text-purple-800/80 font-medium">
                Sign in to your NextTemp account
              </p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-6 p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-medium flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div>
                <label className="block text-sm font-semibold text-purple-900 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-5 h-5 text-purple-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    name="email"
                    type="email"
                    placeholder="john@example.com"
                    className={`w-full pl-11 pr-4 py-2.5 rounded-xl bg-purple-50/50 border text-purple-950 placeholder:text-purple-300 focus:outline-none focus:ring-2 font-medium transition-all ${
                      fieldErrors.email
                        ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
                        : 'border-purple-100 focus:ring-purple-600/20 focus:border-purple-600'
                    }`}
                  />
                </div>
                {fieldErrors.email && (
                  <p className="text-xs text-red-600 font-medium mt-1.5">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-purple-900 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-purple-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    className={`w-full pl-11 pr-4 py-2.5 rounded-xl bg-purple-50/50 border text-purple-950 placeholder:text-purple-300 focus:outline-none focus:ring-2 font-medium transition-all ${
                      fieldErrors.password
                        ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
                        : 'border-purple-100 focus:ring-purple-600/20 focus:border-purple-600'
                    }`}
                  />
                </div>
                {fieldErrors.password && (
                  <p className="text-xs text-red-600 font-medium mt-1.5">{fieldErrors.password}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20 transition-all hover:shadow-purple-600/30 active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed mt-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-sm font-medium text-purple-800/80">
              Don&apos;t have an account yet?{' '}
              <Link
                href="/register"
                className="text-purple-600 hover:text-purple-800 font-semibold transition-colors"
              >
                Create one
              </Link>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}