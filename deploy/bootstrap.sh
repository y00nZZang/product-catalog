#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker
# Small VM: absorb short Chromium/build peaks without silently resizing resources.
if ! swapon --show | grep -q /swapfile; then
  if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
install -d -m 0750 /opt/product-catalog
