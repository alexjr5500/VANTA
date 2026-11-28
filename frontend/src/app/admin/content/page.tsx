'use client';

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  FileText, Video, BookOpen, MessageSquare, RefreshCw, Shield,
  AlertTriangle, CheckCircle, XCircle, Loader2,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getContentItems, reviewContentItem, setContentSensitivity } from '@/lib/adminApi';

interface QueueItem {
  id: string;
  targetType: string;
  targetId: string;
  targetUserId?: string | null;
  reportedBy?: string | null;
  category?: string | null;
  description?: string | null;
  evidenceUrls?: string | null;
  reason?: string | null;
  aiScore: number;
  aiCategories?: string | null;
  aiSummary?: string | null;
  status: string;
  priority: number;
  createdAt: string;
}

export default function ContentPage() {
  const [counts, setCounts] = useState<any>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingQueue, setPendingQueue] = useState(0);
  const [pendingReports, setPendingReports] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
      if (!token) {
        setError('Your admin session is unavailable. Please sign in again.');
        setCounts(null);
        setQueue([]);
        setPendingQueue(0);
        setPendingReports(0);
        return;
      }
      const data = await getContentItems(token);
      setCounts(data.counts || {});
      setQueue(data.queue || []);
      setPendingQueue(data.pendingQueue || 0);
      setPendingReports(data.pendingReports || 0);
    } catch (err: any) {
      setError(err?.message || 'Failed to load content moderation.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const review = async (item: QueueItem, action: 'APPROVED' | 'REMOVED') => {
    const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
    if (!token) {
      setNotice('Action failed: your admin session is unavailable. Please sign in again.');
      return;
    }
    if (busyId) return;
    let reason: string | undefined;
    if (action === 'REMOVED') {
      const ok = window.confirm('Remove this content item from the platform? This records a moderation action and closes the review.');
      if (!ok) return;
      const enteredReason = window.prompt('Removal reason (required for the moderation audit):');
      if (enteredReason === null) return;
      reason = enteredReason.trim();
      if (!reason) {
        setNotice('Action failed: a removal reason is required.');
        return;
      }
      if (reason.length > 500) {
        setNotice('Action failed: the removal reason must be 500 characters or fewer.');
        return;
      }
    }
    setBusyId(item.id);
    setNotice(null);
    try {
      await reviewContentItem(token, item.id, action, reason);
      setNotice(`Content ${action.toLowerCase()} — review closed.`);
      await fetchData();
    } catch (err: any) {
      setNotice(`Action failed: ${err?.message || 'please retry'}`);
    } finally {
      setBusyId(null);
    }
  };

  const [labelType,setLabelType]=useState<'post'|'reel'>('post');
  const [labelId,setLabelId]=useState('');
  const [labelReason,setLabelReason]=useState('');
  const [labelBusy,setLabelBusy]=useState(false);
  const changeLabel=async(sensitive:boolean)=>{
    const token=localStorage.getItem('vanta_token')||localStorage.getItem('token');
    if(!token||!labelId.trim()||!labelReason.trim()||labelBusy)return;
    if(!window.confirm(sensitive?'Label this allowed content as sensitive? Prohibited material must be removed instead.':'Remove the sensitive-content label?'))return;
    setLabelBusy(true);setNotice(null);
    try{await setContentSensitivity(token,labelType,labelId.trim(),sensitive,labelReason.trim());setNotice(sensitive?'Sensitive label applied.':'Sensitive label removed.');setLabelReason('');}
    catch(error){setNotice('Action failed: '+(error instanceof Error?error.message:'please retry'));}
    finally{setLabelBusy(false);}
  };
  const typeIcon = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t.includes('video') || t.includes('short') || t.includes('reel')) return <Video size={14} />;
    if (t.includes('story')) return <BookOpen size={14} />;
    if (t.includes('comment')) return <MessageSquare size={14} />;
    return <FileText size={14} />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Content</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Content Moderation</h1>
          <p className="text-sm text-gray-400 mt-1">Review flagged content and track platform totals.</p>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
      </div>

      {notice && (
        <div className={cn('glass rounded-xl px-4 py-2.5 text-sm border', notice.startsWith('Action failed') ? 'border-red-500/20 text-red-300' : 'border-emerald-500/20 text-emerald-300')}>
          {notice}
        </div>
      )}

      <GlassCard>
        <h3 className="text-sm font-bold mb-3">Sensitive-content labels</h3>
        <p className="text-xs opacity-75 mb-3">For permitted but sensitive posts and reels. Labels affect feeds; remove prohibited content through moderation instead.</p>
        <div className="grid gap-3">
          <select aria-label="Content type" value={labelType} onChange={event=>setLabelType(event.target.value as 'post'|'reel')} className="settings-input"><option value="post">Post</option><option value="reel">Reel</option></select>
          <input aria-label="Content ID" value={labelId} onChange={event=>setLabelId(event.target.value)} placeholder="Content ID from moderation queue" className="settings-input" />
          <input aria-label="Reason" maxLength={500} value={labelReason} onChange={event=>setLabelReason(event.target.value)} placeholder="Moderation reason" className="settings-input" />
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={labelBusy||!labelId.trim()||!labelReason.trim()} onClick={()=>void changeLabel(true)}>Mark sensitive</Button><Button variant="ghost" size="sm" disabled={labelBusy||!labelId.trim()||!labelReason.trim()} onClick={()=>void changeLabel(false)}>Remove label</Button></div>
        </div>
      </GlassCard>
      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CountCard label="Posts" value={counts?.posts ?? 0} icon={<FileText size={16} />} cls="bg-[#d9a83f]/15 text-[#d9a83f]" />
        <CountCard label="Videos" value={counts?.videos ?? 0} icon={<Video size={16} />} cls="bg-sky-500/15 text-sky-400" />
        <CountCard label="Stories" value={counts?.stories ?? 0} icon={<BookOpen size={16} />} cls="bg-violet-500/15 text-violet-400" />
        <CountCard label="Comments" value={counts?.comments ?? 0} icon={<MessageSquare size={16} />} cls="bg-emerald-500/15 text-emerald-400" />
      </div>
{/* Pending moderation queue */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#d9a83f]" />
            <h3 className="text-sm font-bold text-white">Pending Moderation Queue</h3>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
            {pendingQueue} pending · {pendingReports} user reports
          </span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-400">{error}</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
          </div>
        ) : queue.length === 0 ? (
          <div className="py-12 text-center">
            <Shield size={34} className="mx-auto mb-3 text-white/15" />
            <p className="text-sm text-white/50">No pending moderation items. All flagged content has been reviewed.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-gray-300">{typeIcon(item.targetType)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{item.targetType}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d9a83f]/10 text-[#d9a83f]">AI score {(item.aiScore ?? 0).toFixed(2)}</span>
                    <span className="text-[10px] text-gray-500">priority {item.priority}</span>
                    <span className="text-[10px] text-gray-600">{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-300 line-clamp-2">{item.aiSummary || item.reason || 'Flagged for review.'}</p>
                  {item.description && <p className="text-xs text-gray-400 mt-2">Report details: {item.description}</p>}
                  {item.category && <p className="text-[10px] text-gray-500 mt-1">Report category: {item.category}</p>}
                  {item.targetUserId && <p className="text-[10px] text-gray-500 mt-1">Target account: {item.targetUserId}</p>}
                  {item.aiCategories && <p className="text-[10px] text-gray-500 mt-1">Categories: {item.aiCategories}</p>}
                  {item.evidenceUrls && <EvidenceLinks value={item.evidenceUrls} />}
                  <p className="text-[10px] text-gray-600 font-mono mt-1 truncate">target: {item.targetId}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="primary" size="sm" className="!px-2.5" icon={<CheckCircle size={13} />} disabled={busyId === item.id} onClick={() => void review(item, 'APPROVED')}>
                    Approve
                  </Button>
                  <Button variant="danger" size="sm" className="!px-2.5" icon={<XCircle size={13} />} disabled={busyId === item.id} onClick={() => void review(item, 'REMOVED')}>
                    Remove
                  </Button>
                  {busyId === item.id && <Loader2 size={14} className="animate-spin text-gray-500" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function EvidenceLinks({ value }: { value: string }) {
  let urls: string[] = [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      urls = parsed.filter((entry): entry is string =>
        typeof entry === 'string' && /^https?:\/\//i.test(entry)
      );
    }
  } catch {
    urls = [];
  }
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {urls.map((url, index) => (
        <a key={url + index} href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-sky-300 underline underline-offset-2">
          Open evidence {index + 1}
        </a>
      ))}
    </div>
  );
}

function CountCard({ label, value, icon, cls }: { label: string; value: number; icon: any; cls: string }) {
  return (
    <div className="glass rounded-2xl border border-white/[0.06] p-4">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2', cls)}>{icon}</div>
      <p className="text-xl font-bold text-white tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}