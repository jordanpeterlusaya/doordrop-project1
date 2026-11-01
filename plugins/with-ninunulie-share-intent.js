const { AndroidConfig, withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

const SHARE_MARK_BEGIN = '// --- ninunulie-share begin ---';
const SHARE_MARK_END = '// --- ninunulie-share end ---';

const SHARE_HELPER_KOTLIN = `
  ${SHARE_MARK_BEGIN}
  private fun consumeNinunulieShare(source: android.content.Intent?) {
    if (source == null) return
    val action = source.action ?: return
    if (action != android.content.Intent.ACTION_SEND && action != android.content.Intent.ACTION_SEND_MULTIPLE) {
      return
    }
    try {
      val text = source.getStringExtra(android.content.Intent.EXTRA_TEXT) ?: ""
      val imageUris = mutableListOf<android.net.Uri>()
      if (action == android.content.Intent.ACTION_SEND) {
        val stream = if (android.os.Build.VERSION.SDK_INT >= 33) {
          source.getParcelableExtra(android.content.Intent.EXTRA_STREAM, android.net.Uri::class.java)
        } else {
          @Suppress("DEPRECATION")
          source.getParcelableExtra<android.net.Uri>(android.content.Intent.EXTRA_STREAM)
        }
        if (stream != null) imageUris.add(stream)
      } else {
        val streams = if (android.os.Build.VERSION.SDK_INT >= 33) {
          source.getParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, android.net.Uri::class.java)
        } else {
          @Suppress("DEPRECATION")
          source.getParcelableArrayListExtra<android.net.Uri>(android.content.Intent.EXTRA_STREAM)
        }
        if (streams != null) imageUris.addAll(streams)
      }
      val copied = imageUris.take(4).mapNotNull { copyNinunulieShareUri(it) }
      val builder = android.net.Uri.Builder()
        .scheme("doordrop")
        .authority("ninunulie")
        .appendQueryParameter("shared", "1")
      if (text.isNotBlank()) {
        builder.appendQueryParameter("sharedText", text.take(2000))
      }
      copied.forEachIndexed { index, path ->
        val key = if (index == 0) "sharedImage" else "sharedImage$index"
        builder.appendQueryParameter(key, path)
      }
      source.data = builder.build()
      source.action = android.content.Intent.ACTION_VIEW
      source.addCategory(android.content.Intent.CATEGORY_BROWSABLE)
    } catch (_: Exception) {
    }
  }

  private fun copyNinunulieShareUri(uri: android.net.Uri): String? {
    return try {
      val mime = contentResolver.getType(uri) ?: "image/jpeg"
      val ext = when {
        mime.contains("png") -> "png"
        mime.contains("webp") -> "webp"
        mime.contains("gif") -> "gif"
        else -> "jpg"
      }
      val dest = java.io.File(cacheDir, "ninunulie-share-\${System.currentTimeMillis()}-\${(0..9999).random()}.\$ext")
      contentResolver.openInputStream(uri)?.use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      } ?: return null
      dest.absolutePath
    } catch (_: Exception) {
      null
    }
  }
  ${SHARE_MARK_END}
`;

const SHARE_ON_NEW_INTENT_KOTLIN = `
  override fun onNewIntent(intent: android.content.Intent) {
    consumeNinunulieShare(intent)
    setIntent(intent)
    super.onNewIntent(intent)
  }
`;

function shareFilter(action, mimeType) {
  return {
    action: `android.intent.action.${action}`,
    category: ['android.intent.category.DEFAULT'],
    data: [{ $: { 'android:mimeType': mimeType } }],
  };
}

function filterKey(filter) {
  const action = filter.action?.[0]?.$?.['android:name'] || filter.action || '';
  const mime = filter.data?.[0]?.$?.['android:mimeType'] || '';
  return `${action}|${mime}`;
}

function normalizeFilter(filter) {
  const actionName =
    typeof filter.action === 'string'
      ? filter.action
      : filter.action?.[0]?.$?.['android:name'];
  const mime = filter.data?.[0]?.$?.['android:mimeType'];
  if (!actionName || !mime) {
    return filter;
  }
  return {
    action: [{ $: { 'android:name': actionName } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:mimeType': mime } }],
  };
}

function addShareFiltersToActivity(activity) {
  const incoming = [
    shareFilter('SEND', 'image/*'),
    shareFilter('SEND', 'text/plain'),
    shareFilter('SEND', 'text/*'),
    shareFilter('SEND_MULTIPLE', 'image/*'),
  ].map(normalizeFilter);

  const existing = Array.isArray(activity['intent-filter']) ? activity['intent-filter'] : [];
  const seen = new Set(existing.map(filterKey));
  const next = [...existing];
  for (const filter of incoming) {
    const key = filterKey(filter);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(filter);
  }
  activity['intent-filter'] = next;
  activity.$['android:exported'] = 'true';
}

function isShareTargetActivity(activity) {
  const name = String(activity.$?.['android:name'] || '');
  if (/MainActivity|DevLauncherActivity|DevActivity/i.test(name)) {
    return true;
  }
  const filters = Array.isArray(activity['intent-filter']) ? activity['intent-filter'] : [];
  return filters.some((filter) => {
    const categories = (filter.category || []).map((item) => item.$?.['android:name'] || '');
    return categories.includes('android.intent.category.LAUNCHER');
  });
}

function stripExistingHelper(contents) {
  const begin = contents.indexOf(SHARE_MARK_BEGIN);
  const end = contents.indexOf(SHARE_MARK_END);
  if (begin === -1 || end === -1 || end < begin) {
    return contents;
  }
  return `${contents.slice(0, begin)}${contents.slice(end + SHARE_MARK_END.length)}`;
}

function injectKotlinMainActivity(contents) {
  let next = stripExistingHelper(contents);

  if (!next.includes('fun consumeNinunulieShare')) {
    const classClose = next.lastIndexOf('}');
    if (classClose !== -1) {
      next = `${next.slice(0, classClose)}${SHARE_HELPER_KOTLIN}\n${next.slice(classClose)}`;
    }
  }

  if (!next.includes('consumeNinunulieShare(intent)')) {
    next = next.replace(
      /super\.onCreate\((null|savedInstanceState)\)/,
      'consumeNinunulieShare(intent)\n    super.onCreate($1)'
    );
  }

  if (!next.includes('override fun onNewIntent')) {
    const classClose = next.lastIndexOf('}');
    if (classClose !== -1) {
      next = `${next.slice(0, classClose)}${SHARE_ON_NEW_INTENT_KOTLIN}\n${next.slice(classClose)}`;
    }
  }

  return next;
}

module.exports = function withNinunulieShareIntent(config) {
  const withManifest = withAndroidManifest(config, (configWithManifest) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      configWithManifest.modResults
    );
    const activities = application.activity || [];
    for (const activity of activities) {
      if (isShareTargetActivity(activity)) {
        addShareFiltersToActivity(activity);
      }
    }
    return configWithManifest;
  });

  return withMainActivity(withManifest, (configWithActivity) => {
    if (configWithActivity.modResults.language === 'kt') {
      configWithActivity.modResults.contents = injectKotlinMainActivity(
        configWithActivity.modResults.contents
      );
    }
    return configWithActivity;
  });
};
