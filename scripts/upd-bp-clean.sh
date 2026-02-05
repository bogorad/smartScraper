#!/usr/bin/env bash
#
# Update Bypass Paywalls Chrome Clean extension from gitflic.ru
#

# Get script directory to find extensions folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="${SCRIPT_DIR}/../extensions/bypass-paywalls-chrome-clean-master"

if [[ ! -d "$EXTENSION_DIR" ]]; then
    echo "Error: Extension directory not found: $EXTENSION_DIR"
    exit 1
fi

cd "$EXTENSION_DIR" || {
    echo "Error: Cannot cd to $EXTENSION_DIR"
    exit 1
}

echo "Downloading latest bypass-paywalls-chrome-clean..."
if ! curl -L -f -o bpf.zip "https://gitflic.ru/project/magnolia1234/bpc_uploads/blob/raw?file=bypass-paywalls-chrome-clean-master.zip"; then
    echo "Error: Failed to download extension"
    exit 1
fi

if [[ ! -f bpf.zip ]]; then
    echo "Error: Downloaded file not found"
    exit 1
fi

if ! unzip -t bpf.zip >/dev/null 2>&1; then
    echo "Error: Downloaded file is not a valid zip"
    rm -f bpf.zip
    exit 1
fi

echo "Extracting..."
rm -rf bpc_update_temp
mkdir bpc_update_temp
if ! unzip -o bpf.zip -d bpc_update_temp; then
    echo "Error: Failed to extract zip"
    rm -rf bpc_update_temp bpf.zip
    exit 1
fi

# Verify extraction produced expected directory
if [[ ! -d "bpc_update_temp/bypass-paywalls-chrome-clean-master" ]]; then
    echo "Error: Expected directory not found in archive"
    rm -rf bpc_update_temp bpf.zip
    exit 1
fi

echo "Updating extension files..."
rm -rf allowlist cs_local custom lib options
mv bpc_update_temp/bypass-paywalls-chrome-clean-master/* .
rm -rf bpc_update_temp bpf.zip

echo "Done. Extension updated successfully."
