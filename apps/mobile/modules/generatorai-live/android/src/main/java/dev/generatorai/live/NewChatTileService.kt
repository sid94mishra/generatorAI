// ────────────────────────────────────────────────────────────────
// NewChatTileService — the Quick Settings tile "New chat" (mobile 06 §7.5, MX-06, MD-189).
//
// UNCOMPILED: written without the Android SDK on the authoring machine.
//
// Tap → opens `generatorai://command/chat.new` in the app (the shared launcher link, routed like any deep link);
// on a locked device the system asks to unlock first. Label "New chat"; subtitle "N need you" (the last count the
// app wrote, never sample data), or "Not paired" with the tile unavailable. "Pause agents" is not built (MD-06).
// ────────────────────────────────────────────────────────────────

package dev.generatorai.live

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

internal const val TILE_PAIRED = "tile.paired"
internal const val TILE_SUBTITLE = "tile.subtitle"
private const val NEW_CHAT_LINK = "generatorai://command/chat.new"

class NewChatTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    val prefs = getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
    val paired = prefs.getBoolean(TILE_PAIRED, false)
    tile.label = "New chat"
    tile.state = if (paired) Tile.STATE_INACTIVE else Tile.STATE_UNAVAILABLE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = if (paired) prefs.getString(TILE_SUBTITLE, null) else "Not paired"
    }
    tile.updateTile()
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { openNewChat() } else openNewChat()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun openNewChat() {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(NEW_CHAT_LINK))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startActivityAndCollapse(
        PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }

  companion object {
    /** Store the tile's state and ask the system to re-read it if the tile is showing. */
    fun update(context: Context, paired: Boolean, subtitle: String?) {
      context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(TILE_PAIRED, paired)
        .putString(TILE_SUBTITLE, subtitle)
        .apply()
      try {
        requestListeningState(context, ComponentName(context, NewChatTileService::class.java))
      } catch (_: Exception) {
        // The tile is not added: nothing to refresh.
      }
    }
  }
}
