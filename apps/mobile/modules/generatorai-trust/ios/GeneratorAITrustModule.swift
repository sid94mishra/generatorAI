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

/** Records the presented chain and cancels: the request itself is never sent. */
private final class ChainCapture: NSObject, URLSessionDelegate {
  var chain: [SecCertificate] = []

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust {
      chain = (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
    }
    completionHandler(.cancelAuthenticationChallenge, nil)
  }
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
      var components = URLComponents()
      components.scheme = "https"
      components.host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
      components.port = port
      components.path = "/"
      guard let url = components.url else {
        promise.reject(TrustInspectException("\(host):\(port)"))
        return
      }
      let capture = ChainCapture()
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = 6
      configuration.timeoutIntervalForResource = 8
      let session = URLSession(configuration: configuration, delegate: capture, delegateQueue: nil)
      session.dataTask(with: url) { _, _, _ in
        session.invalidateAndCancel()
        guard let leaf = capture.chain.first else {
          promise.reject(TrustInspectException("\(host):\(port)"))
          return
        }
        let last = capture.chain.last!
        promise.resolve([
          "leaf": GAITrust.fingerprint(of: leaf),
          "root": capture.chain.count > 1 && GAITrust.isSelfSigned(last) ? GAITrust.fingerprint(of: last) : NSNull(),
          "chain": capture.chain.map { GAITrust.fingerprint(of: $0) },
        ] as [String: Any])
      }.resume()
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
