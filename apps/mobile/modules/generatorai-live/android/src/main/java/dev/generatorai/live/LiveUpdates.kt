// ────────────────────────────────────────────────────────────────
// Live Update (mobile MX-02, 06 §7.3, MD-187) — the Android half of the live surface.
//
// UNCOMPILED: written without the Android SDK on the authoring machine. Review the first
// `expo prebuild && expo run:android` carefully.
//
// One ongoing notification per followed item, built with NotificationCompat (androidx.core 1.17):
//   • ProgressStyle — one segment per stage in its status colour, a tracker icon (the current status glyph) at the
//     current stage; API 36+ draws it natively, older versions get a plain determinate progress bar from the
//     compat library, and an item with no stages an indeterminate one.
//   • setRequestPromotedOngoing(true) + setShortCriticalText("Needs you 3/6") — Android 16 promotes it to the
//     status-bar chip when the user allows it (POST_PROMOTED_NOTIFICATIONS; never colorized, which would disqualify
//     it). The content is the lock-screen form already (MD-33), so it is VISIBILITY_PUBLIC.
//   • A chronometer from the start; content intent and "Review" open the item's deep link in the app (an ACTION_VIEW
//     the app's own link routing validates, 06 §3.12) — never an inline approve (MD-31).
// The first ongoing item starts LiveUpdateService in the foreground (specialUse); the others are plain notify()s
// under it. Ending posts the final state as a normal, dismissible notification with a timeout (MD-90), and the
// service stops with the last item. Everything runs on the main thread (the module's functions are MAIN-queued).
// ────────────────────────────────────────────────────────────────

package dev.generatorai.live

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class LiveSegmentRecord : Record {
  @Field val length: Int = 1
  /** ARGB colour from the theme palette (02 §2.6); 0 = the system default. */
  @Field val color: Int = 0
}

/** Mirrors `AndroidLiveUpdate` in src/services/live/liveSurfaceModel.ts. */
class LiveUpdateRecord : Record {
  @Field val key: String = ""
  @Field val id: Int = 0
  @Field val title: String = ""
  @Field val text: String = ""
  @Field val subText: String? = null
  @Field val chip: String? = null
  @Field val segments: List<LiveSegmentRecord> = emptyList()
  @Field val progress: Int = 0
  @Field val indeterminate: Boolean = false
  /** needs_you | running | failed | done | cancelled */
  @Field val tracker: String = "running"
  @Field val whenMs: Double = 0.0
  @Field val ongoing: Boolean = true
  @Field val deepLink: String = ""
  @Field val reviewUrl: String? = null
  @Field val reviewLabel: String = "Review"
}

internal object LiveUpdates {
  const val CHANNEL_ID = "live"
  private const val REQUEST_CONTENT = 0
  private const val REQUEST_REVIEW = 1

  /** Ongoing items by key, in arrival order (the first one carries the foreground service). */
  private val ongoing = LinkedHashMap<String, LiveUpdateRecord>()

  /** The notification the foreground service is attached to, while it runs. */
  var foregroundId: Int? = null

  fun activeKeys(): List<String> = ongoing.keys.toList()

  fun first(): LiveUpdateRecord? = ongoing.values.firstOrNull()

  fun canPost(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

  fun ensureChannel(context: Context) {
    val channel = NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
      .setName("Live progress")
      .setDescription("Progress of runs and chats you follow, while they are live")
      .setShowBadge(false)
      .build()
    NotificationManagerCompat.from(context).createNotificationChannel(channel)
  }

  fun trackerIcon(tracker: String): Int = when (tracker) {
    "needs_you" -> R.drawable.generatorai_live_needs_you
    "failed" -> R.drawable.generatorai_live_failed
    "done" -> R.drawable.generatorai_live_done
    "cancelled" -> R.drawable.generatorai_live_cancelled
    else -> R.drawable.generatorai_live_running
  }

  private fun linkIntent(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun build(context: Context, record: LiveUpdateRecord, timeoutMs: Long = 0L): Notification {
    // Request codes per notification, so two items' intents never overwrite each other.
    val base = record.id * 2
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(trackerIcon(record.tracker))
      .setContentTitle(record.title)
      .setContentText(record.text)
      .setStyle(progressStyle(context, record))
      .setContentIntent(linkIntent(context, record.deepLink, base + REQUEST_CONTENT))
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setOngoing(record.ongoing)
      .setAutoCancel(!record.ongoing)
      .setShowWhen(true)
      .setWhen(record.whenMs.toLong())
      .setUsesChronometer(record.ongoing)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    record.subText?.let { builder.setSubText(it) }
    if (record.ongoing) {
      builder.setRequestPromotedOngoing(true)
      record.chip?.let { builder.setShortCriticalText(it) }
    }
    record.reviewUrl?.let { url ->
      builder.addAction(0, record.reviewLabel, linkIntent(context, url, base + REQUEST_REVIEW))
    }
    if (timeoutMs > 0) builder.setTimeoutAfter(timeoutMs)
    return builder.build()
  }

  private fun progressStyle(context: Context, record: LiveUpdateRecord): NotificationCompat.ProgressStyle {
    val style = NotificationCompat.ProgressStyle().setStyledByProgress(false)
    if (record.segments.isEmpty()) {
      return style.setProgressIndeterminate(record.indeterminate)
    }
    style.setProgressSegments(
      record.segments.map { s ->
        val segment = NotificationCompat.ProgressStyle.Segment(maxOf(1, s.length))
        if (s.color != 0) segment.setColor(s.color)
        segment
      },
    )
    style.setProgress(maxOf(0, record.progress))
    style.setProgressTrackerIcon(IconCompat.createWithResource(context, trackerIcon(record.tracker)))
    return style
  }

  /** Start or update one item. Starts the foreground service with the first ongoing item. */
  fun upsert(context: Context, record: LiveUpdateRecord) {
    ensureChannel(context)
    ongoing[record.key] = record
    // Posted in every case: under the running service, as the notification the service is about to take into the
    // foreground (same id, onStartCommand within the 5 s window), or as a plain ongoing notification when Android
    // refused the service (the app is in the background).
    post(context, record.id, build(context, record))
    if (foregroundId == null) LiveUpdateService.start(context)
  }

  /** End one item: its final state (dismissible, removed after `timeoutMs`) or nothing. */
  fun end(context: Context, key: String, finalState: LiveUpdateRecord?, timeoutMs: Long) {
    val removed = ongoing.remove(key)
    val manager = NotificationManagerCompat.from(context)
    if (removed != null) {
      if (removed.id == foregroundId) LiveUpdateService.moveForeground(context, first()) else manager.cancel(removed.id)
    }
    if (finalState != null && timeoutMs > 0) post(context, finalState.id, build(context, finalState, timeoutMs))
  }

  fun endAll(context: Context) {
    val ids = ongoing.values.map { it.id }
    ongoing.clear()
    LiveUpdateService.moveForeground(context, null)
    val manager = NotificationManagerCompat.from(context)
    for (id in ids) manager.cancel(id)
  }

  private fun post(context: Context, id: Int, notification: Notification) {
    if (!canPost(context)) return
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
      // Permission revoked between the check and the post.
    }
  }
}
