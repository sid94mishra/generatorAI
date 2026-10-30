// GAITrust — see GAITrust.h for what this guarantees and why.

#import "GAITrust.h"

#import <CommonCrypto/CommonDigest.h>
#import <objc/runtime.h>
#import <os/lock.h>

typedef void (^GAIChallengeCompletion)(NSURLSessionAuthChallengeDisposition, NSURLCredential *_Nullable);

static os_unfair_lock gLock = OS_UNFAIR_LOCK_INIT;
/** host:port → serverId → pins (base64url SHA-256). A host:port accepts the union of its servers' pins. */
static NSMutableDictionary<NSString *, NSMutableDictionary<NSString *, NSSet<NSString *> *> *> *gAnchors;
/** host:port → ms since 1970 of the last refused handshake */
static NSMutableDictionary<NSString *, NSNumber *> *gFailures;
static const void *kGAIPinnedEndpointKey = &kGAIPinnedEndpointKey;

static NSString *GAIBareHost(NSString *host) {
  NSString *h = host.lowercaseString;
  if (h.length > 2 && [h hasPrefix:@"["] && [h hasSuffix:@"]"]) h = [h substringWithRange:NSMakeRange(1, h.length - 2)];
  if ([h hasSuffix:@"."]) h = [h substringToIndex:h.length - 1];
  return h;
}

static NSString *GAIKey(NSString *host, NSInteger port) {
  return [NSString stringWithFormat:@"%@:%ld", GAIBareHost(host), (long)port];
}

@implementation GAITrust

+ (void)load {
  gAnchors = [NSMutableDictionary new];
  gFailures = [NSMutableDictionary new];
  [self installHooks];
}

#pragma mark - Anchors

+ (void)setAnchorsForServer:(NSString *)serverId hostPorts:(NSArray<NSString *> *)hostPorts fingerprints:(NSArray<NSString *> *)fingerprints {
  NSSet *pins = [NSSet setWithArray:fingerprints];
  os_unfair_lock_lock(&gLock);
  for (NSString *key in gAnchors.allKeys) {
    [gAnchors[key] removeObjectForKey:serverId];
    if (gAnchors[key].count == 0) [gAnchors removeObjectForKey:key];
  }
  if (pins.count > 0) {
    for (NSString *hostPort in hostPorts) {
      NSString *key = hostPort.lowercaseString;
      if (!gAnchors[key]) gAnchors[key] = [NSMutableDictionary new];
      gAnchors[key][serverId] = pins;
      [gFailures removeObjectForKey:key];
    }
  }
  os_unfair_lock_unlock(&gLock);
}

+ (void)clearAnchorsForServer:(NSString *)serverId {
  [self setAnchorsForServer:serverId hostPorts:@[] fingerprints:@[]];
}

+ (nullable NSSet<NSString *> *)pinsForKey:(NSString *)key {
  os_unfair_lock_lock(&gLock);
  NSMutableSet *pins = nil;
  for (NSSet *serverPins in gAnchors[key].allValues) {
    if (!pins) pins = [NSMutableSet new];
    [pins unionSet:serverPins];
  }
  os_unfair_lock_unlock(&gLock);
  return pins;
}

+ (BOOL)hasAnchorsForHost:(NSString *)host port:(NSInteger)port {
  return [self pinsForKey:GAIKey(host, port)] != nil;
}

+ (double)lastFailureForHost:(NSString *)host port:(NSInteger)port {
  os_unfair_lock_lock(&gLock);
  NSNumber *at = gFailures[GAIKey(host, port)];
  os_unfair_lock_unlock(&gLock);
  return at.doubleValue;
}

+ (void)recordFailureForKey:(NSString *)key {
  os_unfair_lock_lock(&gLock);
  gFailures[key] = @(NSDate.date.timeIntervalSince1970 * 1000.0);
  os_unfair_lock_unlock(&gLock);
}

#pragma mark - Certificates

+ (NSString *)fingerprintOf:(SecCertificateRef)certificate {
  NSData *der = CFBridgingRelease(SecCertificateCopyData(certificate));
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(der.bytes, (CC_LONG)der.length, digest);
  NSString *b64 = [[NSData dataWithBytes:digest length:sizeof digest] base64EncodedStringWithOptions:0];
  b64 = [b64 stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
  b64 = [b64 stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  return [b64 stringByReplacingOccurrencesOfString:@"=" withString:@""];
}

+ (BOOL)isSelfSigned:(SecCertificateRef)certificate {
  NSData *subject = CFBridgingRelease(SecCertificateCopyNormalizedSubjectSequence(certificate));
  NSData *issuer = CFBridgingRelease(SecCertificateCopyNormalizedIssuerSequence(certificate));
  return subject != nil && [subject isEqualToData:issuer];
}

+ (GAITrustDecision)evaluateTrust:(SecTrustRef)trust host:(NSString *)host port:(NSInteger)port {
  NSString *key = GAIKey(host, port);
  NSSet<NSString *> *pins = [self pinsForKey:key];
  if (!pins) return GAITrustDecisionNotPinned;

  // The certificates the server presented (our server sends leaf + its CA).
  NSArray *chain = CFBridgingRelease(SecTrustCopyCertificateChain(trust));
  SecCertificateRef anchor = NULL;
  for (id item in chain) {
    SecCertificateRef certificate = (__bridge SecCertificateRef)item;
    if ([pins containsObject:[self fingerprintOf:certificate]]) {
      anchor = certificate;
      break;
    }
  }
  if (!anchor) {
    [self recordFailureForKey:key];
    return GAITrustDecisionReject;
  }

  // Being in the chain proves nothing (anyone can append the real CA); the
  // chain must EVALUATE with that CA as the only anchor, for this host name.
  SecPolicyRef policy = SecPolicyCreateSSL(true, (__bridge CFStringRef)GAIBareHost(host));
  SecTrustSetPolicies(trust, policy);
  CFRelease(policy);
  SecTrustSetAnchorCertificates(trust, (__bridge CFArrayRef) @[ (__bridge id)anchor ]);
  SecTrustSetAnchorCertificatesOnly(trust, true);
  CFErrorRef error = NULL;
  BOOL trusted = SecTrustEvaluateWithError(trust, &error);
  if (error) CFRelease(error);
  if (!trusted) {
    [self recordFailureForKey:key];
    return GAITrustDecisionReject;
  }
  return GAITrustDecisionAccept;
}

#pragma mark - Hooks

/** Handles a server-trust challenge for a pinned host; NO when the default handling applies. */
static BOOL GAIHandleServerTrust(NSURLAuthenticationChallenge *challenge, GAIChallengeCompletion completion) {
  NSURLProtectionSpace *space = challenge.protectionSpace;
  if (![space.authenticationMethod isEqualToString:NSURLAuthenticationMethodServerTrust] || space.serverTrust == NULL) return NO;
  switch ([GAITrust evaluateTrust:space.serverTrust host:space.host port:space.port]) {
    case GAITrustDecisionAccept:
      completion(NSURLSessionAuthChallengeUseCredential, [NSURLCredential credentialForTrust:space.serverTrust]);
      return YES;
    case GAITrustDecisionReject:
      completion(NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
      return YES;
    case GAITrustDecisionNotPinned:
      return NO;
  }
  return NO;
}

/**
 * Gives `cls` (a URLSession delegate) a session-level challenge handler. A
 * session-level handler receives every server-trust challenge, so a delegate
 * that only implements the task-level one (expo/fetch) or none (React Native)
 * is covered either way; an existing session-level handler is chained.
 */
static void GAIHookSessionDelegate(Class cls) {
  if (cls == Nil) return;
  static NSMutableSet<NSString *> *hooked;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ hooked = [NSMutableSet new]; });
  @synchronized(hooked) {
    NSString *name = NSStringFromClass(cls);
    if ([hooked containsObject:name]) return;
    [hooked addObject:name];
  }
  SEL selector = @selector(URLSession:didReceiveChallenge:completionHandler:);
  Method own = NULL;
  unsigned int count = 0;
  Method *methods = class_copyMethodList(cls, &count);
  for (unsigned int i = 0; i < count; i++) {
    if (method_getName(methods[i]) == selector) own = methods[i];
  }
  free(methods);
  Method inherited = own ? NULL : class_getInstanceMethod(cls, selector);
  IMP original = own ? method_getImplementation(own) : inherited ? method_getImplementation(inherited) : NULL;
  IMP replacement = imp_implementationWithBlock(^(id me, NSURLSession *session, NSURLAuthenticationChallenge *challenge, GAIChallengeCompletion completion) {
    if (GAIHandleServerTrust(challenge, completion)) return;
    if (original) {
      ((void (*)(id, SEL, NSURLSession *, NSURLAuthenticationChallenge *, GAIChallengeCompletion))original)(me, selector, session, challenge, completion);
    } else {
      completion(NSURLSessionAuthChallengePerformDefaultHandling, nil);
    }
  });
  if (own) {
    method_setImplementation(own, replacement);
  } else {
    class_addMethod(cls, selector, replacement, "v@:@@@?");
  }
}

/**
 * SocketRocket evaluates the peer trust itself (`SRSecurityPolicy`) after the
 * TLS handshake and before it sends the HTTP upgrade (`didConnect` waits for
 * the evaluation). A socket to a pinned host gets its policy marked in `open`;
 * a marked policy turns off the stream's own chain validation (which would
 * refuse the private CA during the handshake) and evaluates with GAITrust.
 */
static void GAIHookSocketRocket(void) {
  Class socketClass = NSClassFromString(@"SRWebSocket");
  Class policyClass = NSClassFromString(@"SRSecurityPolicy");
  if (socketClass == Nil || policyClass == Nil) return;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    SEL openSelector = NSSelectorFromString(@"open");
    Method open = class_getInstanceMethod(socketClass, openSelector);
    SEL updateSelector = NSSelectorFromString(@"updateSecurityOptionsInStream:");
    Method update = class_getInstanceMethod(policyClass, updateSelector);
    SEL evaluateSelector = NSSelectorFromString(@"evaluateServerTrust:forDomain:");
    Method evaluate = class_getInstanceMethod(policyClass, evaluateSelector);
    if (!open || !update || !evaluate) return;

    IMP originalOpen = method_getImplementation(open);
    method_setImplementation(open, imp_implementationWithBlock(^(id socket) {
      @try {
        NSURL *url = [socket valueForKey:@"url"];
        NSString *scheme = url.scheme.lowercaseString;
        if (url.host && ([scheme isEqualToString:@"wss"] || [scheme isEqualToString:@"https"])) {
          NSInteger port = url.port ? url.port.integerValue : 443;
          id policy = [socket valueForKey:@"securityPolicy"];
          if (policy && [GAITrust hasAnchorsForHost:url.host port:port]) {
            objc_setAssociatedObject(policy, kGAIPinnedEndpointKey, @{ @"host" : url.host, @"port" : @(port) }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
          }
        }
      } @catch (NSException *exception) {
        // A SocketRocket without these keys: leave the socket on its default policy.
      }
      ((void (*)(id, SEL))originalOpen)(socket, openSelector);
    }));

    IMP originalUpdate = method_getImplementation(update);
    method_setImplementation(update, imp_implementationWithBlock(^(id policy, NSStream *stream) {
      if (!objc_getAssociatedObject(policy, kGAIPinnedEndpointKey)) {
        ((void (*)(id, SEL, NSStream *))originalUpdate)(policy, updateSelector, stream);
        return;
      }
      [stream setProperty:(__bridge id)CFSTR("kCFStreamSocketSecurityLevelTLSv1_2") forKey:(__bridge id)kCFStreamPropertySocketSecurityLevel];
      [stream setProperty:@{ (__bridge NSString *)kCFStreamSSLValidatesCertificateChain : @NO } forKey:(__bridge NSString *)kCFStreamPropertySSLSettings];
    }));

    IMP originalEvaluate = method_getImplementation(evaluate);
    method_setImplementation(evaluate, imp_implementationWithBlock(^BOOL(id policy, SecTrustRef trust, NSString *domain) {
      NSDictionary *endpoint = objc_getAssociatedObject(policy, kGAIPinnedEndpointKey);
      if (!endpoint) return ((BOOL (*)(id, SEL, SecTrustRef, NSString *))originalEvaluate)(policy, evaluateSelector, trust, domain);
      return [GAITrust evaluateTrust:trust host:endpoint[@"host"] port:[endpoint[@"port"] integerValue]] == GAITrustDecisionAccept;
    }));
  });
}

+ (void)installHooks {
  GAIHookSessionDelegate(NSClassFromString(@"RCTHTTPRequestHandler"));
  GAIHookSessionDelegate(NSClassFromString(@"ExpoModulesCore.URLSessionSessionDelegateProxy"));
  GAIHookSocketRocket();
}

@end
