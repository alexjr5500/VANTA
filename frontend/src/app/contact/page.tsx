"use client";

import Link from "next/link";
import { Sparkles, ArrowLeft, Mail, HelpCircle, Briefcase, Send } from "lucide-react";
import { SocialLinks } from "@/components/ui/SocialLinks";
import {
  VANTA_SOCIAL_LINKS,
  VANTA_SUPPORT_EMAIL,
  VANTA_GENERAL_EMAIL,
} from "@/lib/socialLinks";

export default function ContactPage() {
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
          <p className="text-white/40 text-lg max-w-xl">We&apos;d love to hear from you. Reach out to our team for any questions or support.</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid gap-12">
          {/* Contact Info */}
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">Get in Touch</h2>
              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.14] flex items-center justify-center shrink-0">
                    <HelpCircle size={16} className="text-[#c8c8cc]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Support</h3>
                    <a href={`mailto:${VANTA_SUPPORT_EMAIL}`} className="text-sm text-white/40 hover:text-white transition-colors">
                      {VANTA_SUPPORT_EMAIL}
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#d6a83f]/10 border border-[#d6a83f]/20 flex items-center justify-center shrink-0">
                    <Mail size={16} className="text-[#d6a83f]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">General Inquiries</h3>
                    <a href={`mailto:${VANTA_GENERAL_EMAIL}`} className="text-sm text-white/40 hover:text-white transition-colors">
                      {VANTA_GENERAL_EMAIL}
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.14] flex items-center justify-center shrink-0">
                    <Briefcase size={16} className="text-[#c8c8cc]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">Business Enquiries</h3>
                    <a href={`mailto:${VANTA_GENERAL_EMAIL}`} className="text-sm text-white/40 hover:text-white transition-colors">
                      {VANTA_GENERAL_EMAIL}
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Social links — single source of truth (shared constants) */}
            <div className="pt-6 border-t border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white mb-4">Follow Us</h3>
              <div className="flex items-center gap-3">
                <SocialLinks iconSize="lg" variant="hero" />
              </div>
              <p className="mt-4 text-xs text-white/30">
                {VANTA_SOCIAL_LINKS.map((link) => link.label).join(" \u00b7 ")}
              </p>
            </div>
          </div>

          {/* Contact channels */}
          <div className="space-y-5">
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6">
              <h2 className="text-lg font-semibold text-white mb-2">Send us a message</h2>
              <p className="text-sm text-white/40 leading-relaxed mb-5">
                Prefer to write to us directly? Compose an email to our support address
                and our team will reply within a day.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href={`mailto:${VANTA_SUPPORT_EMAIL}?subject=VANTA%20Support`}
                  className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white font-semibold text-sm px-6 h-12 transition-all duration-300 hover:shadow-lg hover:shadow-[#d6a83f]/20"
                >
                  Email Support <Send size={14} className="transition-transform group-hover:translate-x-0.5" />
                </a>
                {VANTA_SOCIAL_LINKS.map((link) => (
                  <a
                    key={link.platform}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-sm text-white/60 hover:text-white hover:bg-white/[0.06] hover:border-white/20 px-6 h-12 transition-all duration-200"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
