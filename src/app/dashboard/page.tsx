import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  User,
  Mail,
  ShieldCheck,
  Calendar,
  LogOut,
  Zap,
  CheckCircle2,
  Lock,
} from "lucide-react";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const user = session.user;

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-12">
      {/* Welcome Banner */}
      <div className="bg-white p-8 rounded-2xl border border-purple-100 shadow-xl shadow-purple-500/5 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center font-bold text-2xl shrink-0">
            {user.name ? user.name[0].toUpperCase() : "U"}
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-purple-950">
              Welcome back, {user.name || "User"}! 👋
            </h1>
            <p className="text-sm text-purple-800/80 font-medium mt-1">
              Here is an overview of your NextTemp account and session.
            </p>
          </div>
        </div>

        <Link
          href="/logout"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-purple-50 hover:bg-red-50 text-purple-700 hover:text-red-600 font-semibold text-sm border border-purple-100 hover:border-red-100 transition-all shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </Link>
      </div>

      {/* Grid Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* User Details Card */}
        <div className="md:col-span-2 bg-white p-6 rounded-2xl border border-purple-100 shadow-sm">
          <h2 className="text-lg font-bold text-purple-950 mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-purple-600" />
            <span>Profile Details</span>
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-purple-50/50 border border-purple-100/60">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-purple-900">Name</span>
              </div>
              <span className="text-sm font-medium text-purple-950">
                {user.name || "N/A"}
              </span>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-purple-50/50 border border-purple-100/60">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-purple-900">Email</span>
              </div>
              <span className="text-sm font-medium text-purple-950">
                {user.email}
              </span>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-purple-50/50 border border-purple-100/60">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-purple-900">Joined</span>
              </div>
              <span className="text-sm font-medium text-purple-950">
                {new Date(user.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Security / Status Card */}
        <div className="bg-white p-6 rounded-2xl border border-purple-100 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-purple-950 mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-600" />
              <span>Authentication Status</span>
            </h2>

            <div className="p-4 rounded-xl bg-purple-50 border border-purple-100 space-y-3">
              <div className="flex items-center gap-2 text-purple-900 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span>Active Session</span>
              </div>
              <p className="text-xs text-purple-800/80 leading-relaxed">
                Your session is authenticated via BetterAuth and protected with secure HTTP-only cookies.
              </p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-purple-100 text-xs font-medium text-purple-400 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>Protected Route (Server Side)</span>
          </div>
        </div>
      </div>
    </main>
  );
}