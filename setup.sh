#!/bin/bash

# PluralMatrix Automated Setup Script 🚀
set -e

# Helper to generate random hex strings
gen_token() {
    openssl rand -hex 32
}

echo "🌌 Welcome to the PluralMatrix Setup Wizard!"
echo "This script will generate secure tokens and configure your environment."
echo ""

# 1. Gather Basic Info
read -p "Enter your Matrix Domain [localhost]: " DOMAIN
DOMAIN=${DOMAIN:-localhost}

read -p "Enter a password for the Postgres Database [random]: " PG_PASS
if [ -z "$PG_PASS" ]; then
    PG_PASS=$(gen_token)
fi

echo "🛡️ Generating secure tokens..."
AS_TOKEN=$(gen_token)
HS_TOKEN=$(gen_token)
JWT_SECRET=$(gen_token)
REG_SECRET=$(gen_token)
MACAROON_SECRET=$(gen_token)
FORM_SECRET=$(gen_token)

# 2. Configure .env
echo "📝 Configuring .env..."
cp .env.example .env
sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PASS/" .env
sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql://synapse:$PG_PASS@postgres:5432/plural_db|" .env
sed -i "s/SYNAPSE_SERVER_NAME=.*/SYNAPSE_SERVER_NAME=$DOMAIN/" .env
sed -i "s/AS_TOKEN=.*/AS_TOKEN=$AS_TOKEN/" .env
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env

# 3. Configure Synapse (homeserver.yaml)
echo "🌌 Configuring homeserver.yaml..."
mkdir -p synapse/config
cp synapse/config/homeserver.yaml.example synapse/config/homeserver.yaml
sed -i "s/server_name: \".*\"/server_name: \"$DOMAIN\"/" synapse/config/homeserver.yaml
sed -i "s/registration_shared_secret: \"REPLACE_ME\"/registration_shared_secret: \"$REG_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/macaroon_secret_key: \"REPLACE_ME\"/macaroon_secret_key: \"$MACAROON_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/form_secret: \"REPLACE_ME\"/form_secret: \"$FORM_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/as_token: \"secret_token\"/as_token: \"$AS_TOKEN\"/" synapse/config/homeserver.yaml

# 4. Configure App Service Registration
echo "🔑 Configuring app-service-registration.yaml..."
cp synapse/config/app-service-registration.yaml.example synapse/config/app-service-registration.yaml
sed -i "s/id: .*/id: pluralmatrix/" synapse/config/app-service-registration.yaml
sed -i "s/as_token: .*/as_token: $AS_TOKEN/" synapse/config/app-service-registration.yaml
sed -i "s/hs_token: .*/hs_token: $HS_TOKEN/" synapse/config/app-service-registration.yaml

# 5. Generate Signing Key
echo "✒️ Generating Synapse signing key..."
sudo docker run -it --rm -v "$(pwd)/synapse/config:/data" \
    -e SYNAPSE_SERVER_NAME=$DOMAIN \
    matrixdotorg/synapse:latest generate

# 6. Finalize project name in scripts
PROJECT_NAME=$(basename "$(pwd)")
echo "🏷️ Setting project name to: $PROJECT_NAME"
sed -i "s/^PROJECT_NAME=.*/PROJECT_NAME=\"$PROJECT_NAME\"/" restart-stack.sh

echo ""
echo "✅ Setup Complete!"
echo "--------------------------------------------------------"
echo "🚀 NEXT STEPS:"
echo "1. Start the stack: ./restart-stack.sh"
echo "2. Register the decrypter: sudo docker exec plural-synapse register_new_matrix_user -c /data/homeserver.yaml -u plural_decrypter -p decrypter_password --admin http://localhost:8008"
echo ""
echo "⚙️ MIGRATION TO EXISTING SYNAPSE INSTALL:"
echo "If you want to use PluralMatrix with your existing Synapse install, you must:"
echo ""
echo "  A. COPY REGISTRATION: Move 'synapse/config/app-service-registration.yaml' to your server"
echo "     and add it to your homeserver.yaml 'app_service_config_files' list."
echo ""
echo "  B. INSTALL MODULE: Copy 'synapse/modules/plural_gatekeeper.py' to your Synapse 'modules' folder."
echo ""
echo "  C. UPDATE CONFIG: Add this to your existing homeserver.yaml:"
echo "     modules:"
echo "       - module: plural_gatekeeper.PluralGatekeeper"
echo "         config:"
echo "           service_url: \"http://<YOUR_APP_SERVICE_IP>:9000/check\""
echo "           as_token: \"$AS_TOKEN\""
echo "--------------------------------------------------------"
