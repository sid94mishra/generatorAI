// ────────────────────────────────────────────────────────────────
// LiveUpdateService — the `specialUse` foreground service behind the Live Update (06 §7.3, MD-32, MD-187).
//
// UNCOMPILED: written without the Android SDK on the authoring machine.
//
// While it runs, Android keeps the process — and so the JS stream that updates the notification — alive with the
// app in the background. It is started only from the foreground (Android 12+ refuses background FGS starts; the
// caller falls back to a plain notification), carries the first ongoing item's notification, moves to the next
// item when that one ends, and stops with the last. `stopWithTask` (manifest) ends it when the app is swiped away.
// ────────────────────────────────────────────────────────────────

package dev.generatorai.live

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

class LiveUpdateService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    current = WeakReference(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val first = LiveUpdates.first()
    if (first == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!enterForeground(first)) stopSelf()
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    LiveUpdates.endAll(this)
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    LiveUpdates.foregroundId = null
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun enterForeground(record: LiveUpdateRecord): Boolean {
    LiveUpdates.ensureChannel(this)
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    return try {
      ServiceCompat.startForeground(this, record.id, LiveUpdates.build(this, record), type)
      LiveUpdates.foregroundId = record.id
      true
    } catch (_: Exception) {
      // ForegroundServiceStartNotAllowedException (background) or a missing permission: plain notifications only.
      LiveUpdates.foregroundId = null
      false
    }
  }

  private fun leaveForeground() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    LiveUpdates.foregroundId = null
    stopSelf()
  }

  companion object {
    private var current: WeakReference<LiveUpdateService>? = null

    /** Start the service (from the foreground only); the posted notification stays plain when Android refuses. */
    fun start(context: Context) {
      if (current?.get() != null) return
      try {
        ContextCompat.startForegroundService(context, Intent(context, LiveUpdateService::class.java))
      } catch (_: Exception) {
        // ForegroundServiceStartNotAllowedException: the app is in the background.
      }
    }

    /**
     * The item carrying the service ended: carry the next one (its notification takes over under the service), or
     * stop when none is left. Removing the old foreground notification is part of both.
     */
    fun moveForeground(context: Context, next: LiveUpdateRecord?) {
      val service = current?.get()
      val previous = LiveUpdates.foregroundId
      if (service == null) {
        previous?.let { NotificationManagerCompat.from(context).cancel(it) }
        LiveUpdates.foregroundId = null
        return
      }
      if (next == null) {
        service.leaveForeground()
        return
      }
      if (!service.enterForeground(next)) {
        service.leaveForeground()
        return
      }
      if (previous != null && previous != next.id) NotificationManagerCompat.from(context).cancel(previous)
    }
  }
}
