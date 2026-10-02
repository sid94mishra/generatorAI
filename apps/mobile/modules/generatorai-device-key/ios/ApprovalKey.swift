// ────────────────────────────────────────────────────────────────
// Approval key (mobile MG-05 / MD-31, M6-03): a second Secure Enclave P-256
// key per server (`gai.approval.<serverId>`) that signs RISKY approvals.
//
// UNCOMPILED: written without Xcode. Review on the next `expo run:ios`.
//
// Unlike the DPoP key (GeneratorAIDeviceKeyModule.swift), this key is bound
// to user presence, so every use shows the system prompt:
//
//   • biometry enrolled → [.privateKeyUsage, .biometryCurrentSet, .or, .devicePasscode]
//     (Face ID / Touch ID with the passcode fallback MD-31 allows; presence "biometry")
//   • passcode only     → [.privateKeyUsage, .devicePasscode]                (presence "passcode")
//   • neither           → rejected: the device cannot approve risky gates
//
// Accessibility is `WhenPasscodeSetThisDeviceOnly`: removing the passcode
// deletes the key. A passcode is therefore REQUIRED (MD-155): biometry
// without a passcode (only possible on the Simulator; iOS will not enrol
// Face ID / Touch ID without one) reads as "unsupported", never as a key
// with a weaker accessibility class. A marker in UserDefaults remembers that
// a key was made for the alias, so a key that vanished reads as
// "invalidated" (re-register) rather than "missing" (never registered).
//
// Signing passes an LAContext (`localizedReason`, `localizedCancelTitle`)
// through `kSecUseAuthenticationContext`; `SecKeyCreateSignature` shows the
// prompt. The context is kept alive (`withExtendedLifetime`) until the
// signature returns and is registered as the in-flight prompt, so JS can
// cancel it (`cancelApprovalPrompt`, used by the 60 s client timeout):
// `invalidate()` makes the pending `SecKeyCreateSignature` fail as
// cancelled. The DER signature becomes raw r‖s (64 bytes) through the
// module's `derToRaw`, exactly as for DPoP proofs.
// ────────────────────────────────────────────────────────────────

import CryptoKit
import ExpoModulesCore
import Foundation
import LocalAuthentication
import Security

internal final class ApprovalKeyUnsupportedException: Exception {
  override var reason: String {
    "Approving risky actions needs Face ID, Touch ID or a passcode on this device"
  }
}

internal final class ApprovalKeyMissingException: GenericException<String> {
  override var reason: String {
    "No approval key exists under alias \"\(param)\""
  }
}

internal final class ApprovalKeyInvalidatedException: GenericException<String> {
  override var reason: String {
    "The approval key \"\(param)\" is no longer usable; register it again"
  }
}

internal final class ApprovalKeyCancelledException: Exception {
  override var reason: String {
    "The approval was cancelled"
  }
}

internal final class ApprovalKeyFailedException: GenericException<String> {
  override var reason: String {
    "Approval signing failed: \(param)"
  }
}

/// `signWithPrompt`'s prompt texts from JS (src/services/native/approvalKey.ts).
internal struct ApprovalPromptRecord: Record {
  @Field var title: String = ""
  @Field var subtitle: String? = nil
  @Field var cancel: String = "Cancel"
}

internal enum ApprovalKey {
  private static let markerPrefix = "gai.approval.marker."
  private static let passcodeProbeService = "gai.approval.passcode-probe"

  /// The context of the prompt being shown, so `cancelPrompt()` can end it.
  private static var inFlight: LAContext?
  private static let inFlightLock = NSLock()

  private static func setInFlight(_ context: LAContext?) {
    inFlightLock.lock()
    inFlight = context
    inFlightLock.unlock()
  }

  /// Ends the prompt in flight (if any): its `SecKeyCreateSignature` fails and `sign` throws cancelled.
  static func cancelPrompt() {
    inFlightLock.lock()
    let context = inFlight
    inFlight = nil
    inFlightLock.unlock()
    context?.invalidate()
  }

  /// Whether a device passcode is set: an item with `WhenPasscodeSetThisDeviceOnly` can only be added then.
  /// (`.deviceOwnerAuthentication` cannot tell, because enrolled biometry alone satisfies it on the Simulator.)
  static func passcodeSet() -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: passcodeProbeService,
      kSecAttrAccount as String: "probe",
    ]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = Data([1])
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
    SecItemDelete(query as CFDictionary)
    return status == errSecSuccess
  }

  private static func tag(_ alias: String) -> Data {
    return Data(alias.utf8)
  }

  private static func baseQuery(alias: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassKey,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrApplicationTag as String: tag(alias),
    ]
  }

  /// "biometry" when Face ID / Touch ID is enrolled (a temporary lockout still counts), "passcode" when only a
  /// passcode is set, nil without a passcode (MD-155: the key's accessibility class needs one).
  static func presence() -> String? {
    guard passcodeSet() else { return nil }
    let context = LAContext()
    var error: NSError?
    if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
      return "biometry"
    }
    if let code = error?.code, code == LAError.biometryLockout.rawValue {
      return "biometry"
    }
    var passcodeError: NSError?
    if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &passcodeError) {
      return "passcode"
    }
    return nil
  }

  static func generate(alias: String) throws -> [String: Any] {
    guard SecureEnclave.isAvailable, let presence = presence() else {
      throw ApprovalKeyUnsupportedException()
    }
    let flags: SecAccessControlCreateFlags =
      presence == "biometry"
      ? [.privateKeyUsage, .biometryCurrentSet, .or, .devicePasscode]
      : [.privateKeyUsage, .devicePasscode]
    var error: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        flags,
        &error
      )
    else {
      throw ApprovalKeyFailedException(describe(error))
    }

    // Replace, never accumulate (a second key under one tag makes the lookup ambiguous).
    remove(alias: alias)

    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(alias),
        kSecAttrAccessControl as String: access,
      ] as [String: Any],
    ]
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw ApprovalKeyFailedException(describe(error))
    }
    UserDefaults.standard.set(true, forKey: markerPrefix + alias)

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw ApprovalKeyFailedException("could not derive the public key")
    }
    guard let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw ApprovalKeyFailedException(describe(error))
    }
    // Uncompressed SEC1 point: 0x04 || X (32) || Y (32).
    guard point.count == 65, point[point.startIndex] == 0x04 else {
      throw ApprovalKeyFailedException("unexpected public key encoding (\(point.count) bytes)")
    }
    let x = point.subdata(in: (point.startIndex + 1)..<(point.startIndex + 33))
    let y = point.subdata(in: (point.startIndex + 33)..<(point.startIndex + 65))
    return [
      "publicJwk": ["kty": "EC", "crv": "P-256", "x": base64url(x), "y": base64url(y)],
      "backing": "secure-enclave",
      "presence": presence,
    ]
  }

  /// Looks the key up without ever prompting (`interactionNotAllowed`); a reference needs no authentication.
  private static func find(alias: String, context: LAContext) -> SecKey? {
    var query = baseQuery(alias: alias)
    query[kSecReturnRef as String] = true
    query[kSecUseAuthenticationContext as String] = context
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let item = item else { return nil }
    return (item as! SecKey)  // swiftlint:disable:this force_cast
  }

  static func status(alias: String) -> String {
    guard SecureEnclave.isAvailable, presence() != nil else { return "unsupported" }
    let context = LAContext()
    context.interactionNotAllowed = true
    if find(alias: alias, context: context) != nil { return "ok" }
    return UserDefaults.standard.bool(forKey: markerPrefix + alias) ? "invalidated" : "missing"
  }

  /// ECDSA-SHA256 over `message` after the system prompt; raw r‖s.
  static func sign(alias: String, message: Data, prompt: ApprovalPromptRecord) throws -> Data {
    let context = LAContext()
    context.localizedReason = prompt.subtitle.map { "\(prompt.title)\n\($0)" } ?? prompt.title
    context.localizedCancelTitle = prompt.cancel
    // The key reference is bound to `context` (kSecUseAuthenticationContext); ARC may release a local after its
    // last use, so the context is held for the whole signature, and published as the prompt in flight.
    return try withExtendedLifetime(context) { () throws -> Data in
      guard let privateKey = find(alias: alias, context: context) else {
        if UserDefaults.standard.bool(forKey: markerPrefix + alias) {
          throw ApprovalKeyInvalidatedException(alias)
        }
        throw ApprovalKeyMissingException(alias)
      }
      setInFlight(context)
      defer { setInFlight(nil) }
      var error: Unmanaged<CFError>?
      guard
        let der = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, message as CFData, &error) as Data?
      else {
        throw signingError(error?.takeRetainedValue(), alias: alias)
      }
      return try GeneratorAIDeviceKeyModule.derToRaw(der)
    }
  }

  /// Maps a Security / LocalAuthentication failure onto the module's coded exceptions (every one reaches JS).
  private static func signingError(_ cfError: CFError?, alias: String) -> Exception {
    guard let cfError = cfError else { return ApprovalKeyFailedException("unknown Security.framework error") }
    let code = CFErrorGetCode(cfError)
    let cancelled: [Int] = [
      Int(errSecUserCanceled), LAError.userCancel.rawValue, LAError.appCancel.rawValue, LAError.systemCancel.rawValue,
      LAError.invalidContext.rawValue, LAError.userFallback.rawValue,
    ]
    if cancelled.contains(code) { return ApprovalKeyCancelledException() }
    let unsupported: [Int] = [LAError.passcodeNotSet.rawValue, LAError.biometryNotAvailable.rawValue]
    if unsupported.contains(code) { return ApprovalKeyUnsupportedException() }
    if code == Int(errSecItemNotFound) { return ApprovalKeyInvalidatedException(alias) }
    return ApprovalKeyFailedException(CFErrorCopyDescription(cfError) as String? ?? "code \(code)")
  }

  static func remove(alias: String) {
    SecItemDelete(baseQuery(alias: alias) as CFDictionary)
    UserDefaults.standard.removeObject(forKey: markerPrefix + alias)
  }

  private static func base64url(_ data: Data) -> String {
    return data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func describe(_ error: Unmanaged<CFError>?) -> String {
    guard let error = error?.takeRetainedValue() else { return "unknown Security.framework error" }
    return CFErrorCopyDescription(error) as String? ?? "unknown Security.framework error"
  }
}
