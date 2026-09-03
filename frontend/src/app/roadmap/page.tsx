import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, ArrowLeft, CheckCircle, Circle, Clock, Rocket } from "lucide-react";

export const metadata: Metadata = {
  title: "Roadmap | VANTA",
  description: "Explore the VANTA product roadmap — see what we've built, what we're working on, and what's coming next.",
  openGraph: {
    title: "Roadmap | VANTA",
    description: "Explore the VANTA product roadmap.",
    type: "website",
    siteName: "VANTA",
  },
};

const timelineItems = [
  {
    phase: "Phase 1",
    title: "Foundation",
    status: "completed" as const,
    items: [
      "Core social platform architecture",
      "User authentication & security",
      "Profile creation and management",
      "Real-time messaging system",
      "Push notification infrastructure",
    ],
  },
  {
    phase: "Phase 2",
    title: "Social Discovery",
    status: "completed" as const,
    items: [
      "Discover feed with AI recommendations",
      "Swipe-based profile discovery",
      "User search and filters",
      "Interest-based matching",
      "Advanced privacy controls",
    ],
  },
  {
    phase: "Phase 3",
    title: "Live Streaming",
    status: "completed" as const,
    items: [
      "Live streaming infrastructure",
      "Real-time viewer engagement",
      "Stream gifts and reactions",
      "Stream categories and discovery",
      "Moderation tools",
    ],
  },
  {
    phase: "Phase 4",
    title: "Community & Growth",
    status: "in-progress" as const,
    items: [
      "Community creation and management",
      "Voice rooms and audio chat",
      "AI-powered content moderation",
      "Advanced analytics dashboard",
      "Mobile app development",
    ],
  },
  {
    phase: "Phase 5",
    title: "Creator Economy",
    status: "upcoming" as const,
    items: [
      "Creator monetization platform",
      "Subscription tiers and memberships",
      "Digital gift marketplace",
      "Revenue analytics and payouts",
      "Brand partnership tools",
    ],
  },
  {
    phase: "Phase 6",
    title: "Platform Evolution",
    status: "upcoming" as const,
    items: [
      "Global expansion and localization",
      "Web3 and NFT integration",
      "VR/AR social experiences",
      "Developer API platform",
      "Decentralized governance",
    ],
  },
];

const statusColors = {
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "in-progress": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  upcoming: "bg-white/[0.04] text-white/40 border-white/[0.06]",
};

const statusIcons = {
  completed: CheckCircle,
  "in-progress": Clock,
  upcoming: Circle,
};

export default function RoadmapPage() {
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
          <h1 className="text-4xl  font-black tracking-tight mb-4">Product Roadmap</h1>
          <p className="text-white/40 text-lg max-w-2xl">A live look at what we've built, what we're working on, and where we're headed.</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-[#d6a83f]/30 via-[#151517]0/20 to-transparent" />

          <div className="space-y-12">
            {timelineItems.map((phase, idx) => {
              const StatusIcon = statusIcons[phase.status];
              return (
                <div key={phase.phase} className="relative pl-20">
                  {/* Timeline dot */}
                  <div className={`absolute left-4 top-1 w-9 h-9 rounded-full border-2 flex items-center justify-center ${
                    phase.status === "completed" ? "border-emerald-500/50 bg-emerald-500/10" :
                    phase.status === "in-progress" ? "border-amber-500/50 bg-amber-500/10" :
                    "border-white/[0.1] bg-white/[0.02]"
                  }`}>
                    <StatusIcon size={14} className={
                      phase.status === "completed" ? "text-emerald-400" :
                      phase.status === "in-progress" ? "text-amber-400" :
                      "text-white/20"
                    } />
                  </div>

                  {/* Content */}
                  <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${statusColors[phase.status]}`}>
                        {phase.status === "completed" ? "Completed" : phase.status === "in-progress" ? "In Progress" : "Upcoming"}
                      </span>
                      <span className="text-[10px] text-white/30 uppercase tracking-wider">{phase.phase}</span>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-3">{phase.title}</h3>
                    <ul className="space-y-2">
                      {phase.items.map((item) => (
                        <li key={item} className="flex items-center gap-2.5 text-sm text-white/50">
                          <div className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Future Vision */}
        <div className="mt-16 rounded-[32px] border border-white/[0.06] bg-gradient-to-br from-[#d6a83f]/[0.02] to-[#151517]0/[0.02] p-8 text-center">
          <Rocket size={32} className="text-[#d6a83f]/60 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Our Vision</h2>
          <p className="text-sm text-white/40 max-w-lg mx-auto leading-relaxed">
            We're building the most immersive social platform ever created. 
            A place where technology fades away and authentic human connection takes center stage. 
            This is just the beginning.
          </p>
        </div>
      </div>
    </div>
  );
}