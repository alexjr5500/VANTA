'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Shield,
  Eye,
  EyeOff,
  Download,
  Trash2,
  Lock,
  Bell,
  Cookie,
  Sliders,
  Share2,
  Smartphone,
  History,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Users,
  UserMinus,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Search,
  MessageCircle,
  Phone,
  AtSign,
  Tag,
  Play,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  privacyApi,
  consentApi,
  exportApi,
  accountApi,
  deviceApi,
  reportApi,
  appealApi,
  policyApi,
  notificationApi,
  standardsApi,
  transparencyApi,
} from '@/lib/complianceApi';

type Tab =
  | 'overview'
  | 'privacy'
  | 'consent'
  | 'export'
  | 'account'
  | 'devices'
  | 'reporting'
  | 'appeals'
  | 'policies'
  | 'standards'
  | 'transparency'
  | 'notifications';

export default function PrivacyCenterPage() {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Data states
  const [privacySettings, setPrivacySettings] = useState<any>(null);
  const [consentPrefs, setConsentPrefs] = useState<any>(null);
  const [consentHistory, setConsentHistory] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [deactivationStatus, setDeactivationStatus] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [loginHistory, setLoginHistory] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [standards, setStandards] = useState<any[]>([]);
  const [transparency, setTransparency] = useState<any[]>([]);
  const [complianceNotifications, setComplianceNotifications] = useState<any[]>([]);

  // UI state
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const [showDeactivationModal, setShowDeactivationModal] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionDate, setDeletionDate] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  useEffect(() => {
    if (token) loadAllData();
  }, [token, activeTab]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (type === 'success') setSuccess(message);
    else setError(message);
    setTimeout(() => {
      if (type === 'success') setSuccess(null);
      else setError(null);
    }, 4000);
  };

  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      const loaders: Promise<any>[] = [];

      switch (activeTab) {
        case 'overview':
          loaders.push(
            consentApi.getPreferences().then(setConsentPrefs).catch(() => {}),
            deactivationStatus?.status === 'ACTIVE' ? accountApi.getStatus().then(setDeactivationStatus).catch(() => {}) : Promise.resolve(),
          );
          break;
        case 'privacy':
          loaders.push(privacyApi.getSettings().then(setPrivacySettings).catch(() => {}));
          break;
        case 'consent':
          loaders.push(
            consentApi.getPreferences().then(setConsentPrefs).catch(() => {}),
            consentApi.getHistory().then(setConsentHistory).catch(() => {}),
          );
          break;
        case 'export':
          loaders.push(exportApi.getExports().then(setExports).catch(() => {}));
          break;
        case 'account':
          loaders.push(accountApi.getStatus().then(setDeactivationStatus).catch(() => {}));
          break;
        case 'devices':
          loaders.push(
            deviceApi.getDevices().then(setDevices).catch(() => {}),
            deviceApi.getLoginHistory().then(setLoginHistory).catch(() => {}),
          );
          break;
        case 'policies':
          loaders.push(policyApi.getAll().then(setPolicies).catch(() => {}));
          break;
        case 'standards':
          loaders.push(standardsApi.getStandards().then(setStandards).catch(() => {}));
          break;
        case 'transparency':
          loaders.push(transparencyApi.getMetrics().then(setTransparency).catch(() => {}));
          break;
        case 'notifications':
          loaders.push(notificationApi.getAll().then(setComplianceNotifications).catch(() => {}));
          break;
        default:
          break;
      }

      await Promise.all(loaders);
    } catch (err: any) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: any; description: string }[] = [
    { id: 'overview', label: 'Overview', icon: Shield, description: 'Your privacy at a glance' },
    { id: 'privacy', label: 'Privacy Controls', icon: Eye, description: 'Manage who sees what' },
    { id: 'consent', label: 'Consent', icon: CheckCircle, description: 'Manage your preferences' },
    { id: 'export', label: 'Data Export', icon: Download, description: 'Download your data' },
    { id: 'account', label: 'Account', icon: UserMinus, description: 'Deactivate or delete' },
    { id: 'devices', label: 'Devices', icon: Smartphone, description: 'Connected devices & logins' },
    { id: 'reporting', label: 'Reporting', icon: AlertTriangle, description: 'Report content' },
    { id: 'appeals', label: 'Appeals', icon: FileText, description: 'Appeal decisions' },
    { id: 'policies', label: 'Policies', icon: FileText, description: 'User agreements' },
    { id: 'standards', label: 'Standards', icon: Users, description: 'Community guidelines' },
    { id: 'transparency', label: 'Transparency', icon: Globe, description: 'Platform transparency' },
    { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Compliance alerts' },
  ];

  return (
    <div className="min-h-screen pb-24 ">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="glass rounded-[32px] p-6 shadow-card">
          <div className="flex items-center gap-3 mb-2">
            <Shield size={22} className="text-[#c8c8cc]" />
            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400">Privacy Center</p>
          </div>
          <h1 className="text-3xl  font-bold text-white mb-2">
            Your Privacy, Your Control
          </h1>
          <p className="text-sm text-gray-400 max-w-2xl">
            Manage your privacy settings, data, and account preferences. VANTA is committed to
            protecting your personal information and giving you control over your experience.
          </p>
        </div>

        {/* Error / Success toasts */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-400 text-sm p-4 rounded-2xl">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm p-4 rounded-2xl">
            {success}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex min-w-0 max-w-full overflow-x-auto gap-2 pb-2 scrollbar-hide">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'bg-[#c8c8cc]/20 text-[#c8c8cc] border border-[#151517]0/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="glass rounded-[28px] p-6 shadow-card">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#a8a8ac] border-t-transparent" />
            </div>
          ) : (
            renderTabContent()
          )}
        </div>
      </div>

      {/* Deletion Modal */}
      {showDeletionModal && renderDeletionModal()}
      {showDeactivationModal && renderDeactivationModal()}
    </div>
  );

  function renderTabContent() {
    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'privacy': return renderPrivacyControls();
      case 'consent': return renderConsentManagement();
      case 'export': return renderDataExport();
      case 'account': return renderAccountManagement();
      case 'devices': return renderDevices();
      case 'reporting': return renderReporting();
      case 'appeals': return renderAppeals();
      case 'policies': return renderPolicies();
      case 'standards': return renderStandards();
      case 'transparency': return renderTransparency();
      case 'notifications': return renderComplianceNotifications();
      default: return null;
    }
  }

  // ==========================================================================
  // OVERVIEW
  // ==========================================================================
  function renderOverview() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Privacy Overview</p>
        <div className="grid grid-cols-1   gap-4">
          <OverviewCard
            icon={Eye}
            title="Profile Visibility"
            value={privacySettings?.accountType || 'Public'}
            color="text-[#c8c8cc]"
          />
          <OverviewCard
            icon={CheckCircle}
            title="Consent Status"
            value={consentPrefs ? 'Preferences Set' : 'Not Configured'}
            color="text-green-400"
          />
          <OverviewCard
            icon={Download}
            title="Data Exports"
            value={`${exports.length} export(s)`}
            color="text-[#c8c8cc]"
          />
          <OverviewCard
            icon={Smartphone}
            title="Connected Devices"
            value={`${devices.length} device(s)`}
            color="text-[#c8c8cc]"
          />
          <OverviewCard
            icon={Shield}
            title="Account Status"
            value={deactivationStatus?.status || 'Active'}
            color="text-emerald-400"
          />
          <OverviewCard
            icon={Bell}
            title="Compliance Alerts"
            value={`${complianceNotifications.filter((n: any) => !n.read).length} unread`}
            color="text-amber-400"
          />
        </div>

        <div className="mt-8 p-4 bg-gradient-to-r from-[#151517]0/10 to-[#151517]0/10 rounded-2xl border border-[#151517]0/20">
          <p className="text-sm text-gray-300">
            <strong className="text-white">Your privacy matters.</strong> You have the right to access,
            modify, and delete your personal data at any time. All data is encrypted and processed in
            accordance with applicable privacy laws.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1  gap-4">
          <button
            onClick={() => setActiveTab('export')}
            className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition border border-white/10"
          >
            <Download size={20} className="text-[#c8c8cc]" />
            <div className="text-left">
              <p className="text-sm font-medium text-white">Download Your Data</p>
              <p className="text-xs text-gray-500">Export your complete account</p>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('account')}
            className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition border border-white/10"
          >
            <Trash2 size={20} className="text-red-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-white">Delete Account</p>
              <p className="text-xs text-gray-500">Request account deletion</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // PRIVACY CONTROLS
  // ==========================================================================
  function renderPrivacyControls() {
    if (!privacySettings) return <p className="text-gray-400">Loading privacy settings...</p>;

    const updatePrivacy = async (key: string, value: any) => {
      try {
        const updated = await privacyApi.updateSettings({ [key]: value });
        setPrivacySettings(updated);
        showToast('Privacy setting updated');
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    };

    const sections = [
      {
        title: 'Account Type',
        icon: Shield,
        items: [
          {
            label: 'Account Visibility',
            key: 'accountType',
            type: 'select',
            options: [
              { value: 'PUBLIC', label: 'Public Account - Everyone can see your content' },
              { value: 'PRIVATE', label: 'Private Account - Only followers can see your content' },
              { value: 'CREATOR', label: 'Creator Account - Public with creator features' },
            ],
          },
        ],
      },
      {
        title: 'Visibility Controls',
        icon: Eye,
        items: [
          { label: 'Online Status', key: 'onlineStatus', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Last Seen', key: 'lastSeen', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Read Receipts', key: 'readReceipts', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Story Visibility', key: 'storyVisibility', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Live Stream Visibility', key: 'liveStreamVisibility', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
        ],
      },
      {
        title: 'Interaction Permissions',
        icon: MessageCircle,
        items: [
          { label: 'Community Invites', key: 'communityInvites', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Group Invites', key: 'groupInvites', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Message Permissions', key: 'messagePermissions', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Call Permissions', key: 'callPermissions', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Tag Permissions', key: 'tagPermissions', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
          { label: 'Mention Permissions', key: 'mentionPermissions', type: 'select', options: [
            { value: 'everyone', label: 'Everyone' },
            { value: 'followers', label: 'Followers Only' },
            { value: 'nobody', label: 'Nobody' },
          ]},
        ],
      },
      {
        title: 'Discoverability',
        icon: Search,
        items: [
          { label: 'Profile Search Visibility', key: 'profileSearchVisibility', type: 'toggle' },
          { label: 'Search Engine Visibility', key: 'searchVisibility', type: 'toggle' },
          { label: 'Discoverability', key: 'discoverability', type: 'toggle' },
        ],
      },
      {
        title: 'AI & Personalization',
        icon: Sliders,
        items: [
          { label: 'AI Personalization', key: 'aiPersonalization', type: 'toggle', desc: 'Allow AI to personalize your experience' },
          { label: 'Ad Personalization', key: 'adPersonalization', type: 'toggle', desc: 'Allow personalized advertisements' },
        ],
      },
      {
        title: 'Cookie Preferences',
        icon: Cookie,
        items: [
          { label: 'Analytics Cookies', key: 'cookieAnalytics', type: 'toggle', desc: 'Help us improve our platform' },
          { label: 'Marketing Cookies', key: 'cookieMarketing', type: 'toggle', desc: 'Personalized ads and offers' },
          { label: 'Functional Cookies', key: 'cookieFunctional', type: 'toggle', desc: 'Essential for platform functionality' },
        ],
      },
    ];

    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Privacy & Security Controls</p>
        <p className="text-sm text-gray-400">
          Configure who can see your content, interact with you, and find you on VANTA.
        </p>

        {sections.map((section) => (
          <div key={section.title} className="border border-white/10 rounded-2xl overflow-hidden">
            <button
              onClick={() => setExpandedSection(expandedSection === section.title ? null : section.title)}
              className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition"
            >
              <div className="flex items-center gap-2">
                <section.icon size={16} className="text-[#c8c8cc]" />
                <span className="text-sm font-medium text-white">{section.title}</span>
              </div>
              {expandedSection === section.title ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>

            {expandedSection === section.title && (
              <div className="p-4 space-y-4">
                {section.items.map((item: any) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-300">{item.label}</p>
                      {item.desc && <p className="text-xs text-gray-500">{item.desc}</p>}
                    </div>
                    {item.type === 'select' ? (
                      <select
                        value={(privacySettings as any)[item.key] || 'everyone'}
                        onChange={(e) => updatePrivacy(item.key, e.target.value)}
                        className="w-48 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#a8a8ac]/50"
                      >
                        {item.options.map((opt: any) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : (
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean((privacySettings as any)[item.key])}
                          onChange={(e) => updatePrivacy(item.key, e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#c8c8cc]" />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ==========================================================================
  // CONSENT MANAGEMENT
  // ==========================================================================
  function renderConsentManagement() {
    const consentCategories = [
      { key: 'analytics', label: 'Analytics', desc: 'Help us improve VANTA with usage data' },
      { key: 'personalization', label: 'Personalization', desc: 'Personalized content recommendations' },
      { key: 'marketing', label: 'Marketing', desc: 'Receive promotional offers and updates' },
      { key: 'aiFeatures', label: 'AI Features', desc: 'AI-powered features and recommendations' },
      { key: 'notifications', label: 'Notifications', desc: 'Push and email notifications' },
      { key: 'cookies', label: 'Cookies', desc: 'Cookie-based functionality and tracking' },
    ];

    const updateConsent = async (key: string, value: string) => {
      try {
        const updated = await consentApi.updatePreferences({ [key]: value });
        setConsentPrefs(updated);
        showToast(`${key} preference updated`);
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    };

    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Consent Preferences</p>
        <p className="text-sm text-gray-400">
          Manage your consent preferences. You can change these at any time.
        </p>

        <div className="space-y-3">
          {consentCategories.map((cat) => (
            <div key={cat.key} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10">
              <div>
                <p className="text-sm font-medium text-white">{cat.label}</p>
                <p className="text-xs text-gray-500">{cat.desc}</p>
              </div>
              <div className="flex gap-2">
                {['granted', 'denied', 'not_set'].map((opt) => {
                  const isActive = (consentPrefs as any)?.[cat.key] === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => updateConsent(cat.key, opt)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition ${
                        isActive
                          ? opt === 'granted' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : opt === 'denied' ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                            : 'bg-gray-500/20 text-gray-300 border border-gray-500/30'
                          : 'bg-white/5 text-gray-500 hover:bg-white/10'
                      }`}
                    >
                      {opt === 'granted' ? 'Allow' : opt === 'denied' ? 'Deny' : 'Not Set'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Consent History */}
        {consentHistory.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium text-white mb-3">Consent History</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {consentHistory.map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between p-3 rounded-xl bg-black/30 text-xs">
                  <div>
                    <span className="text-gray-300">{entry.type}</span>
                    <span className={`ml-2 ${
                      entry.action === 'granted' ? 'text-emerald-400' : entry.action === 'denied' ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {entry.action}
                    </span>
                  </div>
                  <span className="text-gray-500">{new Date(entry.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================================================
  // DATA EXPORT
  // ==========================================================================
  function renderDataExport() {
    const handleRequestExport = async () => {
      try {
        const result = await exportApi.requestExport();
        showToast('Data export requested. You will be notified when ready.');
        const updatedExports = await exportApi.getExports();
        setExports(updatedExports);
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    };

    const handleDownloadExport = async (id: string) => {
      try {
        await exportApi.download(id);
      } catch (err: any) {
        showToast(err.message || 'Unable to download this export.', 'error');
      }
    };

    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Download Your Data</p>
        <p className="text-sm text-gray-400">
          Request a complete export of all your VANTA data including profile, messages, photos, videos, and more.
        </p>

        <div className="p-6 rounded-2xl bg-gradient-to-r from-[#151517]0/10 to-[#151517]0/10 border border-[#151517]0/20">
          <div className="flex items-center gap-3 mb-4">
            <Download size={24} className="text-[#c8c8cc]" />
            <div>
              <p className="text-sm font-medium text-white">Request Data Export</p>
              <p className="text-xs text-gray-500">Generate a complete archive of your account</p>
            </div>
          </div>
          <Button variant="primary" size="md" onClick={handleRequestExport}>
            Request Export
          </Button>
        </div>

        {exports.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-medium text-white mb-3">Export History</p>
            <div className="space-y-2">
              {exports.map((exp: any) => (
                <div key={exp.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2">
                    <Download size={14} className="text-gray-400" />
                    <span className={`text-xs ${
                      exp.status === 'COMPLETED' ? 'text-emerald-400' :
                      exp.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {exp.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(exp.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {exp.status === 'COMPLETED' && (
                    <button
                      type="button"
                      onClick={() => handleDownloadExport(exp.id)}
                      className="text-xs text-[#c8c8cc] hover:text-[#c8c8cc] underline"
                    >
                      Download
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================================================
  // ACCOUNT MANAGEMENT
  // ==========================================================================
  function renderAccountManagement() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Account Management</p>
        <p className="text-sm text-gray-400">
          Deactivate your account temporarily or permanently delete it. Deactivated accounts can be recovered within 30 days.
        </p>

        {/* Current Status */}
        {deactivationStatus && deactivationStatus.status !== 'ACTIVE' && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-400" />
              <p className="text-sm font-medium text-amber-300">
                Account Status: {deactivationStatus.status}
              </p>
            </div>
            <p className="text-xs text-gray-400">
              {deactivationStatus.status === 'DEACTIVATED'
                ? `Your account is deactivated. Recovery available until ${new Date(deactivationStatus.recoveryPeriodEnd).toLocaleDateString()}.`
                : `Your account is scheduled for deletion on ${new Date(deactivationStatus.scheduledFor).toLocaleDateString()}.`}
            </p>
            {deactivationStatus.status === 'DEACTIVATED' && (
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={async () => {
                  try {
                    await accountApi.cancelDeletion();
                    const status = await accountApi.getStatus();
                    setDeactivationStatus(status);
                    showToast('Account reactivated');
                  } catch (err: any) {
                    showToast(err.message, 'error');
                  }
                }}
              >
                Reactivate Account
              </Button>
            )}
            {deactivationStatus.status === 'SCHEDULED_FOR_DELETION' && (
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={async () => {
                  try {
                    const status = await accountApi.cancelDeletion();
                    setDeactivationStatus(status);
                    showToast('Deletion cancelled');
                  } catch (err: any) {
                    showToast(err.message, 'error');
                  }
                }}
              >
                Cancel Deletion
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1  gap-4">
          {/* Deactivate */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-2 mb-3">
              <EyeOff size={18} className="text-amber-400" />
              <p className="text-sm font-medium text-white">Temporary Deactivation</p>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Temporarily disable your account. Your data will be preserved and you can reactivate within 30 days.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDeactivationModal(true)}
            >
              Deactivate Account
            </Button>
          </div>

          {/* Delete */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={18} className="text-red-400" />
              <p className="text-sm font-medium text-white">Permanent Deletion</p>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowDeletionModal(true)}
            >
              Delete Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderDeactivationModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-gray-900 rounded-3xl p-6 max-w-md w-full mx-4 border border-white/10 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-2">Deactivate Account</h3>
          <p className="text-sm text-gray-400 mb-4">
            Your profile, content, and data will be hidden. You can reactivate by logging in within 30 days.
          </p>
          <select
            value={deletionReason}
            onChange={(e) => setDeletionReason(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-400/50 mb-4"
          >
            <option value="">Select a reason...</option>
            <option value="privacy_concerns">Privacy concerns</option>
            <option value="security">Security concerns</option>
            <option value="platform_migration">Moving to another platform</option>
            <option value="other">Other</option>
          </select>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              size="md"
              onClick={() => { setShowDeactivationModal(false); setDeletionReason(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={async () => {
                try {
                  const result = await accountApi.deactivate(deletionReason);
                  setDeactivationStatus(result);
                  setShowDeactivationModal(false);
                  showToast('Account deactivated');
                } catch (err: any) {
                  showToast(err.message, 'error');
                }
              }}
            >
              Confirm Deactivation
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderDeletionModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-gray-900 rounded-3xl p-6 max-w-md w-full mx-4 border border-red-500/20 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-2">Delete Account</h3>
          <p className="text-sm text-gray-400 mb-4">
            This will permanently delete your account. You can schedule deletion for a future date.
          </p>
          <div className="space-y-4 mb-4">
            <select
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-red-400/50"
            >
              <option value="">Select a reason...</option>
              <option value="privacy_concerns">Privacy concerns</option>
              <option value="security">Security concerns</option>
              <option value="platform_migration">Moving to another platform</option>
              <option value="other">Other</option>
            </select>
            <input
              type="date"
              value={deletionDate}
              onChange={(e) => setDeletionDate(e.target.value)}
              min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-red-400/50"
              placeholder="Schedule deletion date"
            />
          </div>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              size="md"
              onClick={() => { setShowDeletionModal(false); setDeletionReason(''); setDeletionDate(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={async () => {
                try {
                  const result = await accountApi.scheduleDeletion(deletionReason, deletionDate || undefined);
                  setDeactivationStatus(result);
                  setShowDeletionModal(false);
                  showToast('Deletion scheduled');
                } catch (err: any) {
                  showToast(err.message, 'error');
                }
              }}
            >
              Schedule Deletion
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // DEVICES & LOGIN HISTORY
  // ==========================================================================
  function renderDevices() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Connected Devices</p>
        <div className="space-y-3">
          {devices.map((device: any) => (
            <div key={device.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center gap-3">
                <Smartphone size={16} className="text-[#c8c8cc]" />
                <div>
                  <p className="text-sm text-white">{device.deviceName}</p>
                  <p className="text-xs text-gray-500">{device.deviceType} • {device.ipAddress}</p>
                </div>
              </div>
              <span className="text-xs text-gray-500">
                Last active: {new Date(device.lastActiveAt).toLocaleDateString()}
              </span>
            </div>
          ))}
          {devices.length === 0 && (
            <p className="text-sm text-gray-500">No connected devices found.</p>
          )}
        </div>

        <p className="text-lg font-semibold text-white mt-8">Login History</p>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {loginHistory.map((entry: any) => (
            <div key={entry.id} className="flex items-center justify-between p-3 rounded-xl bg-black/30 text-xs">
              <div className="flex items-center gap-2">
                <History size={14} className="text-gray-400" />
                <span className="text-gray-300">{new Date(entry.createdAt).toLocaleString()}</span>
                <span className={entry.isSuccessful ? 'text-emerald-400' : 'text-red-400'}>
                  {entry.isSuccessful ? 'Success' : 'Failed'}
                </span>
              </div>
              <span className="text-gray-500">{entry.ipAddress} • {entry.loginMethod}</span>
            </div>
          ))}
          {loginHistory.length === 0 && (
            <p className="text-sm text-gray-500">No login history found.</p>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // REPORTING
  // ==========================================================================
  function renderReporting() {
    const [targetType, setTargetType] = useState('USER');
    const [targetId, setTargetId] = useState('');
    const [category, setCategory] = useState('spam');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const reportCategories = [
      { value: 'spam', label: 'Spam' },
      { value: 'harassment', label: 'Harassment' },
      { value: 'impersonation', label: 'Impersonation' },
      { value: 'scams', label: 'Scams or fraud' },
      { value: 'copyright', label: 'Copyright violation' },
      { value: 'illegal_content', label: 'Illegal content' },
      { value: 'hate_speech', label: 'Hate speech' },
      { value: 'violence', label: 'Violent content' },
      { value: 'nudity', label: 'Nudity or sexual content' },
      { value: 'self_harm', label: 'Self-harm or suicide' },
      { value: 'misinformation', label: 'Misinformation' },
      { value: 'other', label: 'Other' },
    ];

    const handleSubmitReport = async () => {
      if (!targetId) {
        showToast('Please enter a target ID', 'error');
        return;
      }
      setSubmitting(true);
      try {
        await reportApi.create({
          targetType,
          targetId,
          category,
          description: description || undefined,
        });
        showToast('Report submitted successfully');
        setTargetId('');
        setDescription('');
      } catch (err: any) {
        showToast(err.message, 'error');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Report Content</p>
        <p className="text-sm text-gray-400">
          Report content that violates our community guidelines. Your report will be reviewed by our moderation team.
        </p>

        <div className="space-y-4">
          <label className="space-y-2 text-sm text-gray-300">
            <span>Content Type</span>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            >
              <option value="USER">User</option>
              <option value="POST">Post</option>
              <option value="STORY">Story</option>
              <option value="SHORT">Short</option>
              <option value="COMMUNITY">Community</option>
              <option value="CHANNEL">Channel</option>
              <option value="MESSAGE">Message</option>
              <option value="LIVE_STREAM">Live Stream</option>
              <option value="COMMENT">Comment</option>
              <option value="GIFT">Gift</option>
              <option value="ADVERTISEMENT">Advertisement</option>
            </select>
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Content ID or Username</span>
            <input
              type="text"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="Enter the ID or username of the content/user"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            />
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            >
              {reportCategories.map((cat) => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Provide additional context..."
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50 resize-none"
            />
          </label>

          <Button variant="primary" size="md" onClick={handleSubmitReport} loading={submitting}>
            Submit Report
          </Button>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // APPEALS
  // ==========================================================================
  function renderAppeals() {
    const [appealType, setAppealType] = useState('SUSPENSION');
    const [appealReason, setAppealReason] = useState('');
    const [appealExplanation, setAppealExplanation] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [myAppeals, setMyAppeals] = useState<any[]>([]);

    useEffect(() => {
      appealApi.getMyAppeals().then(setMyAppeals).catch(() => {});
    }, []);

    const handleSubmitAppeal = async () => {
      if (!appealReason) {
        showToast('Please provide a reason for your appeal', 'error');
        return;
      }
      setSubmitting(true);
      try {
        await appealApi.create({
          appealType,
          reason: appealReason,
          explanation: appealExplanation || undefined,
        });
        showToast('Appeal submitted successfully');
        setAppealReason('');
        setAppealExplanation('');
        const updated = await appealApi.getMyAppeals();
        setMyAppeals(updated);
      } catch (err: any) {
        showToast(err.message, 'error');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Appeals</p>
        <p className="text-sm text-gray-400">
          If you believe a decision was made in error, you can submit an appeal for review.
        </p>

        <div className="space-y-4 p-4 rounded-2xl bg-white/5 border border-white/10">
          <label className="space-y-2 text-sm text-gray-300">
            <span>Appeal Type</span>
            <select
              value={appealType}
              onChange={(e) => setAppealType(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            >
              <option value="SUSPENSION">Account Suspension</option>
              <option value="BAN">Account Ban</option>
              <option value="CONTENT_REMOVAL">Content Removal</option>
              <option value="MONETIZATION_DECISION">Monetization Decision</option>
              <option value="REPORT_DISMISSAL">Report Dismissal</option>
            </select>
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Reason</span>
            <input
              type="text"
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="Brief reason for your appeal"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            />
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Explanation (optional)</span>
            <textarea
              value={appealExplanation}
              onChange={(e) => setAppealExplanation(e.target.value)}
              rows={3}
              placeholder="Provide details to support your appeal..."
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50 resize-none"
            />
          </label>

          <Button variant="primary" size="md" onClick={handleSubmitAppeal} loading={submitting}>
            Submit Appeal
          </Button>
        </div>

        {myAppeals.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-medium text-white mb-3">My Appeals</p>
            <div className="space-y-2">
              {myAppeals.map((appeal: any) => (
                <div key={appeal.id} className="flex items-center justify-between p-3 rounded-xl bg-black/30">
                  <div>
                    <span className="text-xs text-gray-300">{appeal.appealType}</span>
                    <span className={`ml-2 text-xs ${
                      appeal.status === 'APPROVED' ? 'text-emerald-400' :
                      appeal.status === 'REJECTED' ? 'text-red-400' :
                      appeal.status === 'ESCALATED' ? 'text-amber-400' : 'text-amber-400'
                    }`}>
                      {appeal.status}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(appeal.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================================================
  // POLICIES
  // ==========================================================================
  function renderPolicies() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">User Agreements & Policies</p>
        <p className="text-sm text-gray-400">
          Review and accept platform policies. Your acceptance is tracked for compliance purposes.
        </p>

        <div className="space-y-3">
          {policies.map((policy: any) => (
            <div key={policy.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-white">{policy.title}</p>
                <span className="text-xs text-gray-500">v{policy.version}</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Effective: {new Date(policy.effectiveAt).toLocaleDateString()}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => policyApi.getByType(policy.policyType).then((p) => {
                    window.open(`/policies/${policy.policyType}`, '_blank');
                  })}
                >
                  View Policy
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    try {
                      await policyApi.accept(policy.policyType, policy.version);
                      showToast(`${policy.title} accepted`);
                    } catch (err: any) {
                      showToast(err.message, 'error');
                    }
                  }}
                >
                  Accept
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // COMMUNITY STANDARDS
  // ==========================================================================
  function renderStandards() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Community Standards</p>
        <p className="text-sm text-gray-400">
          VANTA is committed to maintaining a safe and respectful environment for all users.
        </p>

        <div className="space-y-3">
          {standards.map((standard: any) => (
            <div key={standard.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-[#c8c8cc]" />
                  <p className="text-sm font-medium text-white">{standard.title}</p>
                </div>
                <span className="text-xs text-gray-500">v{standard.version}</span>
              </div>
              <p className="text-xs text-gray-400 line-clamp-3">{standard.content?.substring(0, 200)}...</p>
              <button
                onClick={() => setExpandedSection(expandedSection === standard.id ? null : standard.id)}
                className="text-xs text-[#c8c8cc] hover:text-[#c8c8cc] mt-2"
              >
                {expandedSection === standard.id ? 'Show less' : 'Read more'}
              </button>
              {expandedSection === standard.id && (
                <div className="mt-3 p-3 rounded-xl bg-black/30 text-xs text-gray-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {standard.content}
                </div>
              )}
            </div>
          ))}
          {standards.length === 0 && (
            <p className="text-sm text-gray-500">No community standards published yet.</p>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // TRANSPARENCY
  // ==========================================================================
  function renderTransparency() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Transparency Center</p>
        <p className="text-sm text-gray-400">
          Our commitment to transparency. View platform-wide enforcement and moderation statistics.
        </p>

        <div className="grid grid-cols-1   gap-4">
          {(['ENFORCEMENT_ACTIONS', 'REPORT_VOLUME', 'APPEAL_OUTCOMES'] as const).map((type) => {
            const metric = transparency.find((m: any) => m.metricType === type);
            return (
              <div key={type} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                  {type.replace(/_/g, ' ')}
                </p>
                <p className="text-2xl font-bold text-white">{metric?.totalCount || 0}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {metric ? new Date(metric.periodStart).toLocaleDateString() : 'No data'} - {metric ? new Date(metric.periodEnd).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1  gap-4">
          {(['CONTENT_REMOVALS', 'DATA_REQUESTS'] as const).map((type) => {
            const metric = transparency.find((m: any) => m.metricType === type);
            return (
              <div key={type} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                  {type.replace(/_/g, ' ')}
                </p>
                <p className="text-2xl font-bold text-white">{metric?.totalCount || 0}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {metric ? new Date(metric.periodStart).toLocaleDateString() : 'No data'} - {metric ? new Date(metric.periodEnd).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // COMPLIANCE NOTIFICATIONS
  // ==========================================================================
  function renderComplianceNotifications() {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-white">Compliance Notifications</p>
            <p className="text-sm text-gray-400">
              Important updates about your privacy, security, and account.
            </p>
          </div>
          {complianceNotifications.some((n: any) => !n.read) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await notificationApi.markAllRead();
                const updated = await notificationApi.getAll();
                setComplianceNotifications(updated);
                showToast('All notifications marked as read');
              }}
            >
              Mark All Read
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {complianceNotifications.map((notif: any) => (
            <div
              key={notif.id}
              className={`p-4 rounded-2xl border transition ${
                notif.read
                  ? 'bg-white/5 border-white/10'
                  : 'bg-[#c8c8cc]/10 border-[#151517]0/30'
              }`}
              onClick={async () => {
                if (!notif.read) {
                  await notificationApi.markRead(notif.id);
                  const updated = await notificationApi.getAll();
                  setComplianceNotifications(updated);
                }
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {!notif.read && <div className="w-2 h-2 rounded-full bg-[#a8a8ac]" />}
                  <p className={`text-sm ${notif.read ? 'text-gray-300' : 'text-white font-medium'}`}>
                    {notif.title}
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(notif.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{notif.message}</p>
              {notif.actionUrl && (
                <a href={notif.actionUrl} className="text-xs text-[#c8c8cc] hover:text-[#c8c8cc] mt-2 inline-block">
                  View details →
                </a>
              )}
            </div>
          ))}
          {complianceNotifications.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No compliance notifications.</p>
          )}
        </div>
      </div>
    );
  }
}

// ==========================================================================
// HELPER COMPONENTS
// ==========================================================================

function OverviewCard({ icon: Icon, title, value, color }: { icon: any; title: string; value: string; color: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <p className="text-xs text-gray-500">{title}</p>
      </div>
      <p className="text-sm font-medium text-white">{value}</p>
    </div>
  );
}