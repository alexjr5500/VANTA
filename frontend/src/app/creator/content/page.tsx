"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FileText, Video, BookOpen, Clock, Calendar,
  Edit3, Trash2, Eye, MoreHorizontal, Search, Filter,
  CheckCircle, XCircle, Play, Image
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { apiGet } from '@/lib/apiClient';

const typeIcons: Record<string, any> = { post: FileText, video: Video, short: Play, story: BookOpen };
const typeColors: Record<string, string> = { post: 'bg-[#c8c8cc]/15 text-[#c8c8cc]', video: 'bg-[#c8c8cc]/15 text-[#c8c8cc]', short: 'bg-[#151517]0/15 text-[#f2c75c]', story: 'bg-amber-500/15 text-amber-300' };
const statusStyles: Record<string, string> = { draft: 'bg-gray-500/15 text-gray-400', scheduled: 'bg-[#c8c8cc]/15 text-[#c8c8cc]', published: 'bg-green-500/15 text-green-300' };

interface ContentDraft {
  id: string; type: string; title: string; content?: string;
  status: string; thumbnail?: string; mediaUrl?: string;
  scheduledFor?: string; createdAt: string; updatedAt: string;
}

export default function CreatorContentPage() {
  const [filter, setFilter] = useState('all');
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiGet<ContentDraft[]>('/api/creator/content');
        setDrafts(data || []);
      } catch { setDrafts([]); }
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const filtered = filter === 'all' ? drafts : drafts.filter(c => c.status === filter);

  return (
    <div className="w-full space-y-6">
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {['all', 'published', 'scheduled', 'draft'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 text-xs font-medium rounded-full transition-all whitespace-nowrap ${filter === s ? 'bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white' : 'glass text-gray-400 hover:text-white'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)} ({s === 'all' ? drafts.length : drafts.filter(c => c.status === s).length})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1   gap-4">
        {filtered.map((item, i) => {
          const TypeIcon = typeIcons[item.type] || FileText;
          return (
            <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="glass rounded-[20px] p-5 border border-white/[0.06] hover:border-white/[0.12] transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${typeColors[item.type] || 'bg-white/10'}`}>
                  <TypeIcon size={16} />
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusStyles[item.status] || 'bg-gray-500/15 text-gray-300'}`}>
                  {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </span>
              </div>
              <h3 className="text-sm font-bold text-white mb-1 line-clamp-1">{item.title || 'Untitled'}</h3>
              <p className="text-xs text-gray-400 line-clamp-2 mb-3">{item.content || item.mediaUrl || ''}</p>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mt-auto">
                <span className="flex items-center gap-1"><Clock size={10} />{new Date(item.updatedAt || item.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-1 mt-3 pt-3 border-t border-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="flex-1 p-2 rounded-xl text-xs bg-white/5 text-gray-300 hover:bg-white/10"><Eye size={12} className="inline mr-1" />Preview</button>
                <button className="p-2 rounded-xl text-xs bg-white/5 text-[#c8c8cc] hover:bg-[#c8c8cc]/10"><Edit3 size={12} /></button>
                <button className="p-2 rounded-xl text-xs bg-white/5 text-red-400 hover:bg-red-500/10"><Trash2 size={12} /></button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}