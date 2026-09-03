import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy | VANTA",
  description: "VANTA Privacy Policy — Learn how we collect, use, and protect your personal data.",
  openGraph: {
    title: "Privacy Policy | VANTA",
    description: "Learn how VANTA collects, uses, and protects your personal data.",
    type: "website",
    siteName: "VANTA",
  },
};

export default function PrivacyPage() {
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
            <span className="text-lg font-bold">
              VANTA
            </span>
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-white/40">Last updated: [INSERT DATE]</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="space-y-8 text-white/60 leading-relaxed">
          {/* Intro */}
          <section>
            <p className="font-semibold text-white/90">Effective Date: [INSERT DATE]</p>
            <p className="font-semibold text-white/90">Last Updated: [INSERT DATE]</p>
            <p>VANTA (&ldquo;VANTA,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) respects your privacy.</p>
            <p>
              This Privacy Policy explains how VANTA collects, uses, stores, shares, protects, and otherwise processes
              information when you use the VANTA website, applications, services, and features, including social
              profiles, posts, Reels, Stories, Live, messaging, comments, virtual gifts, Balance, fundraising, and
              related services (collectively, the &ldquo;Service&rdquo;).
            </p>
            <p>
              VANTA is designed for users around the world. Depending on where you live, additional privacy rights and
              protections may apply to you.
            </p>
            <p>By using VANTA, you acknowledge that you have read and understood this Privacy Policy.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">1. WHO IS RESPONSIBLE FOR YOUR DATA?</h2>
            <p>The entity responsible for processing your personal information is:</p>
            <p><strong className="text-white/90">VANTA Legal Entity:</strong> [INSERT LEGAL COMPANY NAME]</p>
            <p><strong className="text-white/90">Registered Address:</strong> [INSERT ADDRESS]</p>
            <p><strong className="text-white/90">Country:</strong> [INSERT COUNTRY]</p>
            <p>For privacy-related questions:</p>
            <p><strong className="text-white/90">Privacy Team:</strong> [INSERT PRIVACY EMAIL]</p>
            <p><strong className="text-white/90">Data Protection Officer:</strong> [INSERT DPO EMAIL, IF APPLICABLE]</p>
            <p>
              Where local law requires a different data controller, representative, or privacy contact, VANTA may
              provide additional jurisdiction-specific information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">2. INFORMATION WE COLLECT</h2>
            <p>
              We collect information that you provide directly, information generated when you use VANTA, and
              information received from certain third parties.
            </p>
            <p>The information we collect depends on how you use VANTA.</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">2.1 Information You Provide</h3>
            <p>This may include:</p>

            <h4 className="text-base font-semibold text-white/90 mb-3">Account information</h4>
            <ul className="list-disc pl-6 space-y-2">
              <li>Name;</li>
              <li>Username;</li>
              <li>Email address;</li>
              <li>Phone number;</li>
              <li>Password or authentication credentials;</li>
              <li>Date of birth or age information;</li>
              <li>Profile photo;</li>
              <li>Biography;</li>
              <li>Profile information;</li>
              <li>Verification information where applicable.</li>
            </ul>

            <h4 className="text-base font-semibold text-white/90 mb-3">Content</h4>
            <p>When you use VANTA, you may provide:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Photos;</li>
              <li>Videos;</li>
              <li>Reels;</li>
              <li>Stories;</li>
              <li>Live-stream content;</li>
              <li>Audio;</li>
              <li>Posts;</li>
              <li>Comments;</li>
              <li>Captions;</li>
              <li>Messages;</li>
              <li>Channel content;</li>
              <li>Group content;</li>
              <li>Fundraising descriptions;</li>
              <li>Fundraising images and videos;</li>
              <li>Other information you choose to publish or send.</li>
            </ul>

            <h4 className="text-base font-semibold text-white/90 mb-3">Transaction information</h4>
            <p>If you purchase or use paid features, we may process information relating to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Purchases;</li>
              <li>Virtual currency;</li>
              <li>Balance;</li>
              <li>Gifts;</li>
              <li>Payment status;</li>
              <li>Refunds;</li>
              <li>Chargebacks;</li>
              <li>Transaction identifiers;</li>
              <li>Creator earnings or payouts, where applicable.</li>
            </ul>
            <p>
              Payment-card details may be processed directly by third-party payment providers rather than stored by
              VANTA, depending on the payment method used.
            </p>

            <h4 className="text-base font-semibold text-white/90 mb-3">Communications</h4>
            <p>
              If you contact VANTA, we may receive information contained in your communication, including support
              requests, reports, appeals, feedback, and correspondence.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">3. INFORMATION COLLECTED AUTOMATICALLY</h2>
            <p>When you access or use VANTA, certain information may be collected automatically.</p>
            <p>This may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>IP address;</li>
              <li>Device type;</li>
              <li>Operating system;</li>
              <li>Browser type;</li>
              <li>Application version;</li>
              <li>Device identifiers;</li>
              <li>Language and regional settings;</li>
              <li>Time zone;</li>
              <li>Network information;</li>
              <li>Approximate location derived from technical information;</li>
              <li>Login and session information;</li>
              <li>Pages, screens, and features accessed;</li>
              <li>Search activity within VANTA;</li>
              <li>Interactions with Content;</li>
              <li>Views, likes, follows, shares, comments, and other engagement;</li>
              <li>Performance and diagnostic information;</li>
              <li>Crash information;</li>
              <li>Security and fraud-related signals.</li>
            </ul>
            <p>We use this information to operate, secure, analyze, and improve VANTA.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">4. CAMERA, MICROPHONE AND MEDIA PERMISSIONS</h2>
            <p>Certain VANTA features may require access to your device camera, microphone, photos, videos, or other media.</p>
            <p>For example:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Creating a Reel may require camera or media-library access;</li>
              <li>Live streaming may require camera and microphone access;</li>
              <li>Uploading a profile photo may require photo-library access;</li>
              <li>Sending media through messages may require access to selected media.</li>
            </ul>
            <p>VANTA will request permission through your device&rsquo;s operating system where required.</p>
            <p>You can generally control these permissions through your device settings.</p>
            <p>VANTA does not access your camera or microphone merely because the application is installed.</p>
            <p>When you actively use features that require camera or microphone access, the relevant information may be processed to provide that feature.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">5. LOCATION INFORMATION</h2>
            <p>Some VANTA features may use location information.</p>
            <p>Depending on the feature and your permissions, this may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Approximate location;</li>
              <li>Device-derived location;</li>
              <li>Location information you voluntarily include in Content.</li>
            </ul>
            <p>VANTA will request device-level location permission where required.</p>
            <p>You may disable location permissions through your device settings.</p>
            <p>
              We do not require precise location information for ordinary use of VANTA unless a particular feature
              genuinely requires it and applicable law permits such processing.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">6. HOW WE USE YOUR INFORMATION</h2>
            <p>We may use information for the following purposes:</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Providing VANTA</h3>
            <p>To:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Create and manage accounts;</li>
              <li>Authenticate users;</li>
              <li>Provide profiles;</li>
              <li>Publish and display Content;</li>
              <li>Deliver Reels, Stories, posts, and other Content;</li>
              <li>Provide messaging;</li>
              <li>Provide Live streaming;</li>
              <li>Deliver notifications;</li>
              <li>Process transactions;</li>
              <li>Provide virtual gifts;</li>
              <li>Provide fundraising functionality;</li>
              <li>Provide customer support.</li>
            </ul>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Improving VANTA</h3>
            <p>To:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Understand how users interact with VANTA;</li>
              <li>Improve features;</li>
              <li>Develop new features;</li>
              <li>Test functionality;</li>
              <li>Analyze performance;</li>
              <li>Diagnose technical problems;</li>
              <li>Improve recommendations and discovery.</li>
            </ul>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Safety and Security</h3>
            <p>To:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Detect fraud;</li>
              <li>Prevent abuse;</li>
              <li>Protect accounts;</li>
              <li>Detect malicious activity;</li>
              <li>Investigate security incidents;</li>
              <li>Prevent spam;</li>
              <li>Protect users;</li>
              <li>Enforce our Terms and Community Guidelines.</li>
            </ul>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Legal Compliance</h3>
            <p>We may process information when necessary to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Comply with applicable laws;</li>
              <li>Respond to lawful requests;</li>
              <li>Protect legal rights;</li>
              <li>Investigate suspected illegal activity;</li>
              <li>Meet regulatory requirements;</li>
              <li>Enforce our agreements.</li>
            </ul>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Communications</h3>
            <p>We may use your information to send:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Security alerts;</li>
              <li>Account notifications;</li>
              <li>Service announcements;</li>
              <li>Transaction confirmations;</li>
              <li>Feature-related notifications;</li>
              <li>Support responses.</li>
            </ul>
            <p>Where required, we will obtain appropriate consent for marketing communications.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">7. LEGAL BASES FOR PROCESSING</h2>
            <p>
              Where laws such as the GDPR apply, VANTA may process personal information on one or more legal bases,
              including:
            </p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Contract</h3>
            <p>Where processing is necessary to provide the Service you requested.</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Consent</h3>
            <p>Where you have provided consent for a particular processing activity.</p>
            <p>You may withdraw consent where applicable.</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Legitimate Interests</h3>
            <p>
              Where processing is necessary for legitimate interests pursued by VANTA or another party, provided those
              interests do not override applicable rights and freedoms.
            </p>
            <p>Examples may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Security;</li>
              <li>Fraud prevention;</li>
              <li>Service improvement;</li>
              <li>Platform integrity;</li>
              <li>Certain analytics;</li>
              <li>Protecting users and VANTA.</li>
            </ul>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Legal Obligation</h3>
            <p>Where processing is necessary to comply with applicable law or legal obligations.</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Vital Interests</h3>
            <p>
              Where processing is necessary to protect someone&rsquo;s life or safety in circumstances recognized by
              applicable law.
            </p>

            <p>The legal basis available to VANTA may vary depending on the country and circumstances.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">8. PUBLIC INFORMATION AND USER CONTENT</h2>
            <p>VANTA is a social platform.</p>
            <p>
              If you choose to publish Content publicly, that Content may be visible to other users and, depending on
              the feature, people who are not registered VANTA users.
            </p>
            <p>Public information may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Username;</li>
              <li>Profile photo;</li>
              <li>Biography;</li>
              <li>Public posts;</li>
              <li>Reels;</li>
              <li>Stories;</li>
              <li>Comments;</li>
              <li>Public follower/following information;</li>
              <li>Public fundraising information;</li>
              <li>Live streams.</li>
            </ul>
            <p>
              Public Content may be copied, recorded, screenshotted, shared, or redistributed by other people.
            </p>
            <p>VANTA cannot guarantee that Content made publicly available will remain exclusively within VANTA.</p>
            <p>Please carefully consider what information you publish publicly.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">9. PRIVATE MESSAGES</h2>
            <p>VANTA may provide private and group messaging.</p>
            <p>Private does not necessarily mean that communications are inaccessible to VANTA under all circumstances.</p>
            <p>We may process information relating to messages where reasonably necessary to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Deliver messages;</li>
              <li>Maintain the Service;</li>
              <li>Detect spam;</li>
              <li>Prevent abuse;</li>
              <li>Protect users;</li>
              <li>Investigate security incidents;</li>
              <li>Respond to lawful requests;</li>
              <li>Enforce our policies.</li>
            </ul>
            <p>Where applicable, additional technical protections may apply to particular communication features.</p>
            <p>
              If VANTA introduces end-to-end encrypted communications, those features will be governed by additional
              technical and privacy information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">10. LIVE STREAMING</h2>
            <p>When you participate in a VANTA Live stream, VANTA may process:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Video;</li>
              <li>Audio;</li>
              <li>Comments;</li>
              <li>Viewer interactions;</li>
              <li>Gifts;</li>
              <li>Engagement information;</li>
              <li>Stream metadata;</li>
              <li>Technical information.</li>
            </ul>
            <p>Live streams may be publicly visible depending on the streamer&rsquo;s settings.</p>
            <p>Live Content may be processed to provide, moderate, secure, and improve the Live feature.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">11. FUNDRAISING INFORMATION</h2>
            <p>VANTA may offer fundraising features.</p>
            <p>When you create or contribute to a fundraiser, we may process information such as:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Fundraiser title;</li>
              <li>Description;</li>
              <li>Images and videos;</li>
              <li>Fundraising target;</li>
              <li>Contribution information;</li>
              <li>Transaction information;</li>
              <li>Organizer information;</li>
              <li>Verification information;</li>
              <li>Reports or disputes relating to the fundraiser.</li>
            </ul>
            <p>Some fundraising information may be publicly displayed.</p>
            <p>
              Where identity or financial verification is required, VANTA or its service providers may collect
              additional information necessary to verify the organizer or process payments.
            </p>
            <p>
              VANTA will only use such information for legitimate purposes associated with the fundraising service,
              compliance, security, fraud prevention, and applicable legal obligations.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">12. PAYMENTS, BALANCE AND VIRTUAL GIFTS</h2>
            <p>
              If you purchase virtual currency, Balance, gifts, or other paid features, VANTA may process information
              relating to those transactions.
            </p>
            <p>Payment information may be handled by third-party payment processors.</p>
            <p>VANTA may receive information such as:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Transaction ID;</li>
              <li>Amount;</li>
              <li>Currency;</li>
              <li>Payment status;</li>
              <li>Payment method type;</li>
              <li>Refund status;</li>
              <li>Chargeback information.</li>
            </ul>
            <p>
              VANTA generally does not need to store complete payment-card information when that information is handled
              directly by an authorized payment processor.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">13. COOKIES AND SIMILAR TECHNOLOGIES</h2>
            <p>
              VANTA may use cookies, local storage, SDKs, pixels, device identifiers, and similar technologies.
            </p>
            <p>These technologies may be used for:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Authentication;</li>
              <li>Security;</li>
              <li>Remembering preferences;</li>
              <li>Session management;</li>
              <li>Analytics;</li>
              <li>Performance monitoring;</li>
              <li>Personalization;</li>
              <li>Fraud prevention.</li>
            </ul>
            <p>Where required by law, VANTA will request consent before using non-essential cookies or similar technologies.</p>
            <p>You may be able to control cookies through your browser or device settings.</p>
            <p>Disabling certain technologies may affect the functionality of VANTA.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">14. RECOMMENDATIONS AND PERSONALIZATION</h2>
            <p>VANTA may personalize your experience.</p>
            <p>For example, we may use information such as:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Content you interact with;</li>
              <li>Accounts you follow;</li>
              <li>Searches;</li>
              <li>Likes;</li>
              <li>Shares;</li>
              <li>Watch behavior;</li>
              <li>General engagement;</li>
              <li>Language;</li>
              <li>Device and technical information.</li>
            </ul>
            <p>
              This may help VANTA recommend Reels, posts, accounts, Live streams, fundraisers, or other Content that
              may be relevant to you.
            </p>
            <p>
              Where applicable law provides rights regarding profiling or automated decision-making, VANTA will provide
              the protections required by that law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">15. ARTIFICIAL INTELLIGENCE AND AUTOMATED SYSTEMS</h2>
            <p>VANTA may use automated technologies, including machine-learning or artificial-intelligence systems, to help:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Detect spam;</li>
              <li>Detect fraud;</li>
              <li>Identify potentially harmful Content;</li>
              <li>Improve recommendations;</li>
              <li>Improve search;</li>
              <li>Moderate Content;</li>
              <li>Detect security threats;</li>
              <li>Improve platform performance.</li>
            </ul>
            <p>Automated systems may produce inaccurate results.</p>
            <p>
              Where required by applicable law, VANTA will provide appropriate information, human-review mechanisms,
              and rights concerning significant automated decisions.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">16. HOW WE SHARE INFORMATION</h2>
            <p>
              VANTA does not sell your personal information in the ordinary sense of selling a customer database to
              third parties.
            </p>
            <p>We may share information with:</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Service providers</h3>
            <p>Companies that help us operate VANTA, such as:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Cloud hosting providers;</li>
              <li>Content-delivery providers;</li>
              <li>Storage providers;</li>
              <li>Payment processors;</li>
              <li>Authentication providers;</li>
              <li>Analytics providers;</li>
              <li>Security providers;</li>
              <li>Customer-support providers;</li>
              <li>Communication providers;</li>
              <li>Fraud-prevention providers.</li>
            </ul>
            <p>
              These providers may process information only as necessary to provide their services to VANTA and subject
              to appropriate contractual or legal requirements.
            </p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Other users</h3>
            <p>Information you intentionally publish or share through VANTA may be visible to other users.</p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Business partners</h3>
            <p>
              Where appropriate and permitted by law, VANTA may share limited information with partners providing
              services or integrations.
            </p>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Legal authorities</h3>
            <p>We may disclose information where reasonably necessary to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Comply with law;</li>
              <li>Respond to valid legal processes;</li>
              <li>Protect users;</li>
              <li>Protect VANTA;</li>
              <li>Investigate fraud or illegal activity;</li>
              <li>Protect someone&rsquo;s safety.</li>
            </ul>

            <h3 className="text-lg font-semibold text-white/90 mb-3">Corporate transactions</h3>
            <p>Information may be transferred as part of:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>A merger;</li>
              <li>Acquisition;</li>
              <li>Financing;</li>
              <li>Restructuring;</li>
              <li>Sale of assets;</li>
              <li>Bankruptcy or similar transaction.</li>
            </ul>
            <p>Where legally required, VANTA will provide appropriate notice.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">17. INTERNATIONAL DATA TRANSFERS</h2>
            <p>VANTA is a global service.</p>
            <p>Your information may be processed or stored in countries other than the country where you live.</p>
            <p>Those countries may have privacy laws different from those in your jurisdiction.</p>
            <p>Where applicable law requires safeguards for international transfers, VANTA will use appropriate legal mechanisms and safeguards.</p>
            <p>Depending on the jurisdiction, these may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Adequacy decisions;</li>
              <li>Standard contractual clauses;</li>
              <li>Other legally recognized transfer mechanisms;</li>
              <li>Appropriate technical and organizational safeguards.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">18. DATA RETENTION</h2>
            <p>
              VANTA keeps personal information only for as long as reasonably necessary for the purposes described in
              this Privacy Policy, unless a longer period is required or permitted by law.
            </p>
            <p>Retention periods depend on factors such as:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>The type of information;</li>
              <li>Why we collected it;</li>
              <li>Whether your account remains active;</li>
              <li>Legal obligations;</li>
              <li>Security requirements;</li>
              <li>Fraud prevention;</li>
              <li>Dispute resolution;</li>
              <li>Enforcement of agreements.</li>
            </ul>
            <p>When information is no longer required, VANTA may delete, anonymize, or securely dispose of it.</p>
            <p>Some information may remain in backups for a limited period before being securely overwritten.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">19. ACCOUNT DELETION</h2>
            <p>You may request deletion of your VANTA account.</p>
            <p>
              When an account is deleted, VANTA will take reasonable steps to delete or anonymize associated personal
              information, subject to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Legal retention requirements;</li>
              <li>Fraud prevention;</li>
              <li>Security investigations;</li>
              <li>Dispute resolution;</li>
              <li>Enforcement of legal rights;</li>
              <li>Information that has been independently copied or shared by other users.</li>
            </ul>
            <p>
              Deletion of your account does not necessarily cause Content that other users have copied, screenshotted,
              downloaded, or redistributed to disappear from outside VANTA.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">20. DATA SECURITY</h2>
            <p>
              VANTA uses reasonable technical and organizational measures designed to protect personal information
              against:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Unauthorized access;</li>
              <li>Unauthorized disclosure;</li>
              <li>Loss;</li>
              <li>Destruction;</li>
              <li>Alteration;</li>
              <li>Misuse.</li>
            </ul>
            <p>Security measures may include:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Encryption in transit;</li>
              <li>Access controls;</li>
              <li>Authentication mechanisms;</li>
              <li>Monitoring;</li>
              <li>Security logging;</li>
              <li>Infrastructure protections;</li>
              <li>Backup systems;</li>
              <li>Internal security procedures.</li>
            </ul>
            <p>No internet service can guarantee absolute security.</p>
            <p>You are responsible for keeping your password and account credentials secure.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">21. DATA BREACHES</h2>
            <p>
              If VANTA experiences a personal-data breach, we will assess the incident and take appropriate action in
              accordance with applicable law.
            </p>
            <p>
              Where notification is legally required, VANTA will notify the relevant authorities and/or affected users
              within the timeframes required by applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">22. YOUR PRIVACY RIGHTS</h2>
            <p>Depending on where you live, you may have rights including:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Right to know what personal information we process;</li>
              <li>Right to access your information;</li>
              <li>Right to correct inaccurate information;</li>
              <li>Right to request deletion;</li>
              <li>Right to restrict processing;</li>
              <li>Right to object to certain processing;</li>
              <li>Right to data portability;</li>
              <li>Right to withdraw consent;</li>
              <li>Right to request information about automated decision-making;</li>
              <li>Right to object to direct marketing;</li>
              <li>Right to lodge a complaint with an applicable privacy regulator.</li>
            </ul>
            <p>These rights vary by jurisdiction and may be subject to legal exceptions.</p>
            <p>
              For example, GDPR rights include access, rectification, erasure, restriction, portability, objection, and
              certain rights concerning automated decision-making.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">23. HOW TO EXERCISE YOUR RIGHTS</h2>
            <p>You can submit a privacy request by contacting:</p>
            <p><strong className="text-white/90">Privacy Team:</strong> [INSERT PRIVACY EMAIL]</p>
            <p>Your request should include enough information for us to understand what you are asking for.</p>
            <p>We may need to verify your identity before fulfilling certain requests.</p>
            <p>This is intended to protect your information from unauthorized disclosure.</p>
            <p>
              Where GDPR applies, organizations generally must respond to valid rights requests without undue delay and,
              in principle, within one month.
            </p>
            <p>Other jurisdictions may provide different timelines.</p>
            <p>VANTA will comply with the applicable legal deadline.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-white mb-4">24. CHILDREN AND MINORS</h2>
            <p>VANTA is not intended for children below the minimum age permitted under applicable law.</p>
            <p>We do not knowingly collect personal information from children where doing so is prohibited by applicable law.</p>
            <p>
              If you believe a child has provided personal information to VANTA in violation of applicable requirements,
              contact:
            </p>
            <p><strong className="text-white/90">Child Safety / Privacy:</strong> [INSERT EMAIL]</p>
            <p>We may take appropriate steps to investigate and delete information where legally required.</p>
            <p>Certain VANTA features may have additional age restrictions.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">25. THIRD-PARTY SERVICES AND LINKS</h2>
            <p>
              VANTA may contain links to third-party websites, applications, payment services, or other services.
            </p>
            <p>VANTA does not control the privacy practices of third parties.</p>
            <p>You should review their privacy policies before providing personal information to them.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">26. YOUR RESPONSIBILITY</h2>
            <p>You should take reasonable steps to protect your personal information.</p>
            <p>Do not publicly publish information such as:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Passwords;</li>
              <li>Authentication codes;</li>
              <li>Financial credentials;</li>
              <li>Government identification numbers;</li>
              <li>Private addresses;</li>
              <li>Sensitive personal information;</li>
              <li>Other information that could put you or another person at risk.</li>
            </ul>
            <p>VANTA cannot control what another user does with information you voluntarily make public.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">27. CHANGES TO THIS PRIVACY POLICY</h2>
            <p>VANTA may update this Privacy Policy periodically.</p>
            <p>When changes are material, VANTA will provide appropriate notice where required by law.</p>
            <p>The &ldquo;Last Updated&rdquo; date at the top of this policy will indicate when it was most recently changed.</p>
            <p>Where required, VANTA may request your consent before introducing materially different processing.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">28. JURISDICTION-SPECIFIC RIGHTS</h2>
            <p>VANTA is designed for a global audience.</p>
            <p>Depending on where you live, additional privacy laws may provide additional rights or protections.</p>
            <p>These may include laws relating to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Data access;</li>
              <li>Data deletion;</li>
              <li>Data portability;</li>
              <li>Consent;</li>
              <li>Marketing;</li>
              <li>Cookies;</li>
              <li>Children&rsquo;s privacy;</li>
              <li>Sensitive personal information;</li>
              <li>Sale or sharing of personal information;</li>
              <li>International data transfers;</li>
              <li>Automated decision-making;</li>
              <li>Data breach notification.</li>
            </ul>
            <p>Nothing in this Privacy Policy is intended to remove rights that cannot legally be waived in your jurisdiction.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">29. CONTACT US</h2>
            <p>For privacy questions, requests, or concerns:</p>
            <p><strong className="text-white/90">VANTA Privacy Team</strong></p>
            <p>Email: [PRIVACY EMAIL]</p>
            <p>Website: [VANTA WEBSITE]</p>
            <p><strong className="text-white/90">Data Protection Officer:</strong> [DPO NAME / EMAIL, IF APPLICABLE]</p>
            <p><strong className="text-white/90">VANTA Legal Entity:</strong> [LEGAL COMPANY NAME]</p>
            <p><strong className="text-white/90">Registered Address:</strong> [LEGAL ADDRESS]</p>
            <p>You may also have the right to contact your local data protection or privacy regulator.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">30. ACKNOWLEDGEMENT</h2>
            <p>
              By using VANTA, you acknowledge that you have had an opportunity to review this Privacy Policy and
              understand how VANTA processes personal information.
            </p>
            <p className="font-semibold text-white/90">VANTA — Connect. Create. Share.</p>
          </section>
        </div>
      </div>
    </div>
  );
}