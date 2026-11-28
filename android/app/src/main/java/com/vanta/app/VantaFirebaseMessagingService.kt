package com.vanta.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class VantaFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_FCM_TOKEN, token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title
            ?: message.data["title"]
            ?: "VANTA"
        val body = message.notification?.body
            ?: message.data["body"]
            ?: "You have a new notification."
        val route = when (message.data["type"]) {
            "chat_request" -> "/chat/requests"
            "delegation_invite" -> "/settings/security/delegation"
            else -> message.data["route"] ?: message.data["url"] ?: "/notifications"
        }

        createNotificationChannel()
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_NOTIFICATION_ROUTE, route)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            (message.messageId ?: System.currentTimeMillis().toString()).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        runCatching {
            NotificationManagerCompat.from(this).notify(
                (message.messageId ?: System.currentTimeMillis().toString()).hashCode(),
                notification
            )
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "VANTA notifications", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }

    companion object {
        const val PREFS = "vanta_native_push"
        const val KEY_FCM_TOKEN = "fcm_token"
        const val EXTRA_NOTIFICATION_ROUTE = "vanta_notification_route"
        const val CHANNEL_ID = "vanta_notifications"
    }
}
