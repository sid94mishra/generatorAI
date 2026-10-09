// ────────────────────────────────────────────────────────────────
// GAITrust — per-server TLS trust anchors for every network stack the app
// uses (MV-44, MD-199).
//
// A GeneratorAI server on the LAN serves a leaf issued by its own per-install
// CA (D-110). The pairing QR carries that CA's SHA-256 (D-112), so the app
// knows the one certificate authority that may vouch for that server. The
// anchors are runtime data (they arrive in a QR), which rules out the
// build-time mechanisms (NSPinnedDomains can only tighten system trust).
//
// Anchors are keyed by `host:port` (lower-case host, no IPv6 brackets). For a
// pinned host:port a server trust is accepted only when its chain contains a
// certificate whose SHA-256 is one of the pins AND the chain evaluates with
// that certificate as the ONLY anchor (signature, validity, name constraints,
// and the SSL host name). Anything else is refused and recorded, so JS can
// say "this server's identity changed" instead of "can't reach".
// Hosts without anchors keep the system's default evaluation.
//
// Hooks (installed from +load, before any session or socket exists):
//   RCTHTTPRequestHandler           React Native fetch / XHR / Image
//   URLSessionSessionDelegateProxy  expo/fetch (the streaming transport)
//   SRWebSocket                     React Native WebSocket (SocketRocket)
// ────────────────────────────────────────────────────────────────

#import <Foundation/Foundation.h>
#import <Security/Security.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, GAITrustDecision) {
  /** No anchors for this host:port: let the stack do its default evaluation. */
  GAITrustDecisionNotPinned = 0,
  GAITrustDecisionAccept = 1,
  GAITrustDecisionReject = 2,
};

@interface GAITrust : NSObject

/** Replaces every anchor registered for `serverId`. `fingerprints` are base64url SHA-256 of the CA's DER. */
+ (void)setAnchorsForServer:(NSString *)serverId hostPorts:(NSArray<NSString *> *)hostPorts fingerprints:(NSArray<NSString *> *)fingerprints NS_SWIFT_NAME(setAnchors(server:hostPorts:fingerprints:));
+ (void)clearAnchorsForServer:(NSString *)serverId NS_SWIFT_NAME(clearAnchors(server:));
+ (BOOL)hasAnchorsForHost:(NSString *)host port:(NSInteger)port NS_SWIFT_NAME(hasAnchors(host:port:));
+ (GAITrustDecision)evaluateTrust:(SecTrustRef)trust host:(NSString *)host port:(NSInteger)port NS_SWIFT_NAME(evaluate(_:host:port:));
/** Milliseconds since 1970 of the last refused handshake for host:port, or 0. */
+ (double)lastFailureForHost:(NSString *)host port:(NSInteger)port NS_SWIFT_NAME(lastFailure(host:port:));
/** base64url SHA-256 of a certificate's DER. */
+ (NSString *)fingerprintOf:(SecCertificateRef)certificate NS_SWIFT_NAME(fingerprint(of:));
+ (BOOL)isSelfSigned:(SecCertificateRef)certificate NS_SWIFT_NAME(isSelfSigned(_:));
/** Installs the URLSession and SocketRocket hooks (idempotent). */
+ (void)installHooks;

@end

NS_ASSUME_NONNULL_END
