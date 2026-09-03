'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Award, Trophy, Star, Zap, Crown, Flame, Shield, Target, Sparkles, Medal, Gift, Heart, Users, Music, Gamepad2, Palette, BookOpen, TrendingUp, ChevronRight, Lock, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';

const ACHIEVEMENTS = [
  {
    id: 'first-stream',
    title: 'First Stream',
    description: 'Go live for the first time',
    icon: Zap,
    rarity: 'common',
    progress: 100,
    completed: true,
    date: '2 weeks ago',
    xp: 100,
  },
  {
    id: 'rising-star',
    title: 'Rising Star',
    description: 'Reach 100 followers',
    icon: Star,
    rarity: 'rare',
    progress: 85,
    completed: false,
    current: 85,
    target: 100,
    xp: 500,
  },
  {
    id: 'chat-king',
    title: 'Chat King',
    description: 'Send 1,000 messages in streams',
    icon: Heart,
    rarity: 'rare',
    progress: 60,
    completed: false,
    current: 600,
    target: 1000,
    xp: 300,
  },
  {
    id: 'gift-giver',
    title: 'Generous Heart',
    description: 'Send 50 gifts to creators',
    icon: Gift,
    rarity: 'epic',
    progress: 40,
    completed: false,
    current: 20,
    target: 50,
    xp: 750,
  },
  {
    id: 'streak-master',
    title: 'Streak Master',
    description: 'Stream for 7 days in a row',
    icon: Flame,
    rarity: 'epic',
    progress: 100,
    completed: true,
    date: '1 week ago',
    xp: 1000,
  },
  {
    id: 'community-builder',
    title: 'Community Builder',
    description: 'Build a community of 500 members',
    icon: Users,
    rarity: 'legendary',
    progress: 30,
    completed: false,
    current: 150,
    target: 500,
    xp: 2000,
  },
  {
    id: 'versatile-creator',
    title: 'Versatile Creator',
    description: 'Stream in 5 different categories',
    icon: Palette,
    rarity: 'epic',
    progress: 60,
    completed: false,
    current: 3,
    target: 5,
    xp: 800,
  },
  {
    id: 'engagement-king',
    title: 'Engagement King',
    description: 'Get 10,000 total chat messages',
    icon: TrendingUp,
    rarity: 'legendary',
    progress: 15,
    completed: false,
    current: 1500,
    target: 10000,
    xp: 5000,
  },
  {
    id: 'veteran',
    title: 'Veteran',
    description: 'Stream for over 100 hours',
    icon: Trophy,
    rarity: 'legendary',
    progress: 45,
    completed: false,
    current: 45,
    target: 100,
    xp: 3000,
  },
  {
    id: 'champion',
    title: 'Champion',
    description: 'Reach #1 in creator rankings',
    icon: Crown,
    rarity: 'legendary',
    progress: 0,
    completed: false,
    current: 0,
    target: 1,
    xp: 10000,
  },
];

const RARITY_STYLES: Record<string, { bg: string; border: string; text: string; gradient: string }> = {
  common: {
    bg: 'bg-white/[0.03]',
    border: 'border-white/[0.06]',
    text: 'text-white/40',
    gradient: 'from-gray-400 to-gray-500',
  },
  rare: {
    bg: 'bg-[#c8c8cc]/5',
    border: 'border-[#151517]0/20',
    text: 'text-[#c8c8cc]',
    gradient: 'from-[#a8a8ac] to-[#a8a8ac]',
  },
  epic: {
    bg: 'bg-[#c8c8cc]/5',
    border: 'border-[#151517]0/20',
    text: 'text-[#c8c8cc]',
    gradient: 'from-[#a8a8ac] to-[#151517]0',
  },
  legendary: {
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    text: 'text-amber-400',
    gradient: 'from-amber-400 to-orange-500',
  },
};

export default function AchievementsPage() {
  const [filter, setFilter] = useState('all');
  const [selectedAchievement, setSelectedAchievement] = useState<string | null>(null);

  const filtered = filter === 'all'
    ? ACHIEVEMENTS
    : filter === 'completed'
      ? ACHIEVEMENTS.filter(a => a.completed)
      : filter === 'in-progress'
        ? ACHIEVEMENTS.filter(a => !a.completed)
        : ACHIEVEMENTS.filter(a => a.rarity === filter);

  const totalXp = ACHIEVEMENTS.filter(a => a.completed).reduce((sum, a) => sum + a.xp, 0);
  const completedCount = ACHIEVEMENTS.filter(a => a.completed).length;

  return (
    <div className="w-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
      <PageHeader
        title="Achievements"
        back="/profile"
        actions={
          <div className="text-right">
            <p className="text-lg font-bold leading-none text-white">{totalXp.toLocaleString()}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/40">Total XP</p>
          </div>
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
          <p className="text-xl font-bold text-white">{completedCount}</p>
          <p className="text-[10px] text-white/40 mt-0.5">Completed</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">{ACHIEVEMENTS.length - completedCount}</p>
          <p className="text-[10px] text-white/40 mt-0.5">In Progress</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">{Math.round((completedCount / ACHIEVEMENTS.length) * 100)}%</p>
          <p className="text-[10px] text-white/40 mt-0.5">Completion</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4">
          <p className="text-xl font-bold text-white">{ACHIEVEMENTS.length}</p>
          <p className="text-[10px] text-white/40 mt-0.5">Total Achievements</p>
        </div>
      </motion.div>

      {/* Filter Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex flex-wrap gap-2 mb-6"
      >
        {['all', 'completed', 'in-progress', 'common', 'rare', 'epic', 'legendary'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-[10px] font-medium transition-all border',
              filter === f
                ? 'bg-[#d6a83f]/10 border-[#d6a83f]/20 text-[#d6a83f]'
                : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white hover:bg-white/[0.05]'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
          </button>
        ))}
      </motion.div>

      {/* Achievements Grid */}
      <div className="grid grid-cols-1  gap-3">
        <AnimatePresence mode="popLayout">
          {filtered.map((achievement, i) => {
            const styles = RARITY_STYLES[achievement.rarity];
            const Icon = achievement.icon;
            const isSelected = selectedAchievement === achievement.id;

            return (
              <motion.div
                key={achievement.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => setSelectedAchievement(isSelected ? null : achievement.id)}
                className={cn(
                  'rounded-2xl border p-4 cursor-pointer transition-all duration-300',
                  styles.bg,
                  styles.border,
                  isSelected ? 'ring-1 ring-white/10' : '',
                  achievement.completed ? 'opacity-100' : 'opacity-80 hover:opacity-100'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0',
                    styles.gradient,
                    'bg-opacity-20'
                  )}>
                    <Icon size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">{achievement.title}</p>
                      {achievement.completed && <Check size={12} className="text-emerald-400 shrink-0" />}
                    </div>
                    <p className="text-[11px] text-white/40 mt-0.5">{achievement.description}</p>
                    
                    {!achievement.completed && achievement.current !== undefined && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[9px] text-white/30 mb-1">
                          <span>{achievement.current}/{achievement.target}</span>
                          <span>{achievement.progress}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                          <motion.div
                            className={cn('h-full rounded-full bg-gradient-to-r', styles.gradient)}
                            initial={{ width: '0%' }}
                            animate={{ width: `${achievement.progress}%` }}
                            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </div>
                      </div>
                    )}

                    {achievement.completed && achievement.date && (
                      <p className="text-[9px] text-white/20 mt-2 flex items-center gap-1">
                        <Clock size={8} />
                        Earned {achievement.date}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={cn('text-[9px] font-medium uppercase tracking-wider', styles.text)}>
                      {achievement.rarity}
                    </span>
                    <p className="text-[8px] text-white/20 mt-0.5">{achievement.xp} XP</p>
                  </div>
                </div>

                {/* Expanded details */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 pt-3 border-t border-white/[0.04]">
                        <div className="flex items-center gap-4 text-[10px] text-white/30">
                          <span>Reward: {achievement.xp} XP</span>
                          <span>Rarity: {achievement.rarity}</span>
                          {achievement.completed && <span className="text-emerald-400">✓ Completed</span>}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Empty State */}
      {filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-16"
        >
          <Trophy size={40} className="text-white/10 mb-4" />
          <p className="text-sm text-white/30">No achievements found</p>
        </motion.div>
      )}
    </div>
  );
}