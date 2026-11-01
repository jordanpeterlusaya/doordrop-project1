#!/usr/bin/env bash
set -euo pipefail

# Patch android/app/build.gradle to use release keystore.properties for Play signing.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${1:-$ROOT}"
PROPS_FILE="${2:-$APP_DIR/android-keystore.properties}"
GRADLE="$APP_DIR/android/app/build.gradle"
VERSION_CODE="${3:-1}"

[[ -f "$GRADLE" ]] || { echo "Missing $GRADLE"; exit 1; }
[[ -f "$PROPS_FILE" ]] || { echo "Missing $PROPS_FILE"; exit 1; }

python3 - <<PY
from pathlib import Path
gradle = Path("$GRADLE")
props = Path("$PROPS_FILE").resolve()
text = gradle.read_text()
version_code = int("$VERSION_CODE")

signing_block = f'''
def doordropKeystorePropertiesFile = file("{props}")
def doordropKeystoreProperties = new Properties()
if (doordropKeystorePropertiesFile.exists()) {{
    doordropKeystorePropertiesFile.withInputStream {{ doordropKeystoreProperties.load(it) }}
}}
'''

if 'doordropKeystoreProperties' not in text:
    # Insert after android { opening roughly before defaultConfig / after namespace
    needle = "android {"
    idx = text.find(needle)
    if idx < 0:
        raise SystemExit('android { block not found')
    insert_at = text.find('\n', idx) + 1
    text = text[:insert_at] + signing_block + text[insert_at:]

# Ensure release signingConfig exists
release_signing = '''
        release {
            if (doordropKeystorePropertiesFile.exists()) {
                keyAlias doordropKeystoreProperties['keyAlias']
                keyPassword doordropKeystoreProperties['keyPassword']
                storeFile file(doordropKeystoreProperties['storeFile'])
                storePassword doordropKeystoreProperties['storePassword']
            }
        }
'''

if "signingConfigs {" in text and "keyAlias doordropKeystoreProperties" not in text:
    text = text.replace(
        """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }""",
        """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
""" + release_signing + """    }""",
    )

text = text.replace(
    "signingConfig signingConfigs.debug\n            def enableShrinkResources",
    "signingConfig signingConfigs.release\n            def enableShrinkResources",
)

import re
text = re.sub(r'versionCode\s+\d+', f'versionCode {version_code}', text, count=1)

gradle.write_text(text)
print(f'Patched signing + versionCode={version_code} -> {gradle}')
PY
