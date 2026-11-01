package expo.modules.incomingalert

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class IncomingAlertService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var mediaPlayer: MediaPlayer? = null
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var savedAlarmVolume: Int? = null
  private var alarming = false
  private var online = false
  private var wakeLock: PowerManager.WakeLock? = null

  private val watchdog = object : Runnable {
    override fun run() {
      if (!alarming) {
        return
      }
      val player = mediaPlayer
      if (player == null || !player.isPlaying) {
        startAlarmSound()
      }
      startLoopingVibration()
      handler.postDelayed(this, 1500)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START_ALARM -> {
        alarming = true
        online = true
        startForeground(NOTIFICATION_ID, buildNotification(true))
        acquireWakeLock()
        requestAlarmFocus()
        boostAlarmVolume()
        startAlarmSound()
        startLoopingVibration()
        handler.removeCallbacks(watchdog)
        handler.post(watchdog)
      }
      ACTION_STOP_ALARM -> {
        alarming = false
        handler.removeCallbacks(watchdog)
        stopAlarmPlayback()
        if (online) {
          startForeground(NOTIFICATION_ID, buildNotification(false))
        } else {
          stopSelfSafely()
        }
      }
      ACTION_START_ONLINE -> {
        online = true
        if (!alarming) {
          startForeground(NOTIFICATION_ID, buildNotification(false))
        }
      }
      ACTION_STOP_ONLINE -> {
        online = false
        if (!alarming) {
          stopSelfSafely()
        }
      }
      else -> {
        if (alarming || online) {
          startForeground(NOTIFICATION_ID, buildNotification(alarming))
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    alarming = false
    online = false
    handler.removeCallbacks(watchdog)
    stopAlarmPlayback()
    releaseWakeLock()
    super.onDestroy()
  }

  private fun startAlarmSound() {
    stopSoundOnly()
    val player = MediaPlayer()
    try {
      val resource = resources.openRawResourceFd(R.raw.incoming_order_alarm)
      player.setDataSource(resource.fileDescriptor, resource.startOffset, resource.length)
      resource.close()
      player.isLooping = true
      player.setAudioAttributes(alarmAudioAttributes())
      player.setVolume(1f, 1f)
      player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
      player.setOnCompletionListener { completed ->
        if (!alarming) {
          return@setOnCompletionListener
        }
        try {
          completed.seekTo(0)
          completed.start()
        } catch (_: Exception) {
          startAlarmSound()
        }
      }
      player.setOnErrorListener { _, _, _ ->
        if (alarming) {
          handler.postDelayed({ startAlarmSound() }, 250)
        }
        true
      }
      player.prepare()
      player.start()
      mediaPlayer = player
    } catch (_: Exception) {
      try {
        player.release()
      } catch (_: Exception) {
      }
    }
  }

  private fun startLoopingVibration() {
    val vibrator = getVibrator() ?: return
    val timings = longArrayOf(0, 700, 90, 700, 90, 700, 280)
    val amplitudes = intArrayOf(0, 255, 0, 255, 0, 255, 0)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val effect = VibrationEffect.createWaveform(timings, amplitudes, 0)
        if (Build.VERSION.SDK_INT >= 33) {
          vibrator.vibrate(
            effect,
            VibrationAttributes.Builder().setUsage(VibrationAttributes.USAGE_ALARM).build()
          )
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(effect, alarmAudioAttributes())
        }
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(timings, 0)
      }
    } catch (_: Exception) {
    }
  }

  private fun stopAlarmPlayback() {
    getVibrator()?.cancel()
    stopSoundOnly()
    restoreAlarmVolume()
    abandonAlarmFocus()
  }

  private fun stopSoundOnly() {
    try {
      mediaPlayer?.stop()
    } catch (_: Exception) {
    }
    try {
      mediaPlayer?.release()
    } catch (_: Exception) {
    }
    mediaPlayer = null
  }

  private fun stopSelfSafely() {
    stopAlarmPlayback()
    releaseWakeLock()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun buildNotification(isAlarm: Boolean): Notification {
    ensureChannels()
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val pending = PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = NotificationCompat.Builder(this, if (isAlarm) CHANNEL_ALARM else CHANNEL_ONLINE)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(if (isAlarm) "Oda mpya ya HAUL Pilots" else "HAUL Pilots iko mtandaoni")
      .setContentText(if (isAlarm) "Kubali au kataa oda hii sasa." else "Unaweza kupokea oda mpya.")
      .setContentIntent(pending)
      .setOngoing(true)
      .setOnlyAlertOnce(!isAlarm)
      .setCategory(if (isAlarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_SERVICE)
      .setPriority(if (isAlarm) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    if (isAlarm) {
      builder.setFullScreenIntent(pending, true)
      builder.setSound(null)
    }

    val notification = builder.build()
    if (isAlarm) {
      notification.flags = notification.flags or Notification.FLAG_INSISTENT or Notification.FLAG_NO_CLEAR
    }
    return notification
  }

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val alarm = NotificationChannel(
      CHANNEL_ALARM,
      "Incoming orders",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Repeating alarm until the driver accepts or declines."
      setSound(null, alarmAudioAttributes())
      enableVibration(false)
      setBypassDnd(true)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    val idle = NotificationChannel(
      CHANNEL_ONLINE,
      "Driver online",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Keeps HAUL ready for new orders."
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(alarm)
    manager.createNotificationChannel(idle)
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) {
      return
    }
    val pm = getSystemService(POWER_SERVICE) as? PowerManager ?: return
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "doordrive:incoming-alert").apply {
      setReferenceCounted(false)
      acquire(10 * 60 * 1000L)
    }
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
    } catch (_: Exception) {
    }
    wakeLock = null
  }

  private fun boostAlarmVolume() {
    val manager = audioManager ?: (getSystemService(AUDIO_SERVICE) as? AudioManager) ?: return
    audioManager = manager
    try {
      if (savedAlarmVolume == null) {
        savedAlarmVolume = manager.getStreamVolume(AudioManager.STREAM_ALARM)
      }
      manager.setStreamVolume(AudioManager.STREAM_ALARM, manager.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
    } catch (_: Exception) {
    }
  }

  private fun restoreAlarmVolume() {
    val manager = audioManager
    val previous = savedAlarmVolume
    savedAlarmVolume = null
    if (manager == null || previous == null) {
      return
    }
    try {
      manager.setStreamVolume(AudioManager.STREAM_ALARM, previous, 0)
    } catch (_: Exception) {
    }
  }

  private fun requestAlarmFocus() {
    val manager = getSystemService(AUDIO_SERVICE) as? AudioManager ?: return
    audioManager = manager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(alarmAudioAttributes())
          .setAcceptsDelayedFocusGain(false)
          .setWillPauseWhenDucked(false)
          .build()
        audioFocusRequest = request
        manager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        manager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
      }
    } catch (_: Exception) {
    }
  }

  private fun abandonAlarmFocus() {
    try {
      val manager = audioManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { manager?.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        manager?.abandonAudioFocus(null)
      }
    } catch (_: Exception) {
    }
    audioFocusRequest = null
  }

  private fun alarmAudioAttributes(): AudioAttributes {
    return AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .setFlags(AudioAttributes.FLAG_AUDIBILITY_ENFORCED)
      .build()
  }

  private fun getVibrator(): Vibrator? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager = getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager
      manager?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(VIBRATOR_SERVICE) as? Vibrator
    }
  }

  companion object {
    const val ACTION_START_ALARM = "expo.modules.incomingalert.START_ALARM"
    const val ACTION_STOP_ALARM = "expo.modules.incomingalert.STOP_ALARM"
    const val ACTION_START_ONLINE = "expo.modules.incomingalert.START_ONLINE"
    const val ACTION_STOP_ONLINE = "expo.modules.incomingalert.STOP_ONLINE"
    const val CHANNEL_ALARM = "incoming_order_alarm"
    const val CHANNEL_ONLINE = "driver_online"
    const val NOTIFICATION_ID = 41041

    fun startAlarm(context: Context) {
      ContextCompat.startForegroundService(
        context.applicationContext,
        Intent(context.applicationContext, IncomingAlertService::class.java).setAction(ACTION_START_ALARM)
      )
    }

    fun stopAlarm(context: Context) {
      context.applicationContext.startService(
        Intent(context.applicationContext, IncomingAlertService::class.java).setAction(ACTION_STOP_ALARM)
      )
    }

    fun startOnline(context: Context) {
      ContextCompat.startForegroundService(
        context.applicationContext,
        Intent(context.applicationContext, IncomingAlertService::class.java).setAction(ACTION_START_ONLINE)
      )
    }

    fun stopOnline(context: Context) {
      context.applicationContext.startService(
        Intent(context.applicationContext, IncomingAlertService::class.java).setAction(ACTION_STOP_ONLINE)
      )
    }
  }
}
