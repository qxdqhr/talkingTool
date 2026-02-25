#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/packages/mobile"
ANDROID_DIR="${MOBILE_DIR}/android"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Please install pnpm first."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Please install Node.js first."
  exit 1
fi

if ! command -v java >/dev/null 2>&1; then
  echo "Java not found. Please install JDK 17."
  exit 1
fi

echo "==> Install dependencies"
pnpm install --no-frozen-lockfile

echo "==> Generate Android native project (Expo prebuild)"
cd "${MOBILE_DIR}"
npx expo prebuild --platform android --non-interactive

if [ -z "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  echo "ANDROID_KEYSTORE_BASE64 not set. Skipping signing setup."
  echo "Set ANDROID_KEYSTORE_BASE64/ANDROID_KEYSTORE_PASSWORD/ANDROID_KEY_ALIAS/ANDROID_KEY_PASSWORD to enable release signing."
else
  if [ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ] || [ -z "${ANDROID_KEY_ALIAS:-}" ] || [ -z "${ANDROID_KEY_PASSWORD:-}" ]; then
    echo "Missing keystore env vars. Need ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD."
    exit 1
  fi

  echo "==> Configure Android keystore"
  mkdir -p "${ANDROID_DIR}/app"
  echo "${ANDROID_KEYSTORE_BASE64}" | base64 --decode > "${ANDROID_DIR}/app/keystore.jks"
  cat > "${ANDROID_DIR}/keystore.properties" <<EOF
storeFile=keystore.jks
storePassword=${ANDROID_KEYSTORE_PASSWORD}
keyAlias=${ANDROID_KEY_ALIAS}
keyPassword=${ANDROID_KEY_PASSWORD}
EOF
fi

echo "==> Build Android APK (release)"
cd "${ANDROID_DIR}"
./gradlew assembleRelease

echo "==> APK output:"
echo "${ANDROID_DIR}/app/build/outputs/apk/release/app-release.apk"
