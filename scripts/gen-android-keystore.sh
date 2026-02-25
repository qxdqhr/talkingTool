#!/usr/bin/env bash
# 说明：
# - 这是首次为 Android 发布版打包创建签名证书（keystore）时需要执行的脚本。
# - 生成的 keystore 用于后续所有 release 签名，请妥善保存，勿泄露、勿丢失。
# - 执行后会打印 GitHub Secrets 需要的 4 个值，直接复制即可。
# - 如果你已经有 keystore，则不需要再次运行此脚本。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYSTORE_PATH="${ROOT_DIR}/talkingtool-release.jks"
# 可选：传入 alias，默认 talkingtool
ALIAS_NAME="${1:-talkingtool}"

echo "==> Generate keystore: ${KEYSTORE_PATH}"
echo "==> You will be prompted for keystore password / key password / organization info."
keytool -genkeypair -v \
  -keystore "${KEYSTORE_PATH}" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias "${ALIAS_NAME}"

echo ""
echo "==> Prepare GitHub Secrets (copy these values)"
echo "ANDROID_KEYSTORE_BASE64="
if command -v base64 >/dev/null 2>&1; then
  base64 -i "${KEYSTORE_PATH}"
else
  echo "base64 command not found. Please install coreutils."
fi
echo ""
echo "ANDROID_KEYSTORE_PASSWORD= (你在上一步输入的 keystore 密码)"
echo "ANDROID_KEY_ALIAS=${ALIAS_NAME}"
echo "ANDROID_KEY_PASSWORD= (你在上一步输入的 key 密码)"
