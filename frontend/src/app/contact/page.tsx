"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowLeft, Mail, Send, Check, Loader2, MessageSquare, HelpCircle, Briefcase } from "lucide-react";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Simulate send
    await new Promise((r) => setTimeout(r, 1500));
    setSending(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-[#07070d] text-white">
      {/* Header */}
      <div className="relative border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(214,168,63,0.055)_0%,_transparent_60%)]" />
        <div className="relative max-w-4xl mx-auto px-4 py-16 ">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors mb-6">
            <ArrowLeft size={14} /> Back to Home
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <span className="text-lg font-semibold tracking-[0.18em]">VANTA</span>
          </div>
          <h1 className="text-4xl  font-black tracking-tight mb-4">Contact Us</h1>
          <p className="text-white/40 text-lg max-w-xl">We'd love to hear from you. Reach out to our team for any questions or support.</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid  gap-12 ">
          {/* Contact Info */}
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">Get in Touch</h2>
              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#d6a83f]/10 border border-[#d6a83f]/20 flex items-center justify-center shrink-0">
                    <Mail size={16} className="text-[#d6a83f]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">General Inquiries</h3>
                    <a href="mailto:hello@vanta.app" className="text-sm text-white/40 hover:text-white transition-colors">hello@vanta.app</a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.14] flex items-center justify-center shrink-0">
                    <HelpCircle size={16} className="text-[#c8c8cc]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Support</h3>
                    <a href="mailto:support@vanta.app" className="text-sm text-white/40 hover:text-white transition-colors">support@vanta.app</a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.14] flex items-center justify-center shrink-0">
                    <Briefcase size={16} className="text-[#c8c8cc]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Business Enquiries</h3>
                    <a href="mailto:business@vanta.app" className="text-sm text-white/40 hover:text-white transition-colors">business@vanta.app</a>
                  </div>
                </div>
              </div>
            </div>

            {/* Social links */}
            <div className="pt-6 border-t border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white mb-4">Follow Us</h3>
              <div className="flex items-center gap-3">
                <a href="https://x.com/VANTA" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] hover:border-white/20 transition-all duration-200" aria-label="X (Twitter)">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
                <a href="https://t.me/VANTACommunity" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-[#d6a83f] hover:bg-white/[0.06] hover:border-[#d6a83f]/30 transition-all duration-200" aria-label="Telegram Community">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </a>
                <a href="https://t.me/VANTAUpdates" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-[#d6a83f] hover:bg-white/[0.06] hover:border-[#d6a83f]/30 transition-all duration-200" aria-label="Telegram Channel">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="rounded-[32px] border border-white/[0.06] bg-white/[0.02] p-6 ">
            {sent ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                  <Check size={28} className="text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Message Sent!</h3>
                <p className="text-sm text-white/40">We'll get back to you as soon as possible.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/40 mb-1.5">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full h-12 px-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-white text-sm outline-none focus:border-[#d6a83f]/30 focus:bg-white/[0.05] transition-all"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/40 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    className="w-full h-12 px-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-white text-sm outline-none focus:border-[#d6a83f]/30 focus:bg-white/[0.05] transition-all"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/40 mb-1.5">Subject</label>
                  <select
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    required
                    className="w-full h-12 px-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-white text-sm outline-none focus:border-[#d6a83f]/30 focus:bg-white/[0.05] transition-all"
                  >
                    <option value="">Select a subject</option>
                    <option value="support">Technical Support</option>
                    <option value="business">Business Inquiry</option>
                    <option value="press">Press / Media</option>
                    <option value="partnership">Partnership</option>
                    <option value="feedback">Feedback</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/40 mb-1.5">Message</label>
                  <textarea
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    required
                    rows={5}
                    className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-white text-sm outline-none focus:border-[#d6a83f]/30 focus:bg-white/[0.05] transition-all resize-none"
                    placeholder="How can we help you?"
                  />
                </div>
                <button
                  type="submit"
                  disabled={sending}
                  className="group relative w-full h-12 rounded-2xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white font-semibold text-sm transition-all duration-300 hover:shadow-lg hover:shadow-[#d6a83f]/20 disabled:opacity-50 flex items-center justify-center gap-2 overflow-hidden"
                >
                  {sending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      Send Message <Send size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}