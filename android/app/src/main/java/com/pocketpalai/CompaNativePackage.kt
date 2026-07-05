package com.pocketpal

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CompaNativePackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> {
    return listOf(
      CompaAudioPcmStreamModule(reactContext),
      CompaSmsModule(reactContext)
    )
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
