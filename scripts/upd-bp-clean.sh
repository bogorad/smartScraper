#!/usr/bin/env bash
set -e

cd /home/chuck/git/smartScraper/extensions/bypass-paywalls-chrome-clean-master

curl -L -o bpf.zip "https://gitflic.ru/project/magnolia1234/bpc_uploads/blob/raw?file=bypass-paywalls-chrome-clean-master.zip"

rm -rf bpc_update_temp
mkdir bpc_update_temp
unzip -o bpf.zip -d bpc_update_temp

rm -rf allowlist cs_local custom lib options
mv bpc_update_temp/bypass-paywalls-chrome-clean-master/* .
rm -rf bpc_update_temp bpf.zip
