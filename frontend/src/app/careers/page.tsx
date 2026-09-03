import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, ArrowLeft, Zap, Heart, Shield, Users, Globe, Coffee } from "lucide-react";

export const metadata: Metadata = {
  title: "Careers | VANTA",
  description: "Join VANTA and help shape the future of social connection. Explore open positions and build your career with us.",
  openGraph: {
    title: "Careers | VANTA",
    description: "Join VANTA and help shape the future of social connection.",
    type: "website",
    siteName: "VANTA",
  },
};

const benefits = [
  { icon: Zap, title: "Cutting-Edge Tech", desc: "Work with modern tech stack — Next.js, React, TypeScript, Node.js, and more." },
  { icon: Globe, title: "Remote-First", desc: "Work from anywhere in the world. We trust our team to do their best work." },
  { icon: Heart, title: "Health & Wellness", desc: "Comprehensive health coverage, mental health support, and wellness programs." },
  { icon: Shield, title: "Equity & Ownership", desc: "Every full-time team member gets equity. We build this together." },
  { icon: Users, title: "Amazing Team", desc: "Work with passionate, talented people who care about what they build." },
  { icon: Coffee, title: "Top-Tier Equipment", desc: "Get the gear you need to do your best work — from day one." },
];

export default function CareersPage() {
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
          <h1 className="text-4xl  font-black tracking-tight mb-4">Join the Team</h1>
          <p className="text-white/40 text-lg max-w-2xl">Help us build the future of social connection. We're looking for passionate people who want to make a difference.</p>
        </div>
      </div>

      {/* Mission */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h2 className="text-2xl  font-bold text-white mb-4">Our Mission</h2>
          <p className="text-white/60 leading-relaxed max-w-2xl mx-auto">
            At VANTA, we're building a platform where authentic human connection thrives. 
            We believe technology should bring people closer, not push them apart. 
            Join us in creating something meaningful.
          </p>
        </div>

        {/* Benefits */}
        <h2 className="text-2xl font-bold text-white text-center mb-8">Why Work at VANTA</h2>
        <div className="grid   gap-4 mb-16">
          {benefits.map((benefit) => (
            <div key={benefit.title} className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc] flex items-center justify-center mb-4">
                <benefit.icon size={18} className="text-white" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-2">{benefit.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{benefit.desc}</p>
            </div>
          ))}
        </div>

        {/* Open Positions */}
        <div className="rounded-[32px] border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
            <Users size={28} className="text-white/40" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No Open Positions Right Now</h3>
          <p className="text-sm text-white/40 max-w-md mx-auto mb-6">
            We're not actively hiring at the moment, but we're always looking for talented people. 
            Send your resume and we'll keep you in mind for future opportunities.
          </p>
          <a
            href="mailto:careers@vanta.app"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white font-semibold text-sm hover:shadow-lg hover:shadow-[#d6a83f]/20 transition-all duration-300"
          >
            Send Resume
          </a>
          <p className="text-xs text-white/20 mt-3">careers@vanta.app</p>
        </div>
      </div>
    </div>
  );
}