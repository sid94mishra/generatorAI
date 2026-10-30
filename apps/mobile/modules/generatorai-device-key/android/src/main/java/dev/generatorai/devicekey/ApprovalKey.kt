// ────────────────────────────────────────────────────────────────
// Approval key (mobile MG-05 / MD-31, M6-03): a second AndroidKeyStore P-256
// key per server (`gai.approval.<serverId>`) that signs RISKY approvals.
//
// UNCOMPILED: written without the Android SDK. Review on the next Gradle build.
//
//   • PURPOSE_SIGN, secp256r1, SHA-256; `setUserAuthenticationRequired(true)`.
//   • API 30+: `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL)` —
//     every use authenticates (timeout 0), biometrics with the PIN / pattern fallback MD-31 allows.
//     API < 30: `setUserAuthenticationValidityDurationSeconds(-1)` (biometric only; a device credential
//     cannot authorise a CryptoObject there), so such devices need a strong biometric.
//   • `setInvalidatedByBiometricEnrollment(true)`; `setUnlockedDeviceRequired(true)` (API 28+).
//   • StrongBox first (API 28+), the TEE keystore as the fallback; the backing actually obtained is read
//     back from `KeyInfo` (the module's `backingOf`).
//   • Signing: `Signature.initSign` (throws `KeyPermanentlyInvalidatedException` once biometrics change),
//     then `BiometricPrompt` with `CryptoObject(signature)` on the current FragmentActivity (ReactActivity
//     is one); the authorised signature signs, and the DER result becomes raw r‖s.
//
// A SharedPreferences marker remembers that a key was made for an alias, so a key that vanished reads as
// "invalidated" (register again) rather than "missing".
//
// Dependency: androidx.biometric (the same artifact and version expo-local-authentication already ships).
// ────────────────────────────────────────────────────────────────

package dev.generatorai.devicekey

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.concurrent.Executor

private const val APPROVAL_PREFS = "gai.approval.keys"
private const val ANDROID_KEYSTORE = "AndroidKeyStore"
private const val APPROVAL_CURVE = "secp256r1"
private const val APPROVAL_SIGNATURE = "SHA256withECDSA"

internal class ApprovalKeyUnsupportedException :
  CodedException("ERR_APPROVAL_KEY_UNSUPPORTED", "Approving risky actions needs a fingerprint, face unlock or a screen lock on this device", null)

internal class ApprovalKeyMissingException(alias: String) :
  CodedException("ERR_APPROVAL_KEY_MISSING", "No approval key exists under alias \"$alias\"", null)

internal class ApprovalKeyInvalidatedException(alias: String) :
  CodedException("ERR_APPROVAL_KEY_INVALIDATED", "The approval key \"$alias\" is no longer usable; register it again", null)

internal class ApprovalKeyCancelledException :
  CodedException("ERR_APPROVAL_KEY_CANCELLED", "The approval was cancelled", null)

internal class ApprovalKeyFailedException(detail: String, cause: Throwable? = null) :
  CodedException("ERR_APPROVAL_KEY_FAILED", "Approval signing failed: $detail", cause)

/** `signWithPrompt`'s prompt texts from JS (src/services/native/approvalKey.ts). */
class ApprovalPromptRecord : Record {
  @Field val title: String = ""
  @Field val subtitle: String? = null
  @Field val cancel: String = "Cancel"
}

internal object ApprovalKeys {
  /** The prompt being shown, so `cancelPrompt()` can end it (the JS timeout, MD-155). Main thread only. */
  private var inFlight: BiometricPrompt? = null

  /** Ends the prompt in flight, if any: its callback reports ERROR_CANCELED and `signWithPrompt` rejects as cancelled. */
  fun cancelPrompt() {
    Handler(Looper.getMainLooper()).post {
      inFlight?.cancelAuthentication()
      inFlight = null
    }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun prefs(context: Context) = context.getSharedPreferences(APPROVAL_PREFS, Context.MODE_PRIVATE)

  /** "biometry" with a strong biometric enrolled, "passcode" with only a screen lock (API 30+), else null. */
  fun presence(context: Context): String? {
    val biometric = BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
    if (biometric == BiometricManager.BIOMETRIC_SUCCESS) return "biometry"
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && keyguard?.isDeviceSecure == true) return "passcode"
    return null
  }

  private fun spec(alias: String, strongBox: Boolean): KeyGenParameterSpec {
    val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec(APPROVAL_CURVE))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
    } else {
      @Suppress("DEPRECATION")
      builder.setUserAuthenticationValidityDurationSeconds(-1)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setUnlockedDeviceRequired(true)
      if (strongBox) builder.setIsStrongBoxBacked(true)
    }
    return builder.build()
  }

  /** Generates (replacing) the key; StrongBox first. Returns the presence it was bound to. */
  fun generate(context: Context, alias: String): String {
    val presence = presence(context) ?: throw ApprovalKeyUnsupportedException()
    remove(context, alias)
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
    var generated = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        generator.initialize(spec(alias, strongBox = true))
        generator.generateKeyPair()
        generated = true
      } catch (_: StrongBoxUnavailableException) {
        // No secure element: the TEE below.
      } catch (_: Exception) {
        // Some OEM keystores throw a generic ProviderException for StrongBox; try without it.
      }
    }
    if (!generated) {
      try {
        generator.initialize(spec(alias, strongBox = false))
        generator.generateKeyPair()
      } catch (err: Exception) {
        throw ApprovalKeyFailedException(err.message ?: err.javaClass.simpleName, err)
      }
    }
    prefs(context).edit().putBoolean(alias, true).apply()
    return presence
  }

  fun status(context: Context, alias: String): String {
    if (presence(context) == null) return "unsupported"
    val store = keyStore()
    if (!store.containsAlias(alias)) return if (prefs(context).getBoolean(alias, false)) "invalidated" else "missing"
    return try {
      Signature.getInstance(APPROVAL_SIGNATURE).initSign(privateKey(alias))
      "ok"
    } catch (_: KeyPermanentlyInvalidatedException) {
      "invalidated"
    } catch (_: Exception) {
      // Anything else (e.g. a keystore busy) does not mean the key is gone; signing reports it precisely.
      "ok"
    }
  }

  fun remove(context: Context, alias: String) {
    val store = keyStore()
    if (store.containsAlias(alias)) store.deleteEntry(alias)
    prefs(context).edit().remove(alias).apply()
  }

  private fun privateKey(alias: String): PrivateKey {
    val entry = keyStore().getEntry(alias, null) as? KeyStore.PrivateKeyEntry ?: throw ApprovalKeyMissingException(alias)
    return entry.privateKey
  }

  /**
   * Shows the BiometricPrompt bound to a `Signature` over the key and resolves the raw r‖s signature (base64).
   * `derToRaw` is the module's DER → JOSE conversion.
   */
  fun signWithPrompt(
    activity: FragmentActivity,
    alias: String,
    dataBase64: String,
    prompt: ApprovalPromptRecord,
    derToRaw: (ByteArray) -> ByteArray,
    promise: Promise,
  ) {
    val message = try {
      Base64.decode(dataBase64, Base64.DEFAULT)
    } catch (err: IllegalArgumentException) {
      promise.reject(ApprovalKeyFailedException("input is not valid base64", err))
      return
    }
    val signature = try {
      Signature.getInstance(APPROVAL_SIGNATURE).apply { initSign(privateKey(alias)) }
    } catch (_: KeyPermanentlyInvalidatedException) {
      promise.reject(ApprovalKeyInvalidatedException(alias))
      return
    } catch (err: CodedException) {
      promise.reject(err)
      return
    } catch (err: Exception) {
      promise.reject(ApprovalKeyFailedException(err.message ?: err.javaClass.simpleName, err))
      return
    }

    val main = Handler(Looper.getMainLooper())
    val executor = Executor { runnable -> main.post(runnable) }
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        inFlight = null
        try {
          val authorised = result.cryptoObject?.signature ?: throw ApprovalKeyFailedException("the prompt returned no signature")
          authorised.update(message)
          promise.resolve(Base64.encodeToString(derToRaw(authorised.sign()), Base64.NO_WRAP))
        } catch (err: CodedException) {
          promise.reject(err)
        } catch (err: Exception) {
          promise.reject(ApprovalKeyFailedException(err.message ?: err.javaClass.simpleName, err))
        }
      }

      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        inFlight = null
        // Every outcome reaches JS as one of the coded errors (M6 device review).
        when (errorCode) {
          BiometricPrompt.ERROR_USER_CANCELED,
          BiometricPrompt.ERROR_NEGATIVE_BUTTON,
          BiometricPrompt.ERROR_CANCELED,
          BiometricPrompt.ERROR_TIMEOUT -> promise.reject(ApprovalKeyCancelledException())
          BiometricPrompt.ERROR_NO_BIOMETRICS,
          BiometricPrompt.ERROR_HW_NOT_PRESENT,
          BiometricPrompt.ERROR_HW_UNAVAILABLE,
          BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> promise.reject(ApprovalKeyUnsupportedException())
          else -> promise.reject(ApprovalKeyFailedException(errString.toString()))
        }
      }

      // onAuthenticationFailed: one non-matching attempt; the prompt stays up and the user may retry.
    }

    val info = BiometricPrompt.PromptInfo.Builder().setTitle(prompt.title)
    prompt.subtitle?.let { info.setSubtitle(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      info.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
    } else {
      info.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      info.setNegativeButtonText(prompt.cancel)
    }

    activity.runOnUiThread {
      try {
        val biometric = BiometricPrompt(activity, executor, callback)
        inFlight?.cancelAuthentication()
        inFlight = biometric
        biometric.authenticate(info.build(), BiometricPrompt.CryptoObject(signature))
      } catch (err: Exception) {
        inFlight = null
        promise.reject(ApprovalKeyFailedException(err.message ?: err.javaClass.simpleName, err))
      }
    }
  }
}
