package com.pocketpal

import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import android.telephony.SmsManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class CompaSmsModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "CompaSms"

  @ReactMethod
  fun sendSms(phoneNumber: String, message: String, promise: Promise) {
    if (
      reactContext.checkSelfPermission(Manifest.permission.SEND_SMS) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("E_SEND_SMS_PERMISSION", "SEND_SMS permission is not granted")
      return
    }
    if (phoneNumber.isBlank() || message.isBlank()) {
      promise.resolve(false)
      return
    }
    try {
      val smsManager = getSmsManager()
      val parts = smsManager.divideMessage(message)
      if (parts.isEmpty()) {
        promise.resolve(false)
        return
      }
      smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_SEND_SMS", error)
    }
  }

  @Suppress("DEPRECATION")
  private fun getSmsManager(): SmsManager {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      reactContext.getSystemService(SmsManager::class.java)?.let {
        return it
      }
    }
    return SmsManager.getDefault()
  }
}
