// =============================================================================
// VANTA Locale-Aware Notification Scheduler
// Timezone-aware notification scheduling with locale formatting
// =============================================================================

import { type Locale } from './config';

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export interface NotificationSchedule {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  scheduledFor: Date;
  timezone: string;
  locale: Locale;
  priority: NotificationPriority;
  channels: ('push' | 'email' | 'sms' | 'in_app')[];
}

export interface LocalizedNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// Hours considered "quiet hours" per region (user should not be disturbed)
const quietHoursByRegion: Record<string, { start: number; end: number }> = {
  north_america: { start: 22, end: 7 },
  south_america: { start: 22, end: 7 },
  western_europe: { start: 22, end: 7 },
  central_europe: { start: 22, end: 7 },
  middle_east: { start: 23, end: 6 },
  south_asia: { start: 22, end: 6 },
  southeast_asia: { start: 22, end: 6 },
  east_asia: { start: 22, end: 6 },
  oceania: { start: 22, end: 7 },
};

/**
 * Get the best delivery time for a notification based on user's timezone
 * Avoids sending during quiet hours
 */
export function getBestDeliveryTime(
  timezone: string,
  preferredHour: number = 10,
  priority: NotificationPriority = NotificationPriority.NORMAL
): Date {
  if (priority === NotificationPriority.URGENT || priority === NotificationPriority.HIGH) {
    return new Date(); // Send immediately for urgent/high priority
  }

  const now = new Date();
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = userTime.getHours();

  // Determine region from timezone offset
  const offset = userTime.getTimezoneOffset();
  let region = 'western_europe';
  if (offset >= 60 && offset < 300) region = 'western_europe';
  else if (offset >= 300 && offset < 420) region = 'south_america';
  else if (offset >= -300 && offset <= -60) region = 'east_asia';
  else if (offset >= 420 && offset < 600) region = 'south_asia';

  const quiet = quietHoursByRegion[region] || { start: 22, end: 7 };

  // If within quiet hours, schedule for next preferred hour
  if (currentHour >= quiet.start || currentHour < quiet.end) {
    const scheduled = new Date(userTime);
    if (currentHour >= quiet.start) {
      // Schedule for tomorrow
      scheduled.setDate(scheduled.getDate() + 1);
    }
    scheduled.setHours(preferredHour, 0, 0, 0);
    return scheduled;
  }

  return now;
}

/**
 * Format notification timestamp for the user's locale and timezone
 */
export function formatNotificationTime(
  date: Date,
  locale: Locale,
  timezone: string
): string {
  try {
    const localeMap: Record<string, string> = {
      'en': 'en-US', 'fr': 'fr-FR', 'es': 'es-ES', 'pt': 'pt-BR',
      'ar': 'ar-SA', 'de': 'de-DE', 'it': 'it-IT', 'tr': 'tr-TR',
      'ru': 'ru-RU', 'hi': 'hi-IN', 'ur': 'ur-PK', 'bn': 'bn-BD',
      'id': 'id-ID', 'vi': 'vi-VN', 'th': 'th-TH', 'zh': 'zh-CN',
      'zh-TW': 'zh-TW', 'ja': 'ja-JP', 'ko': 'ko-KR',
    };

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just_now';
    if (diffMins < 60) return `${diffMins}m_ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h_ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d_ago`;

    return new Intl.DateTimeFormat(localeMap[locale] || 'en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * Get localized notification content
 * Maps notification types to localized strings
 */
export function getLocalizedNotificationContent(
  notificationType: string,
  locale: Locale,
  params: Record<string, string> = {}
): LocalizedNotification {
  // The actual translation is handled by the frontend t() function
  // This function returns the translation keys that the frontend will resolve
  const keyMap: Record<string, string> = {
    new_follower: 'notifications.newFollower',
    new_like: 'notifications.newLike',
    new_comment: 'notifications.newComment',
    new_share: 'notifications.newShare',
    new_stream: 'notifications.newStream',
    stream_started: 'notifications.streamStarted',
    gift_received: 'notifications.giftReceived',
    gift_sent: 'notifications.giftSent',
    new_message: 'notifications.newMessage',
    match_found: 'notifications.matchFound',
    subscription_renewed: 'notifications.subscriptionRenewed',
    subscription_expired: 'notifications.subscriptionExpired',
    reward_earned: 'notifications.rewardEarned',
    achievement_unlocked: 'notifications.achievementUnlocked',
    milestone_reached: 'notifications.milestoneReached',
    account_update: 'notifications.accountUpdate',
    security_alert: 'notifications.securityAlert',
    login_from_new_device: 'notifications.loginFromNewDevice',
    password_changed: 'notifications.passwordChanged',
    email_changed: 'notifications.emailChanged',
    mention: 'notifications.mention',
    tag: 'notifications.tag',
    follow_request: 'notifications.followRequest',
    accepted_follow_request: 'notifications.acceptedFollowRequest',
    community_invite: 'notifications.communityInvite',
    event_reminder: 'notifications.eventReminder',
    stream_reminder: 'notifications.streamReminder',
    suggested_content: 'notifications.suggestedContent',
    suggested_user: 'notifications.suggestedUser',
  };

  const key = keyMap[notificationType] || 'notifications.title';

  return {
    title: key,
    body: key,
    data: params,
  };
}

/**
 * Schedule a notification for optimal delivery
 */
export function scheduleNotification(
  schedule: Omit<NotificationSchedule, 'id'>
): NotificationSchedule {
  const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const bestTime = getBestDeliveryTime(
    schedule.timezone,
    10,
    schedule.priority
  );

  return {
    ...schedule,
    id,
    scheduledFor: bestTime,
  };
}

/**
 * Queue batch notifications with locale-aware scheduling
 */
export function queueBatchNotifications(
  notifications: Omit<NotificationSchedule, 'id'>[]
): NotificationSchedule[] {
  return notifications.map(n => scheduleNotification(n));
}

/**
 * Get time until next non-quiet hour for a timezone
 */
export function getTimeUntilNextDeliveryWindow(
  timezone: string,
  region?: string
): number {
  const now = new Date();
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = userTime.getHours();
  const quiet = quietHoursByRegion[region || 'western_europe'] || { start: 22, end: 7 };

  if (currentHour >= quiet.start || currentHour < quiet.end) {
    // Calculate minutes until quiet hours end
    let hoursUntilEnd: number;
    if (currentHour >= quiet.start) {
      hoursUntilEnd = (24 - currentHour) + quiet.end;
    } else {
      hoursUntilEnd = quiet.end - currentHour;
    }
    return hoursUntilEnd * 60;
  }

  return 0; // Within delivery window
}

/**
 * Sort notifications by priority and optimal delivery time
 */
export function prioritizeNotifications(
  notifications: NotificationSchedule[]
): NotificationSchedule[] {
  const priorityOrder = {
    [NotificationPriority.URGENT]: 0,
    [NotificationPriority.HIGH]: 1,
    [NotificationPriority.NORMAL]: 2,
    [NotificationPriority.LOW]: 3,
  };

  return [...notifications].sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.scheduledFor.getTime() - b.scheduledFor.getTime();
  });
}