#!/bin/bash

# PluralMatrix Automated Setup Script 🚀
set -e

# Helper to generate random hex strings
gen_token() {
    openssl rand -hex 32
}

# 0. Initialise project name (Replace underscores with dashes for Synapse hostname compatibility)
PROJECT_NAME=$(basename "$(pwd)" | tr '_' '-')

echo "🌌 Welcome to the PluralMatrix Setup Wizard ($PROJECT_NAME)!"
echo "This script will generate secure tokens and configure your environment."
echo ""

# 1. Gather Basic Info
read -p "Enter your Matrix Domain [localhost]: " DOMAIN
DOMAIN=${DOMAIN:-localhost}

read -p "Enter a password for the Postgres Database [random]: " PG_PASS
if [ -z "$PG_PASS" ]; then
    PG_PASS=$(gen_token)
fi

echo "🛡️ Generating secure tokens and passwords..."
AS_TOKEN=$(gen_token)
HS_TOKEN=$(gen_token)
JWT_SECRET=$(gen_token)
REG_SECRET=$(gen_token)
MACAROON_SECRET=$(gen_token)
FORM_SECRET=$(gen_token)
DECRYPTER_PASS=$(gen_token)

# 2. Configure .env
echo "📝 Configuring .env..."
cp .env.example .env
sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PASS/" .env
sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql://plural_app:$PG_PASS@${PROJECT_NAME}-postgres:5432/plural_db|" .env
sed -i "s/SYNAPSE_SERVER_NAME=.*/SYNAPSE_SERVER_NAME=$DOMAIN/" .env
sed -i "s/AS_TOKEN=.*/AS_TOKEN=$AS_TOKEN/" .env
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
sed -i "s/DECRYPTER_PASSWORD=.*/DECRYPTER_PASSWORD=$DECRYPTER_PASS/" .env

# 3. Configure Synapse (homeserver.yaml)
echo "🌌 Configuring homeserver.yaml..."
mkdir -p synapse/config
cp synapse/config/homeserver.yaml.example synapse/config/homeserver.yaml
sed -i "s/server_name: \".*\"/server_name: \"$DOMAIN\"/" synapse/config/homeserver.yaml
sed -i "s/registration_shared_secret: \"REPLACE_ME\"/registration_shared_secret: \"$REG_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/macaroon_secret_key: \"REPLACE_ME\"/macaroon_secret_key: \"$MACAROON_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/form_secret: \"REPLACE_ME\"/form_secret: \"$FORM_SECRET\"/" synapse/config/homeserver.yaml
sed -i "s/as_token: \"secret_token\"/as_token: \"$AS_TOKEN\"/" synapse/config/homeserver.yaml
sed -i "s/app-service:9000/${PROJECT_NAME}-app-service:9000/" synapse/config/homeserver.yaml

# 4. Configure App Service Registration
echo "🔑 Configuring app-service-registration.yaml..."
cp synapse/config/app-service-registration.yaml.example synapse/config/app-service-registration.yaml
sed -i "s/id: .*/id: ${PROJECT_NAME}/" synapse/config/app-service-registration.yaml
sed -i "s/as_token: .*/as_token: $AS_TOKEN/" synapse/config/app-service-registration.yaml
sed -i "s/hs_token: .*/hs_token: $HS_TOKEN/" synapse/config/app-service-registration.yaml
sed -i "s|url: .*|url: http://${PROJECT_NAME}-app-service:8008|" synapse/config/app-service-registration.yaml

# 4.5 Configure Pantalaimon
echo "🛡️ Configuring pantalaimon.conf..."
sed -i "s/Password = .*/Password = $DECRYPTER_PASS/" pantalaimon/pantalaimon.conf
sed -i "s|Homeserver = .*|Homeserver = http://${PROJECT_NAME}-synapse:8008|" pantalaimon/pantalaimon.conf

# 5. Generate Signing Key
echo "✒️ Generating Synapse signing key..."
sudo docker run -it --rm -v "$(pwd)/synapse/config:/data" \
    -e SYNAPSE_SERVER_NAME=$DOMAIN \
    -e SYNAPSE_REPORT_STATS=no \
    matrixdotorg/synapse:latest generate

# 6. Finalize project name in scripts
echo "🏷️ Setting project name to: $PROJECT_NAME"
sed -i "s/^PROJECT_NAME=.*/PROJECT_NAME=\"$PROJECT_NAME\"/" restart-stack.sh
sed -i "s/^PROJECT_NAME=.*/PROJECT_NAME=\"$PROJECT_NAME\"/" stop-stack.sh

echo ""
echo "✅ Setup Complete!"
echo "--------------------------------------------------------"
echo "🚀 NEXT STEPS:"
echo "1. Start the stack: ./restart-stack.sh"
echo "2. Register the decrypter user:"
echo "   sudo docker exec ${PROJECT_NAME}-synapse register_new_matrix_user -c /data/homeserver.yaml -u plural_decrypter -p $DECRYPTER_PASS --admin http://localhost:8008"
echo "3. Seed the database (Optional):"
echo "   sudo docker exec -it ${PROJECT_NAME}-app-service npx ts-node seed-db.ts"
echo ""
echo "📊 VIEW LOGS:"
echo "   sudo docker logs -f ${PROJECT_NAME}-app-service"
echo "   sudo docker logs -f ${PROJECT_NAME}-synapse"
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
