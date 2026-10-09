// ────────────────────────────────────────────────────────────────
// TrustAnchors — per-server TLS trust anchors for every OkHttp client React
// Native and Expo create (MV-44, MD-199).
//
// A GeneratorAI server on the LAN serves a leaf issued by its own per-install
// CA (D-110); the pairing QR carries that CA's SHA-256 (D-112). Anchors are
// runtime data, so Network Security Config (<pin-set>, <trust-anchors>), which
// is fixed at build time, cannot express them.
//
// Anchors are keyed by `host:port`. For a pinned host:port the presented chain
// must contain a certificate whose SHA-256 is one of the pins, and the chain
// must validate (PKIX: signatures, validity, name constraints) with that
// certificate as the ONLY trust anchor. OkHttp then checks the host name
// against the leaf as usual. A refusal is recorded so JS can say "this
// server's identity changed". Hosts without anchors keep the system trust.
//
// Coverage: one OkHttpClientFactory (installed from Application.onCreate,
// before any React host exists) backs React Native's NetworkingModule (fetch,
// XHR), its WebSocketModule (`getOkHttpClient().newBuilder()`), Fresco images
// and expo/fetch (`OkHttpClientProvider.createClient`).
// ────────────────────────────────────────────────────────────────

package dev.generatorai.trust

import android.content.Context
import android.util.Base64
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

object TrustAnchors {
  /** host:port → serverId → pins (base64url SHA-256). A host:port accepts the union of its servers' pins. */
  private val anchors = ConcurrentHashMap<String, Map<String, Set<String>>>()
  private val failures = ConcurrentHashMap<String, Long>()

  fun key(host: String, port: Int): String =
    "${host.lowercase().removePrefix("[").removeSuffix("]").removeSuffix(".")}:$port"

  @Synchronized
  fun set(serverId: String, hostPorts: List<String>, fingerprints: List<String>) {
    for (key in anchors.keys.toList()) {
      val rest = anchors[key].orEmpty() - serverId
      if (rest.isEmpty()) anchors.remove(key) else anchors[key] = rest
    }
    if (fingerprints.isEmpty()) return
    val pins = fingerprints.toSet()
    for (hostPort in hostPorts) {
      val key = hostPort.lowercase()
      anchors[key] = anchors[key].orEmpty() + (serverId to pins)
      failures.remove(key)
    }
  }

  fun pins(host: String?, port: Int): Set<String>? =
    host?.let { anchors[key(it, port)] }?.values?.flatten()?.toSet()

  fun lastFailure(host: String, port: Int): Double = failures[key(host, port)]?.toDouble() ?: 0.0

  private fun recordFailure(host: String, port: Int) {
    failures[key(host, port)] = System.currentTimeMillis()
  }

  fun fingerprint(certificate: X509Certificate): String =
    Base64.encodeToString(
      MessageDigest.getInstance("SHA-256").digest(certificate.encoded),
      Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
    )

  fun isSelfSigned(certificate: X509Certificate): Boolean =
    certificate.subjectX500Principal == certificate.issuerX500Principal

  /** The chain must validate with the pinned CA as its only anchor; being in the chain proves nothing. */
  fun verify(chain: Array<X509Certificate>, authType: String, host: String?, port: Int, fallback: () -> Unit) {
    val pins = pins(host, port)
    if (pins == null || host == null) {
      fallback()
      return
    }
    try {
      val anchor = chain.firstOrNull { fingerprint(it) in pins }
        ?: throw CertificateException("The server's certificate is not issued by the CA this device paired with")
      val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
        load(null, null)
        setCertificateEntry("generatorai-anchor", anchor)
      }
      val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
      factory.trustManagers.filterIsInstance<X509TrustManager>().first().checkServerTrusted(chain, authType)
    } catch (error: CertificateException) {
      recordFailure(host, port)
      throw error
    }
  }

  val systemTrustManager: X509TrustManager by lazy {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  val trustManager: X509TrustManager by lazy { PinningTrustManager(systemTrustManager) }

  val socketFactory: SSLSocketFactory by lazy {
    SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }.socketFactory
  }

  fun install(context: Context) {
    val appContext = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory(
      OkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder(appContext).sslSocketFactory(socketFactory, trustManager).build()
      },
    )
    // A client built before this point (none is expected) would bypass the factory.
    try {
      val cached = OkHttpClientProvider::class.java.getDeclaredField("client")
      cached.isAccessible = true
      if (cached.get(null) != null) {
        cached.set(null, null)
        Log.w("GeneratorAITrust", "Dropped an OkHttp client created before the trust anchors were installed")
      }
    } catch (_: Throwable) {
      // The field moved: the factory still covers every client created from now on.
    }
  }
}

/** Pinned hosts: the pinned CA only. Everything else: the system's trust, with its host-aware checks. */
private class PinningTrustManager(private val system: X509TrustManager) : X509ExtendedTrustManager() {
  private val extended = system as? X509ExtendedTrustManager

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) {
    val session = (socket as? SSLSocket)?.handshakeSession
    TrustAnchors.verify(chain, authType, session?.peerHost, session?.peerPort ?: -1) {
      if (extended != null) extended.checkServerTrusted(chain, authType, socket) else system.checkServerTrusted(chain, authType)
    }
  }

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) {
    val session = engine?.handshakeSession
    TrustAnchors.verify(chain, authType, session?.peerHost ?: engine?.peerHost, session?.peerPort ?: engine?.peerPort ?: -1) {
      if (extended != null) extended.checkServerTrusted(chain, authType, engine) else system.checkServerTrusted(chain, authType)
    }
  }

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    system.checkServerTrusted(chain, authType)
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) {
    if (extended != null) extended.checkClientTrusted(chain, authType, socket) else system.checkClientTrusted(chain, authType)
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) {
    if (extended != null) extended.checkClientTrusted(chain, authType, engine) else system.checkClientTrusted(chain, authType)
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
    system.checkClientTrusted(chain, authType)
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
}
