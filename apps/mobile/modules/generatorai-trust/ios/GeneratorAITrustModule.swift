// ────────────────────────────────────────────────────────────────
// GeneratorAITrust — the JS surface of GAITrust (MV-44, MD-199).
//
//   setAnchors / clearAnchors   which CA may vouch for which host:port
//   lastFailure                 when a pinned handshake was last refused
//   inspect                     the chain a server presents, without sending
//                               a byte of HTTP (typed-code pairing, MD-200)
//   localNetwork                whether iOS Local Network privacy blocks a host
//
// JS facade: apps/mobile/src/services/native/trustModule.ts.
// ────────────────────────────────────────────────────────────────

import ExpoModulesCore
import Foundation
import Network
import Security

internal final class TrustInspectException: GenericException<String> {
  override var reason: String {
    "Could not read the certificate of \(param)"
  }
}

/** The certificates of a `SecTrust`, leaf first (by index: an `as? [SecCertificate]` bridge of a CF array is nil). */
private func certificates(of trust: SecTrust) -> [SecCertificate] {
  guard let chain = SecTrustCopyCertificateChain(trust) else { return [] }
  return (0..<CFArrayGetCount(chain)).map { unsafeBitCast(CFArrayGetValueAtIndex(chain, $0), to: SecCertificate.self) }
}

private final class Once {
  private var done = false
  private let lock = NSLock()
  func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if done { return false }
    done = true
    return true
  }
}

public final class GeneratorAITrustModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GeneratorAITrust")

    OnCreate {
      // +load already installed them; this covers a Swift delegate class the
      // runtime had not realised yet at load time. Idempotent per class.
      GAITrust.installHooks()
    }

    Function("setAnchors") { (serverId: String, hostPorts: [String], fingerprints: [String]) in
      GAITrust.setAnchors(server: serverId, hostPorts: hostPorts, fingerprints: fingerprints)
    }

    Function("clearAnchors") { (serverId: String) in
      GAITrust.clearAnchors(server: serverId)
    }

    Function("lastFailure") { (host: String, port: Int) -> Double in
      GAITrust.lastFailure(host: host, port: port)
    }

    AsyncFunction("inspect") { (host: String, port: Int, promise: Promise) in
      // A bare TLS handshake (Network.framework) whose verify block records the chain and refuses it: no HTTP is sent.
      guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
        promise.reject(TrustInspectException("\(host):\(port)"))
        return
      }
      let queue = DispatchQueue(label: "dev.generatorai.trust.inspect")
      var chain: [SecCertificate] = []
      let tls = NWProtocolTLS.Options()
      if IPv4Address(host) == nil && IPv6Address(host) == nil {
        sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, host)
      }
      sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, secTrust, complete in
        chain = certificates(of: sec_trust_copy_ref(secTrust).takeRetainedValue())
        complete(false)
      }, queue)
      let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: NWParameters(tls: tls, tcp: NWProtocolTCP.Options()))
      let once = Once()
      var lastError = "timed out"
      let finish: () -> Void = {
        guard once.claim() else { return }
        connection.cancel()
        guard let leaf = chain.first, let last = chain.last else {
          promise.reject(TrustInspectException("\(host):\(port) (\(lastError))"))
          return
        }
        promise.resolve([
          "leaf": GAITrust.fingerprint(of: leaf),
          "root": chain.count > 1 && GAITrust.isSelfSigned(last) ? GAITrust.fingerprint(of: last) : NSNull(),
          "chain": chain.map { GAITrust.fingerprint(of: $0) },
        ] as [String: Any])
      }
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready, .cancelled: finish()
        case .failed(let error):
          lastError = "\(error)"
          finish()
        case .waiting(let error):
          lastError = "\(error)"
          if !chain.isEmpty { finish() }
        default: break
        }
      }
      connection.start(queue: queue)
      queue.asyncAfter(deadline: .now() + 6) { finish() }
    }

    AsyncFunction("localNetwork") { (host: String, port: Int, promise: Promise) in
      guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
        promise.resolve("unknown")
        return
      }
      let queue = DispatchQueue(label: "dev.generatorai.trust.local-network")
      let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
      let once = Once()
      let finish: (String) -> Void = { value in
        guard once.claim() else { return }
        connection.cancel()
        promise.resolve(value)
      }
      let denied: () -> Bool = { connection.currentPath?.unsatisfiedReason == .localNetworkDenied }
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready: finish("allowed")
        case .waiting: if denied() { finish("denied") }
        case .failed: finish(denied() ? "denied" : "unknown")
        default: break
        }
      }
      connection.start(queue: queue)
      queue.asyncAfter(deadline: .now() + 4) { finish(denied() ? "denied" : "unknown") }
    }
  }
}
