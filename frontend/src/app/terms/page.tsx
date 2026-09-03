import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service | VANTA",
  description: "VANTA Terms of Service — The terms governing your use of the VANTA platform.",
  openGraph: {
    title: "Terms of Service | VANTA",
    description: "The terms governing your use of the VANTA platform.",
    type: "website",
    siteName: "VANTA",
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#07070d] text-white">
      <div className="relative border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.04)_0%,_transparent_60%)]" />
        <div className="relative max-w-4xl mx-auto px-4 py-16 ">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors mb-6">
            <ArrowLeft size={14} /> Back to Home
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center overflow-hidden">
              <span className="text-lg font-bold text-white">V</span>
            </div>
            <span className="text-lg font-bold">
              VANTA
            </span>
          </div>
          <h1 className="text-4xl  font-black tracking-tight mb-4">Terms of Service</h1>
          <p className="text-white/40">Last updated: July 17, 2026</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="space-y-8 text-white/60 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
            <p>By accessing or using VANTA, you agree to be bound by these Terms of Service. If you do not agree, do not use our services.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">2. Account Registration</h2>
            <p>You must provide accurate information when creating an account. You are responsible for maintaining the confidentiality of your credentials and for all activities under your account.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">3. User Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Violate any laws or regulations</li>
              <li>Harass, abuse, or harm others</li>
              <li>Post inappropriate or harmful content</li>
              <li>Impersonate other users or entities</li>
              <li>Attempt to breach platform security</li>
              <li>Use automated tools or bots without permission</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">4. Content Ownership</h2>
            <p>You retain ownership of content you create and share on VANTA. By posting content, you grant us a license to display and distribute it on our platform. You represent that you have the rights to any content you share.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">5. Intellectual Property</h2>
            <p>The VANTA name, logo, and platform design are protected by intellectual property laws. You may not copy, modify, or distribute our branding without permission.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">6. Termination</h2>
            <p>We reserve the right to suspend or terminate accounts that violate these terms or engage in harmful behavior. You may delete your account at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">7. Limitation of Liability</h2>
            <p>VANTA is provided &ldquo;as is&rdquo; without warranties. We are not liable for damages arising from your use of the platform, to the fullest extent permitted by law.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">8. Changes to Terms</h2>
            <p>We may update these terms at any time. Continued use after changes constitutes acceptance. We will notify you of material changes via email or platform notice.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">9. Contact</h2>
            <p>For questions about these terms, contact <a href="mailto:legal@vanta.app" className="text-white/60 hover:text-white transition-colors">legal@vanta.app</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}