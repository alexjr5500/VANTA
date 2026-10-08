/*!
 * VANTA — push notification service worker
 *
 * Receives Web Push messages from the VANTA backend (delivered through the
 * browser's push service) and renders them as REAL OS-level notifications even
 * when the VANTA app is closed/backgrounded/locked, and routes taps/actions
 * back into the app (Answer/Decline for incoming calls).
 *
 * IMPORTANT: served verbatim from frontend/public/vanta-sw.js (never processed
 * by Next.js). Plain JavaScript, no imports. Bump the version to force updates.
 */
/* vanta-sw version: 1.0.0 */

'use strict';

var VANTA_ICON = '/branding/vanta-icon-192.png';
var VANTA_RINGTONE = '/sounds/vanta-ringtone.mp3';

// Call events that only dismiss a visible incoming-call notification.
var CALL_RESOLUTIONS = new Set([
  'call_cancelled',
  'call_answered',
  'call_declined',
  'call_ended',
  'missed_call',
]);

// CallIds the page confirmed it handled via its realtime socket while focused:
// we must not show a duplicate OS notification for those.
var handledCalls = new Set();

/* ------------------------------------------------------------------------- */
/* page <-> SW coordination                                                  */
/* ------------------------------------------------------------------------- */

self.addEventListener('message', function (event) {
  var data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'vanta-call-handled' && data.callId) {
    handledCalls.add(String(data.callId));
    scheduleHandledPrune();
  } else if (data.type === 'vanta-dismiss-call' && data.callId) {
    void dismissCallNotification(String(data.callId));
  }
});

function scheduleHandledPrune() {
  // Only needs to survive the server-side ringing window (90s).
  setTimeout(function () { handledCalls = new Set(); }, 3 * 60 * 1000);
}

function sendToClients(message) {
  try {
    return self.clients.matchAll({ type: 'window' }).then(function (clients) {
      clients.forEach(function (client) { client.postMessage(message); });
    });
  } catch (err) {
    return Promise.resolve();
  }
}

function hasFocusedApp() {
  if (!self.clients || !self.clients.matchAll) return Promise.resolve(false);
  try {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      return clients.some(function (c) { return c.focused && c.visibilityState === 'visible'; });
    });
  } catch (err) {
    return Promise.resolve(false);
  }
}

function dismissCallNotification(callId) {
  if (!self.registration) return Promise.resolve();
  try {
    return self.registration.getNotifications({ tag: 'vanta-call-' + callId }).then(function (list) {
      list.forEach(function (n) { n.close(); });
    });
  } catch (err) {
    return Promise.resolve();
  }
}

/* ------------------------------------------------------------------------- */
/* tap routing                                                               */
/* ------------------------------------------------------------------------- */

function appOrigin() {
  try {
    var scope = self.registration && self.registration.scope ? self.registration.scope : null;
    if (scope) return String(scope).replace(/\/+$/, '');
  } catch (err) { /* fall through */ }
  return '';
}

function buildTargetUrl(data) {
  var origin = appOrigin();
  if (!data) return origin + '/notifications';
  if (data.conversationId) return origin + '/chat?conversation=' + encodeURIComponent(data.conversationId);
  if (data.streamId) return origin + '/live/' + encodeURIComponent(data.streamId);
  if (data.postId) {
    var url = origin + '/home?post=' + encodeURIComponent(data.postId);
    if (data.commentId) url += '&comment=' + encodeURIComponent(data.commentId);
    return url;
  }
  if (data.followerUsername) return origin + '/profile/' + encodeURIComponent(data.followerUsername);
  if (data.transactionId) return origin + '/balance/transactions';
  return origin + '/notifications';
}

function buildCallIntentUrl(data, action) {
  var origin = appOrigin();
  var qs = 'vantaCall=' + encodeURIComponent(action) +
    '&callId=' + encodeURIComponent(String(data.callId || '')) +
    '&conversation=' + encodeURIComponent(String(data.conversationId || '')) +
    '&caller=' + encodeURIComponent(String(data.callerId || '')) +
    '&type=' + (data.callType === 'video' ? 'video' : 'voice');
  if (data.callerName) qs += '&name=' + encodeURIComponent(String(data.callerName).slice(0, 80));
  return origin + '/chat?' + qs;
}
/* ------------------------------------------------------------------------- */
/* notification rendering                                                    */
/* ------------------------------------------------------------------------- */

function buildOptions(data) {
  var options = {
    body: data.body || '',
    icon: data.icon || VANTA_ICON,
    badge: data.badge || VANTA_ICON,
    data: data.data || {},
    tag: data.tag || undefined,
    renotify: Boolean(data.renotify),
    requireInteraction: Boolean(data.requireInteraction),
  };
  if (data.vibrate) options.vibrate = data.vibrate;
  if (data.sound) options.sound = data.sound;

  if (data.type === 'incoming_call') {
    options.tag = data.tag || 'vanta-call-' + String((data.data && data.data.callId) || data.eventId);
    options.renotify = true;
    options.requireInteraction = true;
    options.sound = data.sound || VANTA_RINGTONE;
    options.actions = [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' },
    ];
  }
  return options;
}

function handlePush(payload) {
  if (!payload || !payload.eventId) return;
  var type = String(payload.type || '');

  // State-change pushes only dismiss the matching call notification + ping the app.
  if (CALL_RESOLUTIONS.has(type)) {
    var callId = payload.data && payload.data.callId;
    void dismissCallNotification(String(callId || ''));
    void sendToClients({ type: 'vanta-call-resolved', callId: callId, resolution: type });
    return;
  }

  void (async function () {
    if (type === 'incoming_call') {
      var ringCallId = payload.data && payload.data.callId;
      // The page already surfaced this exact call via socket while focused.
      if (handledCalls.has(String(ringCallId))) return;
      var focused = await hasFocusedApp();
      if (focused) {
        // Foreground: the in-app UI owns the ring. Tell the page a push arrived
        // (it may live on another tab of this window).
        if (ringCallId) handledCalls.add(String(ringCallId));
        await sendToClients({ type: 'vanta-call-ingress', callId: ringCallId, payload: payload });
        // Still notify when this window is not the ACTIVE tab.
        if (await hasFocusedApp()) return;
      }
    } else if (await hasFocusedApp()) {
      // Ordinary notifications are already shown by the realtime UI.
      return;
    }

    if (!self.registration || !self.registration.showNotification) return;
    try {
      await self.registration.showNotification(payload.title || 'VANTA', buildOptions(payload));
    } catch (err) {
      // Some platforms reject a duplicate tag mid-flight — retry once without it.
      try {
        var opts = buildOptions(payload);
        opts.tag = undefined;
        await self.registration.showNotification(payload.title || 'VANTA', opts);
      } catch (err2) {
        /* ignore */
      }
    }
  })();
}

self.addEventListener('push', function (event) {
  if (!event.data || !event.waitUntil) return;
  event.waitUntil(
    Promise.resolve(event.data.text && event.data.text())
      .then(function (raw) {
        if (!raw) return;
        var payload;
        try {
          payload = JSON.parse(raw);
        } catch (err) {
          try { payload = event.data.json(); } catch (err2) { return; }
        }
        handlePush(payload);
      })
      .catch(function () {})
  );
});

self.addEventListener('notificationclick', function (event) {
  if (!event || !event.notification) return;
  var data = event.notification.data || {};
  var action = event.action || data.action;
  event.notification.close();

  if (action === 'answer') {
    event.waitUntil(self.clients.openWindow(buildCallIntentUrl(data, 'answer')).catch(function () {}));
    return;
  }
  if (action === 'decline') {
    // Decline is authenticated on the app side (the SW holds no credentials).
    event.waitUntil(self.clients.openWindow(buildCallIntentUrl(data, 'decline')).catch(function () {}));
    return;
  }
  void self.clients.openWindow(buildTargetUrl(data)).catch(function () {});
});

/* Let the page know the browser rotated or dropped the subscription. */
self.addEventListener('pushsubscriptionchange', function (event) {
  function snapshot(sub) {
    if (!sub) return null;
    return { endpoint: sub.endpoint, expirationTime: sub.expirationTime, keys: { p256dh: sub.keys && sub.keys.p256dh, auth: sub.keys && sub.keys.auth } };
  }
  event.waitUntil(
    sendToClients({
      type: 'vanta-push-subscription-changed',
      oldSubscription: snapshot(event.oldSubscription),
      newSubscription: snapshot(event.newSubscription),
    })
  );
});