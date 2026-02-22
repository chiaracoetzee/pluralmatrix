#!/bin/bash

# toggle-module.sh
# Enables or disables the Synapse Gatekeeper module.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/synapse/config/homeserver.yaml"

if grep -q "^modules:" "$CONFIG_FILE"; then
    echo "🚫 Disabling Synapse Gatekeeper module..."
    sudo sed -i 's/^modules:/#modules:/' "$CONFIG_FILE"
    sudo sed -i 's/^  - module: plural_gatekeeper.PluralGatekeeper/  # - module: plural_gatekeeper.PluralGatekeeper/' "$CONFIG_FILE"
    sudo sed -i 's/^    config:/    #config:/' "$CONFIG_FILE"
    sudo sed -i 's/^      service_url:/      #service_url:/' "$CONFIG_FILE"
    sudo sed -i 's/^      as_token:/      #as_token:/' "$CONFIG_FILE"
else
    echo "✅ Enabling Synapse Gatekeeper module..."
    sudo sed -i 's/^#modules:/modules:/' "$CONFIG_FILE"
    sudo sed -i 's/^  # - module: plural_gatekeeper.PluralGatekeeper/  - module: plural_gatekeeper.PluralGatekeeper/' "$CONFIG_FILE"
    sudo sed -i 's/^    #config:/    config:/' "$CONFIG_FILE"
    sudo sed -i 's/^      #service_url:/      service_url:/' "$CONFIG_FILE"
    sudo sed -i 's/^      #as_token:/      as_token:/' "$CONFIG_FILE"
fi

echo "🔄 Restarting Synapse..."
sudo docker restart plural-synapse

echo "📊 Current Status:"
if grep -q "^modules:" "$CONFIG_FILE"; then
    echo "GATEKEEPER: ENABLED (Zero-Flash Path)"
else
    echo "GATEKEEPER: DISABLED (Backup/Janitor Path)"
fi
