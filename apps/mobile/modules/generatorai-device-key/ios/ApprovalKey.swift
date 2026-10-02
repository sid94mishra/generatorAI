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
// deletes the key. A marker in UserDefaults remembers that a key was made
// for the alias, so a key that vanished reads as "invalidated" (re-register)
// rather than "missing" (never registered).
//
// Signing passes an LAContext (`localizedReason`, `localizedCancelTitle`)
// through `kSecUseAuthenticationContext`; `SecKeyCreateSignature` shows the
// prompt. The DER signature becomes raw r‖s (64 bytes) through the module's
// `derToRaw`, exactly as for DPoP proofs.
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
  /// passcode is set, nil when the device can authenticate neither way.
  static func presence() -> String? {
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
    guard let privateKey = find(alias: alias, context: context) else {
      if UserDefaults.standard.bool(forKey: markerPrefix + alias) {
        throw ApprovalKeyInvalidatedException(alias)
      }
      throw ApprovalKeyMissingException(alias)
    }
    var error: Unmanaged<CFError>?
    guard
      let der = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, message as CFData, &error) as Data?
    else {
      if let cfError = error?.takeRetainedValue() {
        let code = CFErrorGetCode(cfError)
        if code == Int(errSecUserCanceled) || code == LAError.userCancel.rawValue || code == LAError.appCancel.rawValue
          || code == LAError.systemCancel.rawValue
        {
          throw ApprovalKeyCancelledException()
        }
        throw ApprovalKeyFailedException(CFErrorCopyDescription(cfError) as String? ?? "code \(code)")
      }
      throw ApprovalKeyFailedException("unknown Security.framework error")
    }
    return try GeneratorAIDeviceKeyModule.derToRaw(der)
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
