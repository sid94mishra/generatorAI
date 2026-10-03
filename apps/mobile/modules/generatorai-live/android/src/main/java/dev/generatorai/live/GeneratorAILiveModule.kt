// ────────────────────────────────────────────────────────────────
// GeneratorAILive — Android system surfaces (mobile 06 §7.3 – §7.5, MD-187).
//
// UNCOMPILED: written without the Android SDK on the authoring machine. Review the first
// `expo prebuild && expo run:android` carefully.
//
// JS facade: apps/mobile/src/services/native/live/liveUpdate.ts (Live Update) and
// apps/mobile/src/services/native/widgetPalette.ts (palette). Every function runs on the main thread: the service,
// the notification manager and the registry in LiveUpdates are touched from one thread only.
// ────────────────────────────────────────────────────────────────

package dev.generatorai.live

import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** SharedPreferences shared with the widgets and the tile (02 §2.6). */
internal const val WIDGET_PREFS = "generatorai_widgets"

class GeneratorAILiveModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("GeneratorAILive")

    /** ProgressStyle is native from API 36; below it the notification shows a plain progress bar. */
    Function("isSupported") { Build.VERSION.SDK_INT >= 36 }

    AsyncFunction("canPostPromoted") {
      val ctx = context ?: return@AsyncFunction false
      NotificationManagerCompat.from(ctx).canPostPromotedNotifications()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("activeKeys") {
      LiveUpdates.activeKeys()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("upsert") { update: LiveUpdateRecord ->
      val ctx = context ?: return@AsyncFunction Unit
      LiveUpdates.upsert(ctx, update)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("end") { key: String, finalState: LiveUpdateRecord?, timeoutMs: Double ->
      val ctx = context ?: return@AsyncFunction Unit
      LiveUpdates.end(ctx, key, finalState, timeoutMs.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("endAll") {
      val ctx = context ?: return@AsyncFunction Unit
      LiveUpdates.endAll(ctx)
    }.runOnQueue(Queues.MAIN)

    /** The theme's 14 literal colours as JSON (02 §2.6), for the widgets and the tile. */
    Function("setWidgetPalette") { json: String ->
      context?.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)?.edit()?.putString("palette", json)?.apply()
      Unit
    }
  }
}
