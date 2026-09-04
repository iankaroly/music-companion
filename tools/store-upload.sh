#!/bin/sh
# Build the web app, sync it into the iOS project, archive, and upload the
# archive to App Store Connect. One command from source to a build sitting in
# TestFlight.
#
# Signing and upload are automatic: Xcode (Settings → Accounts) must be signed
# in with the Apple ID that holds the Developer Program membership for team
# 44PT88QA28, and the app record for com.iankaroly.practicepartner must exist
# in App Store Connect. -allowProvisioningUpdates lets xcodebuild mint the
# distribution certificate and profile itself the first time.
#
# To upload without an Xcode login, use an App Store Connect API key instead:
#   ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=... ASC_KEY_PATH=~/.private_keys/AuthKey_XXXXXXXXXX.p8 npm run store:upload
set -eu
cd "$(dirname "$0")/.."
OUT="${STORE_OUT:-${TMPDIR:-/tmp}/practicepartner-store}"
rm -rf "$OUT" && mkdir -p "$OUT"

npm run -s ios:sync

AUTH=""
if [ -n "${ASC_KEY_ID:-}" ]; then
  AUTH="-authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID -authenticationKeyPath $ASC_KEY_PATH"
fi

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/PracticePartner.xcarchive" archive \
  -allowProvisioningUpdates $AUTH -quiet

cat > "$OUT/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>44PT88QA28</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$OUT/PracticePartner.xcarchive" \
  -exportOptionsPlist "$OUT/export.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates $AUTH

echo "uploaded — it shows up under TestFlight in App Store Connect in a few minutes"
