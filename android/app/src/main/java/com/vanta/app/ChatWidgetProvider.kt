package com.vanta.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** A deliberately account-neutral launcher shortcut. No messages, tokens or
 * notification previews are fetched or stored by the widget. */
class ChatWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(VantaFirebaseMessagingService.EXTRA_NOTIFICATION_ROUTE, "/chat")
            }
            val open = PendingIntent.getActivity(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val views = RemoteViews(context.packageName, R.layout.vanta_chat_widget)
            views.setOnClickPendingIntent(R.id.vanta_chat_widget_root, open)
            manager.updateAppWidget(id, views)
        }
    }
}
