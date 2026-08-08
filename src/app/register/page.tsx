'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Lock, User, Mail, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { registerSchema } from '@/validations/auth';

export default function SignUpPage() {
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
                <Lock className="w-6 h-6" strokeWidth={2} />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-purple-950 mb-2">
                Create Account
              </h1>
              <p className="text-sm text-purple-800/80 font-medium">
                Get started with your NextTemp application
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
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-5 h-5 text-purple-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    name="name"
                    type="text"
                    placeholder="John Doe"
                    className={`w-full pl-11 pr-4 py-2.5 rounded-xl bg-purple-50/50 border text-purple-950 placeholder:text-purple-300 focus:outline-none focus:ring-2 font-medium transition-all ${
                      fieldErrors.name
                        ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
                        : 'border-purple-100 focus:ring-purple-600/20 focus:border-purple-600'
                    }`}
                  />
                </div>
                {fieldErrors.name && (
                  <p className="text-xs text-red-600 font-medium mt-1.5">{fieldErrors.name}</p>
                )}
              </div>

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
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-sm font-medium text-purple-800/80">
              Already have an account?{' '}
              <Link
                href="/login"
                className="text-purple-600 hover:text-purple-800 font-semibold transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}