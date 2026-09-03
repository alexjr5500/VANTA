"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FileText, Search, Filter, CheckCircle, XCircle, AlertTriangle,
  Eye, EyeOff, Clock, Trash2, RotateCcw, Flag, Shield,
  Video, Image, MessageSquare, BookOpen, MoreHorizontal, Sparkles
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getContentItems } from '@/lib/adminApi';
import type { ContentItem } from '@/types/admin';

const typeIcons: Record<string, any> = {
  post: FileText,
  short: Video,
  story: BookOpen,
  comment: MessageSquare,
  image: Image,
};

export default function ContentPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getContentItems(token);
        setItems(data);
      } catch (err) {
        console.error('Failed to fetch content:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = items.filter(item => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (search && !item.authorName?.toLowerCase().includes(search.toLowerCase()) && !item.content?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Content</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Content Moderation</h1>
          <p className="text-sm text-gray-400 mt-1">Review, approve, and remove user-generated content.</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2  gap-3">
        {[
          { label: 'Total', value: String(items.length), icon: FileText, color: 'from-[#d6a83f] to-[#b78929]' },
          { label: 'Approved', value: String(items.filter(i => i.status === 'approved').length), icon: CheckCircle, color: 'from-green-500 to-emerald-600' },
          { label: 'Flagged', value: String(items.filter(i => i.status === 'flagged').length), icon: AlertTriangle, color: 'from-yellow-500 to-amber-600' },
          { label: 'Reports', value: String(items.reduce((s, i) => s + i.reportCount, 0)), icon: Flag, color: 'from-red-500 to-[#b78929]' },
        ].map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass rounded-[20px] p-4 border border-white/[0.06]">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br ${card.color} mb-2`}>
              <card.icon size={16} className="text-white" />
            </div>
            <p className="text-xl font-bold text-white">{card.value}</p>
            <p className="text-xs text-gray-400">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <GlassCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06] flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-500" />
            <input type="text" placeholder="Search content..." value={search} onChange={e => setSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="glass rounded-2xl px-3 py-1.5 text-sm text-white border border-white/[0.06] outline-none bg-transparent">
            <option value="all">All Types</option>
            <option value="post">Post</option>
            <option value="short">Short</option>
            <option value="story">Story</option>
            <option value="comment">Comment</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="glass rounded-2xl px-3 py-1.5 text-sm text-white border border-white/[0.06] outline-none bg-transparent">
            <option value="all">All Status</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
            <option value="removed">Removed</option>
          </select>
        </div>
      </GlassCard>

      {/* Content Items */}
      <div className="space-y-2">
        {filtered.map((item, i) => (
          <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            className="glass rounded-[20px] p-4 border border-white/[0.06] hover:border-white/[0.12] transition-all">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                {(typeIcons[item.type] || FileText)({ size: 16, className: 'text-gray-400' })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-500">{item.authorName}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-400">{item.type}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    item.status === 'approved' ? 'bg-green-500/15 text-green-400' :
                    item.status === 'flagged' ? 'bg-yellow-500/15 text-yellow-400' :
                    'bg-red-500/15 text-red-400'
                  }`}>{item.status}</span>
                  {item.reportCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">{item.reportCount} reports</span>
                  )}
                </div>
                <p className="text-xs text-gray-300 line-clamp-2">{item.content}</p>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                  <span>{item.views.toLocaleString()} views</span>
                  <span>{item.likes.toLocaleString()} likes</span>
                  <span>{item.comments.toLocaleString()} comments</span>
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-2 rounded-xl hover:bg-green-500/10 text-green-400 transition-colors" title="Approve"><CheckCircle size={14} /></button>
                <button className="p-2 rounded-xl hover:bg-red-500/10 text-red-400 transition-colors" title="Remove"><Trash2 size={14} /></button>
                <button className="p-2 rounded-xl hover:bg-white/10 text-gray-400 transition-colors"><MoreHorizontal size={14} /></button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}