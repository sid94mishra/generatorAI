// ────────────────────────────────────────────────────────────────
// GeneratorAITrust — the JS surface of TrustAnchors (MV-44, MD-199).
//
//   setAnchors / clearAnchors   which CA may vouch for which host:port
//   lastFailure                 when a pinned handshake was last refused
//   inspect                     the chain a server presents, without sending
//                               a byte of HTTP (typed-code pairing, MD-200)
//   localNetwork                Android 17 local-network access (target SDK 37+)
//
// JS facade: apps/mobile/src/services/native/trustModule.ts.
// ────────────────────────────────────────────────────────────────

package dev.generatorai.trust

import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetSocketAddress
import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

private class InspectException(endpoint: String) :
  CodedException("ERR_TRUST_INSPECT", "Could not read the certificate of $endpoint", null)

/** Records the presented chain and refuses it: the handshake fails before any HTTP is written. */
private class ChainCapture : X509TrustManager {
  @Volatile var chain: Array<X509Certificate>? = null

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    this.chain = chain
    throw CertificateException("inspect only")
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
    throw CertificateException("inspect only")
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Android 17 gates LAN access behind ACCESS_LOCAL_NETWORK for apps that target SDK 37 or later. */
private const val ANDROID_17 = 37
private const val ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

class GeneratorAITrustModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GeneratorAITrust")

    Function("setAnchors") { serverId: String, hostPorts: List<String>, fingerprints: List<String> ->
      TrustAnchors.set(serverId, hostPorts, fingerprints)
    }

    Function("clearAnchors") { serverId: String ->
      TrustAnchors.set(serverId, emptyList(), emptyList())
    }

    Function("lastFailure") { host: String, port: Int ->
      TrustAnchors.lastFailure(host, port)
    }

    AsyncFunction("inspect") { host: String, port: Int ->
      val capture = ChainCapture()
      val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(capture), null) }
      try {
        val raw = Socket()
        raw.connect(InetSocketAddress(host, port), 6000)
        raw.soTimeout = 6000
        val socket = context.socketFactory.createSocket(raw, host, port, true) as SSLSocket
        try {
          socket.startHandshake()
        } catch (_: Exception) {
          // Expected: ChainCapture refuses every chain.
        } finally {
          socket.close()
        }
      } catch (_: Exception) {
        throw InspectException("$host:$port")
      }
      val chain = capture.chain ?: throw InspectException("$host:$port")
      val last = chain.last()
      mapOf(
        "leaf" to TrustAnchors.fingerprint(chain.first()),
        "root" to if (chain.size > 1 && TrustAnchors.isSelfSigned(last)) TrustAnchors.fingerprint(last) else null,
        "chain" to chain.map { TrustAnchors.fingerprint(it) },
      )
    }

    AsyncFunction("localNetwork") { _: String, _: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction "unknown"
      if (Build.VERSION.SDK_INT < ANDROID_17 || context.applicationInfo.targetSdkVersion < ANDROID_17) {
        return@AsyncFunction "allowed"
      }
      if (context.checkSelfPermission(ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED) "allowed" else "denied"
    }
  }
}
