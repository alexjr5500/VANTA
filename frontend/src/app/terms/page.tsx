import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";

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

const sections = [
  {
    title: "Acceptance of Terms",
    body: "By accessing or using VANTA, you agree to be bound by these Terms of Service. If you do not agree, do not use our services.",
  },
  {
    title: "Account Registration",
    body: "You must provide accurate information when creating an account. You are responsible for maintaining the confidentiality of your credentials and for all activities under your account.",
  },
  {
    title: "User Conduct",
    body: "You agree not to violate laws or regulations, harass or harm others, post harmful content, impersonate another person or entity, attempt to breach platform security, or use automated tools or bots without permission.",
  },
  {
    title: "Content Ownership",
    body: "You retain ownership of content you create and share on VANTA. By posting content, you grant VANTA a license to display and distribute it on the platform. You represent that you have the rights needed to share that content.",
  },
  {
    title: "Intellectual Property",
    body: "The VANTA name, logo, and platform design are protected by intellectual property laws. You may not copy, modify, or distribute VANTA branding without permission.",
  },
  {
    title: "Termination",
    body: "VANTA may suspend or terminate accounts that violate these terms or engage in harmful behavior. You may delete your account at any time.",
  },
  {
    title: "Limitation of Liability",
    body: "VANTA is provided “as is” without warranties. To the fullest extent permitted by law, VANTA is not liable for damages arising from your use of the platform.",
  },
  {
    title: "Changes to Terms",
    body: "We may update these terms from time to time. Continued use after changes take effect constitutes acceptance. We will notify users of material changes through email or an in-platform notice where appropriate.",
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen w-full bg-[#07070d] text-white">
      <PageHeader sticky bleed title="Terms of Service" back />
      <main className="w-full px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        <div className="w-full border-b border-white/[0.08] pb-6">
          <p className="text-sm leading-relaxed text-white/55">The rules that keep VANTA safe</p>
          <p className="mt-3 text-xs text-white/35">Last updated: July 17, 2026</p>
        </div>

        <article className="w-full divide-y divide-white/[0.07]">
          {sections.map((section, index) => (
            <section key={section.title} className="grid w-full gap-2 py-6 sm:grid-cols-[minmax(150px,0.32fr)_minmax(0,1fr)] sm:gap-8">
              <h2 className="text-base font-semibold leading-snug text-white">{index + 1}. {section.title}</h2>
              <p className="text-sm leading-7 text-white/60">{section.body}</p>
            </section>
          ))}
          <section className="grid w-full gap-2 py-6 sm:grid-cols-[minmax(150px,0.32fr)_minmax(0,1fr)] sm:gap-8">
            <h2 className="text-base font-semibold leading-snug text-white">9. Contact</h2>
            <p className="text-sm leading-7 text-white/60">
              For questions about these terms, contact{" "}
              <a href="mailto:vantapp74@gmail.com" className="text-white underline decoration-white/30 underline-offset-4 transition hover:text-[#d6b45a]">
                vantapp74@gmail.com
              </a>.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
