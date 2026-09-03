"use client";

import Link from "next/link";
import { API_BASE_URL } from '@/lib/api';
import { useState, useEffect } from "react";
import { Mail, ArrowLeft, ChevronRight, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { ApiError } from "@/lib/api";
import VantaLogo from "@/components/ui/VantaLogo";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Failed to send reset email');
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#07070d] overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(255,0,127,0.06)_0%,transparent_100%),radial-gradient(circle_at_50%_0%,rgba(6,247,255,0.03)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:52px_52px]" />
      </div>

      <div className="w-full min-h-screen flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="relative rounded-[28px] bg-white/[0.03] backdrop-blur-2xl border border-white/[0.06] overflow-hidden shadow-2xl shadow-[#151517]0/5">
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            <div className="relative p-8 ">
              {sent ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={32} className="text-emerald-400" />
                  </div>
                  <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
                  <p className="text-sm text-white/40 mb-6">
                    We've sent a password reset link to <strong className="text-white/60">{email}</strong>
                  </p>
                  <p className="text-xs text-white/30 mb-6">
                    Didn't receive the email? Check your spam folder or{" "}
                    <button onClick={() => setSent(false)} className="text-[#d6a83f]/60 hover:text-[#d6a83f] transition-colors">
                      try again
                    </button>
                  </p>
                  <Link href="/login" className="btn-secondary inline-flex items-center gap-2">
                    <ArrowLeft size={14} />
                    Back to Login
                  </Link>
                </div>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <Link href="/" className="inline-flex items-center gap-2 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc] flex items-center justify-center shadow-lg shadow-[#d6a83f]/20">
                        <VantaLogo size={28} />
                      </div>
                      <span className="text-xl font-semibold tracking-[0.2em] text-white">VANTA</span>
                    </Link>
                    <h1 className="text-2xl font-bold text-white">Forgot Password</h1>
                    <p className="text-sm text-white/40 mt-1">We'll send you a reset link</p>
                  </div>

                  {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="form-error mb-5">
                      {error}
                    </motion.div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="form-label">Email Address</label>
                      <div className="relative group">
                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[#d6a83f]/60 transition-colors">
                          <Mail size={15} />
                        </div>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setError(""); }}
                          placeholder="you@example.com"
                          className="form-input pl-10"
                          required
                        />
                      </div>
                    </div>

                    <button type="submit" disabled={loading} className="btn-primary w-full h-12">
                      {loading ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        "Send Reset Link"
                      )}
                    </button>
                  </form>

                  <div className="mt-6 pt-6 border-t border-white/[0.04] text-center">
                    <Link href="/login" className="text-white/60 hover:text-[#d6a83f] font-medium transition-colors inline-flex items-center gap-1 group text-sm">
                      <ArrowLeft size={12} /> Back to Login
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}