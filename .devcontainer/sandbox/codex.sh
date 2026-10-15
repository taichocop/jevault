#!/bin/sh
set -eu

# 設定のdeep mergeで保存済みの同名profileが権限を広げないよう、起動ごとに名前を分離する。
permission_profile="jevault_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
network_domains='{}'
# 合成probe専用のloopback controlはsandbox helperに限定し、通常起動では空リストを使う。
if [ "${1-}" = "--synthetic-loopback-control" ]; then
  shift
  if [ "${1-}" != "sandbox" ]; then
    printf '%s\n' 'Synthetic loopback control requires the sandbox helper.' >&2
    exit 1
  fi
  network_domains='{"127.0.0.1"="allow"}'
fi

# workspace-writeを継承し、管理proxyで通信先を制限してNodeのIPCも使えるようにする。
exec codex \
  --ask-for-approval on-request \
  -c "default_permissions=\"$permission_profile\"" \
  -c 'features.network_proxy=true' \
  -c 'features.use_legacy_landlock=false' \
  -c "permissions.$permission_profile={extends=\":workspace\",filesystem={\"/workspaces/node_modules\"=\"write\"},network={enabled=true,mode=\"full\",allow_local_binding=false,allow_upstream_proxy=false,enable_socks5=false,enable_socks5_udp=false,dangerously_allow_all_unix_sockets=false,dangerously_allow_non_loopback_proxy=false,domains=$network_domains,unix_sockets={}}}" \
  "$@"
