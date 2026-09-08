import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { caller } from '@/trpc/server';

import Link from 'next/link';
import {
  User,
  Mail,
  ShieldCheck,
  Calendar,
  LogOut,
  CheckCircle2,
  Lock,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect('/login');
  }

  const user = session.user;

  // The layout above owns both the max-width and the <main> element now, so
  // this page just contributes content.
  return (
    <div className="flex-1">
      <Card className="mb-8 shadow-sm">
        <CardContent className="p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <Avatar className="w-16 h-16 rounded-2xl">
              <AvatarImage src={user.image ?? undefined} alt={user.name || 'User'} />
              <AvatarFallback className="rounded-2xl bg-primary/10 text-primary font-bold text-2xl">
                {user.name ? user.name[0].toUpperCase() : 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
                Welcome back, {user.name || 'User'}! 👋
              </h1>
              <p className="text-sm text-muted-foreground font-medium mt-1">
                The uptime monitor for you
              </p>
            </div>
          </div>

          <Button variant="outline" size="sm" className="gap-2 shrink-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20">
            <Link href="/logout">
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Grid Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* User Details Card */}
        <Card className="md:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              <span>Profile Details</span>
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/50 border border-border/60">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Name</span>
              </div>
              <span className="text-sm font-medium text-foreground">
                {user.name || 'N/A'}
              </span>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/50 border border-border/60">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Email</span>
              </div>
              <span className="text-sm font-medium text-foreground">
                {user.email}
              </span>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/50 border border-border/60">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Joined</span>
              </div>
              <span className="text-sm font-medium text-foreground">
                {new Date(user.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Security / Status Card */}
        <Card className="shadow-sm flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span>Authentication Status</span>
            </CardTitle>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col justify-between">
            <div className="p-4 rounded-xl bg-muted/50 border border-border/60 space-y-3">
              <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                <span>Active Session</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your session is authenticated via BetterAuth and protected with secure HTTP-only cookies.
              </p>
            </div>

            <div className="mt-6">
              <Separator className="mb-4" />
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                <span>Protected Route (Server Side)</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}