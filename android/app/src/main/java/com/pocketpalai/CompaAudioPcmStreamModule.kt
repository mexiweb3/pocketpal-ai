package com.pocketpal

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class CompaAudioPcmStreamModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  @Volatile private var recording = false
  private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  private var sampleRate = 16000
  private var channels = 1
  private var bufferSize = 0

  override fun getName(): String = "CompaAudioPcmStream"

  @ReactMethod
  fun initialize(config: ReadableMap, promise: Promise) {
    sampleRate = if (config.hasKey("sampleRate")) config.getInt("sampleRate") else 16000
    channels = if (config.hasKey("channels")) config.getInt("channels") else 1
    val channelConfig =
      if (channels == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
    val minBuffer = AudioRecord.getMinBufferSize(
      sampleRate,
      channelConfig,
      AudioFormat.ENCODING_PCM_16BIT
    )
    bufferSize = if (config.hasKey("bufferSize")) {
      config.getInt("bufferSize")
    } else {
      maxOf(minBuffer * 2, sampleRate / 2)
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun start(promise: Promise) {
    if (recording) {
      promise.resolve(null)
      return
    }
    if (
      reactContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("E_RECORD_AUDIO_PERMISSION", "RECORD_AUDIO permission is not granted")
      return
    }

    val channelConfig =
      if (channels == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
    val minBuffer = AudioRecord.getMinBufferSize(
      sampleRate,
      channelConfig,
      AudioFormat.ENCODING_PCM_16BIT
    )
    if (minBuffer <= 0) {
      promise.reject(
        "E_AUDIO_RECORD_CONFIG",
        "AudioRecord does not support sampleRate=$sampleRate channels=$channels"
      )
      return
    }
    val size = maxOf(
      bufferSize,
      minBuffer
    )

    val audioRecord = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        sampleRate,
        channelConfig,
        AudioFormat.ENCODING_PCM_16BIT,
        size
      )
    } catch (error: Throwable) {
      promise.reject("E_AUDIO_RECORD_CREATE", "Could not create AudioRecord", error)
      return
    }

    if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
      audioRecord.release()
      promise.reject("E_AUDIO_RECORD_STATE", "AudioRecord was not initialized")
      return
    }

    try {
      audioRecord.startRecording()
    } catch (error: Throwable) {
      audioRecord.release()
      promise.reject("E_AUDIO_RECORD_START", "Could not start AudioRecord", error)
      return
    }

    if (audioRecord.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      try {
        audioRecord.stop()
      } catch (_: IllegalStateException) {
        // AudioRecord never reached recording state.
      }
      audioRecord.release()
      promise.reject("E_AUDIO_RECORD_START", "AudioRecord did not enter recording state")
      return
    }

    recorder = audioRecord
    recording = true
    emitStatus(true)

    worker = Thread {
      val buffer = ByteArray(size)
      var stoppedByReadError = false
      while (recording) {
        val read: Int
        try {
          read = audioRecord.read(buffer, 0, buffer.size)
        } catch (error: Throwable) {
          emitError("E_AUDIO_RECORD_READ", error.message ?: "AudioRecord.read failed")
          stoppedByReadError = true
          recording = false
          break
        }
        if (read > 0) {
          val payload = Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
          val event = Arguments.createMap().apply {
            putString("data", payload)
            putInt("sampleRate", sampleRate)
            putInt("channels", channels)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
          }
          emit("CompaAudioPcmStreamData", event)
        } else if (read < 0) {
          emitError("E_AUDIO_RECORD_READ", "AudioRecord.read failed with code $read")
          stoppedByReadError = true
          recording = false
          break
        }
      }
      if (stoppedByReadError) {
        cleanupRecorder(audioRecord)
      }
    }
    worker?.start()
    promise.resolve(null)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    stopRecording()
    promise.resolve(null)
  }

  @ReactMethod
  fun isRecording(promise: Promise) {
    promise.resolve(recording)
  }

  @ReactMethod
  fun release(promise: Promise) {
    stopRecording()
    promise.resolve(null)
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter.
  }

  private fun stopRecording() {
    if (!recording && recorder == null) {
      return
    }
    recording = false
    try {
      val currentWorker = worker
      if (currentWorker != null && currentWorker !== Thread.currentThread()) {
        currentWorker.join(500)
      }
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
    worker = null
    recorder?.let { cleanupRecorder(it) }
  }

  private fun cleanupRecorder(audioRecord: AudioRecord) {
    try {
      audioRecord.stop()
    } catch (_: IllegalStateException) {
      // Already stopped.
    }
    audioRecord.release()
    if (recorder === audioRecord) {
      recorder = null
    }
    emitStatus(false)
  }

  private fun emitStatus(isRecording: Boolean) {
    val event = Arguments.createMap().apply {
      putBoolean("isRecording", isRecording)
    }
    emit("CompaAudioPcmStreamStatus", event)
  }

  private fun emitError(code: String, message: String) {
    val event = Arguments.createMap().apply {
      putString("code", code)
      putString("error", message)
    }
    emit("CompaAudioPcmStreamError", event)
  }

  private fun emit(name: String, payload: Any) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, payload)
  }
}
