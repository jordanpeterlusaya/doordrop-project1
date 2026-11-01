package expo.modules.incomingalert

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class IncomingAlertModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IncomingAlert")

    Function("start") {
      contextOrNull()?.let(IncomingAlertService::startAlarm)
    }

    Function("stop") {
      contextOrNull()?.let(IncomingAlertService::stopAlarm)
    }

    Function("setOnline") { enabled: Boolean ->
      val context = contextOrNull() ?: return@Function
      if (enabled) {
        IncomingAlertService.startOnline(context)
      } else {
        IncomingAlertService.stopOnline(context)
      }
    }
  }

  private fun contextOrNull(): Context? {
    return appContext.reactContext?.applicationContext
      ?: appContext.currentActivity?.applicationContext
  }
}
