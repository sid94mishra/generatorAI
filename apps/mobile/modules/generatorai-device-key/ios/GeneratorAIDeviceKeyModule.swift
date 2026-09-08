// ────────────────────────────────────────────────────────────────
// GeneratorAIDeviceKey — Secure Enclave P-256 signing key.
//
// UNCOMPILED: written without Xcode on the authoring machine. Review the
// first `expo prebuild && expo run:ios` carefully.
//
// What this module guarantees, and how:
//
//   • Non-extractable. `SecKeyCreateRandomKey` with
//     `kSecAttrTokenIDSecureEnclave` creates the key INSIDE the enclave; the
//     private half never exists in app memory, so `SecKeyCopyExternalRepresentation`
//     on it is impossible by construction.
//   • P-256 / ES256. `kSecAttrKeyTypeECSECPrimeRandom` at 256 bits, signed
//     with `.ecdsaSignatureMessageX962SHA256` (the enclave hashes the message
//     itself). Security.framework returns DER; `derToRaw` converts it to the
//     raw `r || s` (64 bytes) JOSE form that `createDpopProof` base64url-encodes.
//   • Usable after first unlock. Lock-screen Allow/Deny actions
//     (src/auth/backgroundFetch.ts) sign a request while the phone is locked,
//     so the access control is `AfterFirstUnlockThisDeviceOnly`, NOT
//     `WhenUnlocked`. `ThisDeviceOnly` also keeps the reference out of
//     iCloud Keychain / restores, matching an enclave key that cannot leave
//     the chip anyway.
//   • No biometric binding on the key itself. App lock and step-up are
//     enforced in JS (`AppLockGate`, `requireStepUp`); binding the key to
//     biometrics would make every background signature prompt for Face ID.
//
// JS facade: apps/mobile/src/native/deviceKeyModule.ts.
// ────────────────────────────────────────────────────────────────

import CryptoKit
import ExpoModulesCore
import Foundation
import Security

internal final class DeviceKeyUnavailableException: Exception {
  override var reason: String {
    "The Secure Enclave is not available on this device"
  }
}

internal final class DeviceKeyNotFoundException: GenericException<String> {
  override var reason: String {
    "No device key exists under alias \"\(param)\""
  }
}

internal final class DeviceKeyOperationException: GenericException<String> {
  override var reason: String {
    "Device key operation failed: \(param)"
  }
}

internal final class DeviceKeySignatureFormatException: Exception {
  override var reason: String {
    "The Secure Enclave returned a signature that is not DER ECDSA"
  }
}

public final class GeneratorAIDeviceKeyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GeneratorAIDeviceKey")

    AsyncFunction("isSupported") { () -> Bool in
      return SecureEnclave.isAvailable
    }

    AsyncFunction("generate") { (alias: String) -> [String: Any] in
      guard SecureEnclave.isAvailable else { throw DeviceKeyUnavailableException() }
      // Replace, never accumulate: a second key under the same tag would make
      // `load` ambiguous and leave a revoked key behind.
      Self.deleteKey(alias: alias)
      let privateKey = try Self.createKey(alias: alias)
      return try Self.handle(for: privateKey)
    }

    AsyncFunction("exists") { (alias: String) -> Bool in
      return Self.findKey(alias: alias) != nil
    }

    AsyncFunction("load") { (alias: String) -> [String: Any]? in
      guard let privateKey = Self.findKey(alias: alias) else { return nil }
      return try Self.handle(for: privateKey)
    }

    AsyncFunction("backing") { (alias: String) -> String? in
      return Self.findKey(alias: alias) == nil ? nil : Self.backingName
    }

    AsyncFunction("sign") { (alias: String, dataBase64: String) -> String in
      guard let privateKey = Self.findKey(alias: alias) else {
        throw DeviceKeyNotFoundException(alias)
      }
      guard let message = Data(base64Encoded: dataBase64, options: [.ignoreUnknownCharacters]) else {
        throw DeviceKeyOperationException("input is not valid base64")
      }
      var error: Unmanaged<CFError>?
      guard
        let der = SecKeyCreateSignature(
          privateKey,
          .ecdsaSignatureMessageX962SHA256,
          message as CFData,
          &error
        ) as Data?
      else {
        throw DeviceKeyOperationException(Self.describe(error))
      }
      return try Self.derToRaw(der).base64EncodedString()
    }

    AsyncFunction("remove") { (alias: String) -> Void in
      Self.deleteKey(alias: alias)
    }
  }

  // MARK: - Keychain

  /// Every key this module makes is an enclave key; `isSupported` is the gate.
  private static let backingName = "secure-enclave"

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

  private static func createKey(alias: String) throws -> SecKey {
    var error: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        [.privateKeyUsage],
        &error
      )
    else {
      throw DeviceKeyOperationException(describe(error))
    }

    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(alias),
        kSecAttrAccessControl as String: access,
      ],
    ]

    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw DeviceKeyOperationException(describe(error))
    }
    return key
  }

  private static func findKey(alias: String) -> SecKey? {
    var query = baseQuery(alias: alias)
    query[kSecReturnRef as String] = true
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let item = item else { return nil }
    // `SecKey` is a CF type; this cast is the documented way to recover it.
    return (item as! SecKey)  // swiftlint:disable:this force_cast
  }

  private static func deleteKey(alias: String) {
    // Ignore the result on purpose: "nothing to delete" is success here.
    SecItemDelete(baseQuery(alias: alias) as CFDictionary)
  }

  // MARK: - Public key → JWK

  private static func handle(for privateKey: SecKey) throws -> [String: Any] {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw DeviceKeyOperationException("could not derive the public key")
    }
    var error: Unmanaged<CFError>?
    guard let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw DeviceKeyOperationException(describe(error))
    }
    // Uncompressed SEC1 point: 0x04 || X (32) || Y (32).
    guard point.count == 65, point[point.startIndex] == 0x04 else {
      throw DeviceKeyOperationException("unexpected public key encoding (\(point.count) bytes)")
    }
    let x = point.subdata(in: (point.startIndex + 1)..<(point.startIndex + 33))
    let y = point.subdata(in: (point.startIndex + 33)..<(point.startIndex + 65))
    return [
      "publicJwk": [
        "kty": "EC",
        "crv": "P-256",
        "x": base64url(x),
        "y": base64url(y),
      ],
      "backing": backingName,
    ]
  }

  private static func base64url(_ data: Data) -> String {
    return data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  // MARK: - DER → raw r||s

  /// `SEQUENCE { INTEGER r, INTEGER s }` → 64 bytes, each integer
  /// left-padded to 32 bytes with its DER sign byte stripped.
  internal static func derToRaw(_ der: Data) throws -> Data {
    let bytes = [UInt8](der)
    var index = 0

    func read() throws -> UInt8 {
      guard index < bytes.count else { throw DeviceKeySignatureFormatException() }
      let value = bytes[index]
      index += 1
      return value
    }

    func readLength() throws -> Int {
      let first = try read()
      if first & 0x80 == 0 { return Int(first) }
      let count = Int(first & 0x7f)
      guard count > 0, count <= 2 else { throw DeviceKeySignatureFormatException() }
      var length = 0
      for _ in 0..<count { length = (length << 8) | Int(try read()) }
      return length
    }

    func readInteger() throws -> [UInt8] {
      guard try read() == 0x02 else { throw DeviceKeySignatureFormatException() }
      let length = try readLength()
      guard length > 0, index + length <= bytes.count else { throw DeviceKeySignatureFormatException() }
      var value = Array(bytes[index..<(index + length)])
      index += length
      // Strip the leading 0x00 DER adds when the top bit is set.
      while value.count > 32, value.first == 0x00 { value.removeFirst() }
      guard value.count <= 32 else { throw DeviceKeySignatureFormatException() }
      return [UInt8](repeating: 0, count: 32 - value.count) + value
    }

    guard try read() == 0x30 else { throw DeviceKeySignatureFormatException() }
    _ = try readLength()
    let r = try readInteger()
    let s = try readInteger()
    return Data(r + s)
  }

  private static func describe(_ error: Unmanaged<CFError>?) -> String {
    guard let error = error?.takeRetainedValue() else { return "unknown Security.framework error" }
    return CFErrorCopyDescription(error) as String? ?? "unknown Security.framework error"
  }
}
