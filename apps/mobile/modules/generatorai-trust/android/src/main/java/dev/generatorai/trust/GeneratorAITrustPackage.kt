package dev.generatorai.trust

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Installs the trust anchors' OkHttp factory in Application.onCreate, before any React host or client exists. */
class GeneratorAITrustPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          TrustAnchors.install(application)
        }
      },
    )
}
