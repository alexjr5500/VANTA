'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Clock, ChevronLeft, ChevronRight, Plus, Radio, Music, Gamepad2, Palette, BookOpen, Trophy, Monitor, Heart, MessageCircle, Users, Bell, Edit3, Trash2, MoreHorizontal, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SCHEDULED_STREAMS = [
  { id: 1, title: 'Gaming Night', date: '2026-07-26', time: '20:00', duration: '2h', category: 'gaming', status: 'upcoming' },
  { id: 2, title: 'Music Session', date: '2026-07-27', time: '18:00', duration: '1.5h', category: 'music', status: 'upcoming' },
  { id: 3, title: 'Art Stream', date: '2026-07-28', time: '15:00', duration: '3h', category: 'creative', status: 'upcoming' },
  { id: 4, title: 'Tech Talk', date: '2026-07-29', time: '19:00', duration: '1h', category: 'tech', status: 'upcoming' },
  { id: 5, title: 'Just Chatting', date: '2026-07-25', time: '21:00', duration: '1h', category: 'chatting', status: 'completed' },
  { id: 6, title: 'Study Session', date: '2026-07-24', time: '14:00', duration: '2h', category: 'education', status: 'completed' },
];

const CATEGORY_ICONS: Record<string, any> = {
  gaming: Gamepad2, music: Music, creative: Palette, education: BookOpen,
  sports: Trophy, tech: Monitor, lifestyle: Heart, chatting: MessageCircle,
};

const CATEGORY_COLORS: Record<string, string> = {
  gaming: 'from-[#151517]0/20 to-[#151517]0/20 border-[#151517]0/20 text-[#c8c8cc]',
  music: 'from-[#151517]0/20 to-[#151517]0/20 border-[#151517]0/20 text-[#c8c8cc]',
  creative: 'from-[#d6a83f]/20 to-[#d6a83f]/20 border-[#151517]0/20 text-[#d6a83f]',
  education: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/20 text-emerald-400',
  sports: 'from-amber-500/20 to-orange-500/20 border-amber-500/20 text-amber-400',
  tech: 'from-[#151517]0/20 to-[#151517]0/20 border-[#151517]0/20 text-[#c8c8cc]',
  lifestyle: 'from-[#d6a83f]/20 to-[#151517]0/20 border-[#d6a83f]/20 text-[#d6a83f]',
  chatting: 'from-[#8a8a8a]/20 to-[#151517]0/20 border-[#8a8a8a]/20 text-[#a8a8ac]',
};

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 6, 26)); // July 26, 2026
  const [selectedDate, setSelectedDate] = useState('2026-07-26');
  const [showAddModal, setShowAddModal] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(2026, 6, 26);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const selectedStreams = SCHEDULED_STREAMS.filter(s => s.date === selectedDate);
  const upcomingStreams = SCHEDULED_STREAMS.filter(s => s.status === 'upcoming');
  const completedStreams = SCHEDULED_STREAMS.filter(s => s.status === 'completed');

  const getCategoryIcon = (category: string) => {
    const Icon = CATEGORY_ICONS[category] || Radio;
    return Icon;
  };

  const getCategoryColor = (category: string) => {
    return CATEGORY_COLORS[category] || 'from-gray-500/20 to-gray-500/20 border-gray-500/20 text-gray-400';
  };

  return (
    <div className="w-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <PageHeader
          title="Schedule"
          back="/profile"
          actions={
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#F2C75C] px-3 text-xs font-semibold text-black transition hover:bg-[#d6a83f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <Plus size={15} />
              Schedule Stream
            </button>
          }
        />
      </motion.div>

      {/* Stats Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2  gap-3 mb-8"
      >
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">{upcomingStreams.length}</p>
          <p className="text-[10px] text-white/40 mt-0.5">Upcoming</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">{completedStreams.length}</p>
          <p className="text-[10px] text-white/40 mt-0.5">Completed</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">{SCHEDULED_STREAMS.length}</p>
          <p className="text-[10px] text-white/40 mt-0.5">Total Streams</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">10.5h</p>
          <p className="text-[10px] text-white/40 mt-0.5">Total Hours</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1  gap-6">
        {/* Calendar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className=""
        >
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.05] transition-all">
                <ChevronLeft size={16} />
              </button>
              <h3 className="text-sm font-semibold text-white">
                {MONTHS[month]} {year}
              </h3>
              <button onClick={nextMonth} className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.05] transition-all">
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {DAYS.map(day => (
                <div key={day} className="text-center text-[9px] text-white/30 font-medium py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = dateStr === '2026-07-26';
                const isSelected = dateStr === selectedDate;
                const hasStream = SCHEDULED_STREAMS.some(s => s.date === dateStr);
                const isPast = new Date(dateStr) < today;

                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(dateStr)}
                    className={cn(
                      'relative aspect-square rounded-xl text-xs font-medium transition-all',
                      isSelected
                        ? 'bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc] text-white shadow-lg shadow-[#d6a83f]/20'
                        : isToday
                          ? 'bg-white/[0.06] text-white border border-white/[0.1]'
                          : isPast
                            ? 'text-white/20'
                            : 'text-white/50 hover:bg-white/[0.04] hover:text-white'
                    )}
                  >
                    {day}
                    {hasStream && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#d6a83f]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* Streams List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className=""
        >
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
            <h3 className="text-sm font-semibold text-white mb-4">
              {selectedDate === '2026-07-26' ? "Today's Streams" : `Streams on ${selectedDate}`}
            </h3>

            {selectedStreams.length > 0 ? (
              <div className="space-y-2">
                {selectedStreams.map((stream, i) => {
                  const Icon = getCategoryIcon(stream.category);
                  const colorClass = getCategoryColor(stream.category);
                  return (
                    <motion.div
                      key={stream.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-2xl border transition-all group',
                        stream.status === 'completed' ? 'bg-white/[0.02] border-white/[0.04] opacity-60' : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
                      )}
                    >
                      <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center border', colorClass)}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium truncate', stream.status === 'completed' ? 'text-white/50' : 'text-white')}>
                          {stream.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-white/30 flex items-center gap-1">
                            <Clock size={9} />
                            {stream.time} · {stream.duration}
                          </span>
                          <span className="text-[9px] text-white/20 capitalize">{stream.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {stream.status === 'upcoming' && (
                          <>
                            <button className="p-1.5 rounded-lg text-white/20 hover:text-white hover:bg-white/[0.05] transition-all opacity-0 group-hover:opacity-100">
                              <Bell size={12} />
                            </button>
                            <button className="p-1.5 rounded-lg text-white/20 hover:text-white hover:bg-white/[0.05] transition-all opacity-0 group-hover:opacity-100">
                              <Edit3 size={12} />
                            </button>
                            <button className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100">
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                        {stream.status === 'completed' && (
                          <span className="text-[9px] text-emerald-400/60 flex items-center gap-1">
                            <Check size={10} />
                            Completed
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <Calendar size={32} className="text-white/10 mb-3" />
                <p className="text-sm text-white/30">No streams scheduled for this day</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-3 text-xs text-[#d6a83f] hover:underline"
                >
                  Schedule a stream
                </button>
              </div>
            )}
          </div>

          {/* Upcoming This Week */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4 mt-4">
            <h3 className="text-sm font-semibold text-white mb-4">Upcoming This Week</h3>
            <div className="space-y-2">
              {upcomingStreams.slice(0, 4).map((stream, i) => {
                const Icon = getCategoryIcon(stream.category);
                const colorClass = getCategoryColor(stream.category);
                const streamDate = new Date(stream.date);
                const dayName = DAYS[streamDate.getDay()];
                const dayNum = streamDate.getDate();

                return (
                  <motion.div
                    key={stream.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center justify-center shrink-0">
                      <span className="text-[9px] text-white/40">{dayName}</span>
                      <span className="text-sm font-bold text-white leading-none">{dayNum}</span>
                    </div>
                    <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center border', colorClass)}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{stream.title}</p>
                      <p className="text-[9px] text-white/30">{stream.time} · {stream.duration}</p>
                    </div>
                    <span className="text-[9px] text-white/20 capitalize">{stream.category}</span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Add Stream Modal */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] min-h-0 overflow-y-auto overscroll-contain sm:inset-4"
            >
              <div className="min-h-full rounded-3xl border border-white/[0.08] bg-[#0e0e16]/95 p-5 shadow-2xl backdrop-blur-2xl sm:p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-white">Schedule Stream</h2>
                  <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/[0.05] transition">
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Stream Title</label>
                    <input
                      placeholder="Enter stream title..."
                      className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#d6a83f]/30 transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Date</label>
                      <input
                        type="date"
                        className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white focus:outline-none focus:border-[#d6a83f]/30 transition-all [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Time</label>
                      <input
                        type="time"
                        className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white focus:outline-none focus:border-[#d6a83f]/30 transition-all [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Duration</label>
                    <select className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white focus:outline-none focus:border-[#d6a83f]/30 transition-all">
                      <option>30 min</option>
                      <option>1 hour</option>
                      <option>1.5 hours</option>
                      <option>2 hours</option>
                      <option>3 hours</option>
                      <option>4 hours</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
                    <div className="grid grid-cols-4 gap-2">
                      {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
                        <button
                          key={key}
                          className="flex flex-col items-center gap-1 p-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] text-gray-400 hover:text-white hover:bg-white/[0.05] transition-all"
                        >
                          <Icon size={16} />
                          <span className="text-[8px] capitalize">{key}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-white/[0.06]">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2.5 rounded-2xl border border-white/[0.06] text-sm text-gray-300 hover:text-white transition"
                  >
                    Cancel
                  </button>
                  <button className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white text-sm font-bold shadow-lg shadow-[#d6a83f]/20">
                    Schedule
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}