#!/usr/bin/env bash
set -e

# Configuration
EXT_ID="cfhdojbkjhnklbpkdaibdccddilifddb"
EXT_NAME="adblock-plus"
EXT_DIR="./extensions/$EXT_NAME"
CRX_URL="https://clients2.google.com/service/update2/crx?response=redirect&os=linux&arch=x64&os_arch=x86_64&nacl_arch=x86-64&prod=chromiumcrx&prodchannel=unknown&prodversion=9999.0.9999.0&acceptformat=crx2,crx3&x=id%3D${EXT_ID}%26uc"

echo "Updating $EXT_NAME..."

# Create directory
mkdir -p "$EXT_DIR"

# Download CRX
echo "Downloading CRX from Google Web Store..."
curl -L "$CRX_URL" -o "$EXT_DIR/extension.crx"

# Unzip (ignoring warnings about extra bytes at start of CRX)
echo "Unpacking..."
unzip -o -d "$EXT_DIR" "$EXT_DIR/extension.crx" || true

# Cleanup
rm "$EXT_DIR/extension.crx"

echo "$EXT_NAME updated successfully in $EXT_DIR"
