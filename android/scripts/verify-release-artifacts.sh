#!/usr/bin/env bash
# Shared verification for CI disposable signing and the approved production workflow.
# Run from repository root. The verifier never signs, publishes or deploys.
set -euo pipefail
export LC_ALL=C
version="${1:?Expected release versionCode required}"
[[ "$version" =~ ^[1-9][0-9]*$ ]]
: "${ANDROID_KEYSTORE_PATH:?}" "${ANDROID_KEYSTORE_PASSWORD:?}" "${ANDROID_KEY_ALIAS:?}"
: "${ANDROID_HOME:?}" "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}"
shopt -s nullglob
apks=(android/app/build/outputs/apk/release/*.apk)
bundles=(android/app/build/outputs/bundle/release/*.aab)
test "${#apks[@]}" -eq 1
test "${#bundles[@]}" -eq 1
apk="${apks[0]}"
aab="${bundles[0]}"
tools="$ANDROID_HOME/build-tools/36.0.0"
# Capture complete tool output before parsing, preserving command exit status.
key_info=$(keytool -J-Duser.language=en -list -v -keystore "$ANDROID_KEYSTORE_PATH" -storepass:env ANDROID_KEYSTORE_PASSWORD -alias "$ANDROID_KEY_ALIAS")
expected=$(awk '/SHA256:/{if (!seen++) print $2}' <<< "$key_info" | tr -d ':' | tr '[:upper:]' '[:lower:]')
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
apk_info=$("$tools/apksigner" verify --print-certs "$apk")
actual=$(awk '/^Signer #1 certificate SHA-256 digest:/{print $NF}' <<< "$apk_info" | tr '[:upper:]' '[:lower:]')
test "$actual" = "$expected"
test "$(grep -cE '^Signer #[0-9]+ certificate SHA-256 digest:' <<< "$apk_info")" -eq 1
badging=$("$tools/aapt" dump badging "$apk")
grep -Fq "package: name='com.vanta.app' versionCode='$version'" <<< "$badging"
if grep -q '^application-debuggable' <<< "$badging"; then
  echo "ERROR: debuggable APK"
  exit 1
fi
# jarsigner checks cryptographic integrity. The Java verifier below additionally
# refuses unsigned payload entries and entries signed by a different signer.
jar_info=$(jarsigner -J-Duser.language=en -verify "$aab")
grep -Fq 'jar verified.' <<< "$jar_info"
java android/scripts/VerifyBundleSigner.java "$aab" "$expected"
printf 'commit=%s\nrun=%s\nversionCode=%s\npackage=com.vanta.app\nsignerSha256=%s\n' "$GITHUB_SHA" "$GITHUB_RUN_ID" "$version" "$expected" > android/release-build-info.txt
sha256sum "$apk" "$aab" > android/release-sha256.txt
echo "Release APK package/version/non-debuggable status, APK and AAB signatures, and artifact checksums verified."
