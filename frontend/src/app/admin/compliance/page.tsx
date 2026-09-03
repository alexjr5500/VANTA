'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Shield,
  AlertTriangle,
  FileText,
  Users,
  Download,
  Trash2,
  CheckCircle,
  XCircle,
  BarChart3,
  Search,
  Filter,
  Clock,
  Eye,
  MessageSquare,
  UserX,
  Lock,
  Globe,
  Activity,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminComplianceApi } from '@/lib/complianceApi';

type AdminTab = 'overview' | 'reports' | 'appeals' | 'copyright' | 'child-safety' | 'audit-logs' | 'transparency' | 'policies';

export default function AdminCompliancePage() {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Data states
  const [dashboard, setDashboard] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [appeals, setAppeals] = useState<any[]>([]);
  const [copyrightClaims, setCopyrightClaims] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [transparency, setTransparency] = useState<any[]>([]);

  // Filters
  const [reportFilter, setReportFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    if (type === 'success') setSuccess(msg);
    else setError(msg);
    setTimeout(() => { setSuccess(null); setError(null); }, 4000);
  };

  useEffect(() => {
    if (token) loadTabData();
  }, [token, activeTab]);

  const loadTabData = async () => {
    setLoading(true);
    setError(null);
    try {
      switch (activeTab) {
        case 'overview':
          setDashboard(await adminComplianceApi.getDashboard());
          break;
        case 'reports':
          setReports(await adminComplianceApi.getReports(100, 0));
          break;
        case 'appeals':
          setAppeals(await adminComplianceApi.getAppeals(100, 0));
          break;
        case 'copyright':
          setCopyrightClaims(await adminComplianceApi.getCopyrightClaims(100, 0));
          break;
        case 'audit-logs':
          setAuditLogs(await adminComplianceApi.getAuditLogs({ limit: 100 }));
          break;
        case 'transparency':
          setTransparency(await adminComplianceApi.getDashboard());
          break;
        default:
          break;
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: AdminTab; label: string; icon: any; description: string }[] = [
    { id: 'overview', label: 'Dashboard', icon: BarChart3, description: 'Compliance overview' },
    { id: 'reports', label: 'Reports', icon: AlertTriangle, description: 'User reports' },
    { id: 'appeals', label: 'Appeals', icon: FileText, description: 'User appeals' },
    { id: 'copyright', label: 'Copyright', icon: FileText, description: 'Copyright claims' },
    { id: 'child-safety', label: 'Child Safety', icon: Shield, description: 'Safety flags' },
    { id: 'audit-logs', label: 'Audit Logs', icon: Activity, description: 'Compliance audit trail' },
    { id: 'transparency', label: 'Transparency', icon: Globe, description: 'Transparency reports' },
    { id: 'policies', label: 'Policies', icon: FileText, description: 'Manage policies' },
  ];

  return (
    <div className="min-h-screen pb-24 ">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="glass rounded-[32px] p-6 shadow-card">
          <div className="flex items-center gap-3 mb-2">
            <Shield size={22} className="text-[#c8c8cc]" />
            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-400">Admin</p>
          </div>
          <h1 className="text-3xl  font-bold text-white mb-2">
            Compliance Dashboard
          </h1>
          <p className="text-sm text-gray-400 max-w-2xl">
            Manage privacy requests, moderation, appeals, copyright claims, and compliance operations.
          </p>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/40 text-red-400 text-sm p-4 rounded-2xl">{error}</div>}
        {success && <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm p-4 rounded-2xl">{success}</div>}

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
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

        {/* Content */}
        <div className="glass rounded-[28px] p-6 shadow-card">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#a8a8ac] border-t-transparent" />
            </div>
          ) : (
            renderContent()
          )}
        </div>
      </div>
    </div>
  );

  function renderContent() {
    switch (activeTab) {
      case 'overview': return renderDashboard();
      case 'reports': return renderReports();
      case 'appeals': return renderAppeals();
      case 'copyright': return renderCopyright();
      case 'child-safety': return renderChildSafety();
      case 'audit-logs': return renderAuditLogs();
      case 'transparency': return renderTransparency();
      case 'policies': return renderPolicies();
      default: return null;
    }
  }

  // ==========================================================================
  // DASHBOARD
  // ==========================================================================
  function renderDashboard() {
    const stats = dashboard || {};

    const cards = [
      { label: 'Pending Reports', value: stats.pendingReports || 0, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
      { label: 'Pending Appeals', value: stats.pendingAppeals || 0, icon: FileText, color: 'text-amber-400', bg: 'bg-amber-500/10' },
      { label: 'Pending Exports', value: stats.pendingExports || 0, icon: Download, color: 'text-[#c8c8cc]', bg: 'bg-[#c8c8cc]/10' },
      { label: 'Copyright Claims', value: stats.pendingCopyrightClaims || 0, icon: FileText, color: 'text-[#c8c8cc]', bg: 'bg-[#c8c8cc]/10' },
      { label: 'Active Deactivations', value: stats.activeDeactivations || 0, icon: UserX, color: 'text-orange-400', bg: 'bg-orange-500/10' },
      { label: 'Child Safety Flags', value: stats.pendingChildSafetyFlags || 0, icon: Shield, color: 'text-[#d6a83f]', bg: 'bg-[#151517]0/10' },
      { label: 'Consent Records', value: stats.totalConsentRecords || 0, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
      { label: "Today's Reports", value: stats.reportsToday || 0, icon: BarChart3, color: 'text-[#c8c8cc]', bg: 'bg-[#c8c8cc]/10' },
    ];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Compliance Overview</p>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadTabData}>
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1   gap-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className={`${card.bg} rounded-2xl p-4 border border-white/10`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={card.color} />
                  <p className="text-xs text-gray-500">{card.label}</p>
                </div>
                <p className="text-2xl font-bold text-white">{card.value}</p>
              </div>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="mt-8">
          <p className="text-sm font-medium text-white mb-3">Quick Actions</p>
          <div className="grid grid-cols-2  gap-3">
            <button
              onClick={() => setActiveTab('reports')}
              className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left"
            >
              <AlertTriangle size={18} className="text-red-400 mb-1" />
              <p className="text-xs text-gray-300">Review Reports</p>
            </button>
            <button
              onClick={() => setActiveTab('appeals')}
              className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left"
            >
              <FileText size={18} className="text-amber-400 mb-1" />
              <p className="text-xs text-gray-300">Review Appeals</p>
            </button>
            <button
              onClick={() => setActiveTab('copyright')}
              className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left"
            >
              <FileText size={18} className="text-[#c8c8cc] mb-1" />
              <p className="text-xs text-gray-300">Copyright Claims</p>
            </button>
            <button
              onClick={() => setActiveTab('audit-logs')}
              className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left"
            >
              <Activity size={18} className="text-[#c8c8cc] mb-1" />
              <p className="text-xs text-gray-300">Audit Logs</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // REPORTS MANAGEMENT
  // ==========================================================================
  function renderReports() {
    const [processingId, setProcessingId] = useState<string | null>(null);

    const statusColors: Record<string, string> = {
      PENDING: 'text-amber-400',
      UNDER_REVIEW: 'text-[#c8c8cc]',
      INVESTIGATING: 'text-[#c8c8cc]',
      ACTIONED: 'text-emerald-400',
      DISMISSED: 'text-gray-400',
      APPEALED: 'text-orange-400',
    };

    const filteredReports = reports.filter((r: any) => {
      if (statusFilter === 'all') return true;
      return r.status === statusFilter;
    });

    const handleProcess = async (reportId: string, action: string) => {
      setProcessingId(reportId);
      try {
        await adminComplianceApi.processReport(reportId, action, 'Processed by admin');
        showToast(`Report ${action}ed successfully`);
        setReports(await adminComplianceApi.getReports(100, 0));
      } catch (err: any) {
        showToast(err.message, 'error');
      } finally {
        setProcessingId(null);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Report Management</p>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
            >
              <option value="all">All Reports</option>
              <option value="PENDING">Pending</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="ACTIONED">Actioned</option>
              <option value="DISMISSED">Dismissed</option>
            </select>
            <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadTabData}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {filteredReports.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No reports found.</p>
          )}
          {filteredReports.map((report: any) => (
            <div key={report.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${statusColors[report.status] || 'text-gray-400'}`}>
                      {report.status}
                    </span>
                    <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                      {report.priority}
                    </span>
                    <span className="text-xs text-gray-500">{report.category}</span>
                  </div>
                  <p className="text-sm text-white">
                    Report: <span className="text-gray-400">{report.targetType}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Reporter: {report.reporter?.username || 'Unknown'} • {new Date(report.createdAt).toLocaleString()}
                  </p>
                  {report.description && (
                    <p className="text-xs text-gray-400 mt-1">{report.description}</p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  {report.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handleProcess(report.id, 'dismiss')}
                        disabled={processingId === report.id}
                        className="p-2 rounded-lg bg-gray-500/20 hover:bg-gray-500/30 text-gray-400"
                        title="Dismiss"
                      >
                        <XCircle size={16} />
                      </button>
                      <button
                        onClick={() => handleProcess(report.id, 'warn')}
                        disabled={processingId === report.id}
                        className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400"
                        title="Warn user"
                      >
                        <AlertTriangle size={16} />
                      </button>
                      <button
                        onClick={() => handleProcess(report.id, 'suspend')}
                        disabled={processingId === report.id}
                        className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                        title="Suspend user"
                      >
                        <UserX size={16} />
                      </button>
                      <button
                        onClick={() => handleProcess(report.id, 'ban')}
                        disabled={processingId === report.id}
                        className="p-2 rounded-lg bg-red-700/20 hover:bg-red-700/30 text-red-600"
                        title="Ban user"
                      >
                        <Lock size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // APPEALS MANAGEMENT
  // ==========================================================================
  function renderAppeals() {
    const [processingId, setProcessingId] = useState<string | null>(null);

    const statusColors: Record<string, string> = {
      PENDING: 'text-amber-400',
      UNDER_REVIEW: 'text-[#c8c8cc]',
      APPROVED: 'text-emerald-400',
      REJECTED: 'text-red-400',
      ESCALATED: 'text-[#c8c8cc]',
    };

    const handleProcess = async (appealId: string, decision: string) => {
      setProcessingId(appealId);
      try {
        await adminComplianceApi.processAppeal(appealId, decision, `Appeal ${decision.toLowerCase()} by admin`);
        showToast(`Appeal ${decision.toLowerCase()} successfully`);
        setAppeals(await adminComplianceApi.getAppeals(100, 0));
      } catch (err: any) {
        showToast(err.message, 'error');
      } finally {
        setProcessingId(null);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Appeal Management</p>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadTabData}>
            Refresh
          </Button>
        </div>

        <div className="space-y-3">
          {appeals.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No appeals found.</p>
          )}
          {appeals.map((appeal: any) => (
            <div key={appeal.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${statusColors[appeal.status] || 'text-gray-400'}`}>
                      {appeal.status}
                    </span>
                    <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                      {appeal.appealType}
                    </span>
                  </div>
                  <p className="text-sm text-white">{appeal.reason}</p>
                  {appeal.explanation && (
                    <p className="text-xs text-gray-400 mt-1">{appeal.explanation}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    User: {appeal.user?.username || 'Unknown'} • {new Date(appeal.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  {appeal.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handleProcess(appeal.id, 'APPROVED')}
                        disabled={processingId === appeal.id}
                        className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                        title="Approve"
                      >
                        <CheckCircle size={16} />
                      </button>
                      <button
                        onClick={() => handleProcess(appeal.id, 'REJECTED')}
                        disabled={processingId === appeal.id}
                        className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                        title="Reject"
                      >
                        <XCircle size={16} />
                      </button>
                      <button
                        onClick={() => handleProcess(appeal.id, 'ESCALATED')}
                        disabled={processingId === appeal.id}
                        className="p-2 rounded-lg bg-[#c8c8cc]/20 hover:bg-[#c8c8cc]/30 text-[#c8c8cc]"
                        title="Escalate"
                      >
                        <ChevronUp size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // COPYRIGHT MANAGEMENT
  // ==========================================================================
  function renderCopyright() {
    const [processingId, setProcessingId] = useState<string | null>(null);

    const statusColors: Record<string, string> = {
      PENDING: 'text-amber-400',
      UNDER_REVIEW: 'text-[#c8c8cc]',
      ACTIONED: 'text-emerald-400',
      REJECTED: 'text-red-400',
      COUNTER_NOTICE: 'text-[#c8c8cc]',
      RESOLVED: 'text-gray-400',
    };

    const handleProcess = async (claimId: string, action: string) => {
      setProcessingId(claimId);
      try {
        await adminComplianceApi.processCopyrightClaim(claimId, action, `Claim ${action} by admin`);
        showToast(`Claim ${action} successfully`);
        setCopyrightClaims(await adminComplianceApi.getCopyrightClaims(100, 0));
      } catch (err: any) {
        showToast(err.message, 'error');
      } finally {
        setProcessingId(null);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Copyright Claims</p>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadTabData}>
            Refresh
          </Button>
        </div>

        <div className="space-y-3">
          {copyrightClaims.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No copyright claims found.</p>
          )}
          {copyrightClaims.map((claim: any) => (
            <div key={claim.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${statusColors[claim.status] || 'text-gray-400'}`}>
                      {claim.status}
                    </span>
                  </div>
                  <p className="text-sm text-white">{claim.originalWorkTitle}</p>
                  <p className="text-xs text-gray-400 mt-1">Claimant: {claim.claimantName}</p>
                  <p className="text-xs text-gray-400">Rights Holder: {claim.rightsHolderName}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Infringing URL: {claim.infringingUrl} • {new Date(claim.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  {claim.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handleProcess(claim.id, 'remove')}
                        disabled={processingId === claim.id}
                        className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                        title="Remove content"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        onClick={() => handleProcess(claim.id, 'reject')}
                        disabled={processingId === claim.id}
                        className="p-2 rounded-lg bg-gray-500/20 hover:bg-gray-500/30 text-gray-400"
                        title="Reject claim"
                      >
                        <XCircle size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // CHILD SAFETY
  // ==========================================================================
  function renderChildSafety() {
    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Child Safety Flags</p>
        <p className="text-sm text-gray-400">
          Review and process child safety flags. Escalated flags require immediate attention.
        </p>
        <div className="p-8 text-center text-gray-500">
          <Shield size={48} className="mx-auto mb-3 text-gray-600" />
          <p>Child safety flag management tools ready. Flags will appear here when detected or reported.</p>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // AUDIT LOGS
  // ==========================================================================
  function renderAuditLogs() {
    const actionColors: Record<string, string> = {
      CONSENT_CHANGE: 'text-emerald-400',
      PRIVACY_REQUEST: 'text-[#c8c8cc]',
      APPEAL_FILED: 'text-amber-400',
      APPEAL_DECIDED: 'text-[#c8c8cc]',
      MODERATION_ACTION: 'text-red-400',
      ADMIN_ACTION: 'text-[#c8c8cc]',
      POLICY_ACCEPTANCE: 'text-green-400',
      DATA_EXPORT: 'text-indigo-400',
      ACCOUNT_DELETION: 'text-orange-400',
      COPYRIGHT_ACTION: 'text-[#d6a83f]',
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Compliance Audit Logs</p>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={loadTabData}>
            Refresh
          </Button>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit logs..."
              className="w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-[#a8a8ac]/50"
            />
          </div>
        </div>

        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {auditLogs.filter((log: any) => {
            if (!searchQuery) return true;
            const search = searchQuery.toLowerCase();
            return (log.action?.toLowerCase().includes(search) ||
                    log.resourceType?.toLowerCase().includes(search) ||
                    log.userId?.toLowerCase().includes(search));
          }).map((log: any) => (
            <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-black/30 text-xs">
              <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${actionColors[log.action] || 'bg-gray-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${actionColors[log.action] || 'text-gray-300'}`}>
                    {log.action}
                  </span>
                  <span className="text-gray-500">{log.resourceType}</span>
                </div>
                <p className="text-gray-500 mt-0.5">
                  User: {log.userId || 'System'} • IP: {log.ipAddress || 'N/A'}
                </p>
                {log.details && (
                  <p className="text-gray-600 mt-0.5 truncate">{log.details}</p>
                )}
              </div>
              <span className="text-gray-600 flex-shrink-0">
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
          {auditLogs.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No audit logs found.</p>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // TRANSPARENCY
  // ==========================================================================
  function renderTransparency() {
    const handleGenerate = async () => {
      try {
        await adminComplianceApi.generateTransparencyReport();
        showToast('Transparency report generated');
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Transparency Reports</p>
          <Button variant="primary" size="sm" onClick={handleGenerate}>
            Generate Report
          </Button>
        </div>
        <p className="text-sm text-gray-400">
          Generate and manage platform transparency reports. These reports show enforcement actions, report volumes, and appeal outcomes.
        </p>
      </div>
    );
  }

  // ==========================================================================
  // POLICIES MANAGEMENT
  // ==========================================================================
  function renderPolicies() {
    const [policyType, setPolicyType] = useState('TERMS_OF_SERVICE');
    const [policyTitle, setPolicyTitle] = useState('');
    const [policyContent, setPolicyContent] = useState('');
    const [policyVersion, setPolicyVersion] = useState('');
    const [publishing, setPublishing] = useState(false);

    const policyTypes = [
      { value: 'TERMS_OF_SERVICE', label: 'Terms of Service' },
      { value: 'PRIVACY_POLICY', label: 'Privacy Policy' },
      { value: 'COMMUNITY_GUIDELINES', label: 'Community Guidelines' },
      { value: 'CREATOR_AGREEMENT', label: 'Creator Agreement' },
      { value: 'MONETIZATION_AGREEMENT', label: 'Monetization Agreement' },
      { value: 'COOKIE_POLICY', label: 'Cookie Policy' },
    ];

    const handlePublish = async () => {
      if (!policyTitle || !policyContent || !policyVersion) {
        showToast('Please fill all fields', 'error');
        return;
      }
      setPublishing(true);
      try {
        await adminComplianceApi.publishPolicy(policyType, policyVersion, policyTitle, policyContent);
        showToast('Policy published successfully');
        setPolicyTitle('');
        setPolicyContent('');
        setPolicyVersion('');
      } catch (err: any) {
        showToast(err.message, 'error');
      } finally {
        setPublishing(false);
      }
    };

    return (
      <div className="space-y-6">
        <p className="text-lg font-semibold text-white">Policy Management</p>
        <p className="text-sm text-gray-400">Publish new versions of platform policies and user agreements.</p>

        <div className="space-y-4">
          <label className="space-y-2 text-sm text-gray-300">
            <span>Policy Type</span>
            <select
              value={policyType}
              onChange={(e) => setPolicyType(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            >
              {policyTypes.map((pt) => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Version</span>
            <input
              type="text"
              value={policyVersion}
              onChange={(e) => setPolicyVersion(e.target.value)}
              placeholder="e.g., 2.0.0"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            />
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Title</span>
            <input
              type="text"
              value={policyTitle}
              onChange={(e) => setPolicyTitle(e.target.value)}
              placeholder="Policy title"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50"
            />
          </label>

          <label className="space-y-2 text-sm text-gray-300">
            <span>Content (Markdown)</span>
            <textarea
              value={policyContent}
              onChange={(e) => setPolicyContent(e.target.value)}
              rows={10}
              placeholder="Write policy content in Markdown format..."
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-[#a8a8ac]/50 resize-none font-mono text-xs"
            />
          </label>

          <Button variant="primary" size="md" onClick={handlePublish} loading={publishing}>
            Publish Policy
          </Button>
        </div>
      </div>
    );
  }
}