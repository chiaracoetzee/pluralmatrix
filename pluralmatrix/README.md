# PluralMatrix 🌌

A high-performance Matrix Application Service for Plurality, featuring **"Zero-Flash"** high-fidelity message proxying and **Hybrid E2EE support**.

## Core Features

*   **Zero-Flash Proxying:** Intercepts messages in plaintext rooms *before* they are saved to the database via a synchronous Synapse module. No "flicker" of original text.
*   **Hybrid E2EE Support:** Uses a dedicated **Decrypter Sidecar** via Pantalaimon to handle encrypted rooms. 
*   **Auto-Invite/Join:** The bot automatically invites the Decrypter Ghost upon detecting encryption; the ghost joins and syncs keys instantly.
*   **High-Fidelity Data:**
    *   **Reply Preservation:** Proxied messages correctly maintain relationships to original reply threads (`m.relates_to`).
    *   **Full Slug Support:** 1:1 roundtrip integrity for member and system slugs (no truncation).
*   **Performance:**
    *   **In-Memory Caching:** Fast proxy rule lookups with active invalidation on data changes.
    *   **Deduplication:** Robust event handling prevents double-processing across bridge and sidecar layers.
*   **Security:** Enforced Zod schema validation and mandatory secret management (JWT, tokens).

## Architecture

*   **Synapse (Homeserver):** The core Matrix server (`port 8008`).
*   **Gatekeeper Module (Python):** Intercepts plaintext events synchronously for "Zero-Flash" cleanup.
*   **App Service (Node.js):** 
    *   **Bridge:** Connects directly to Synapse for maximum performance in plaintext rooms.
    *   **Decrypter Sidecar:** A separate client session connected to **Pantalaimon** (`port 8010`) that specifically observes and decrypts E2EE channels.
*   **Pantalaimon:** An E2EE-aware reverse proxy that manages keys and decryption for the Sidecar.
*   **PostgreSQL:** Persistent storage for systems, members, and proxy rules.

## Setup & Installation

### 1. Configure Secrets
1.  **Environment Variables**: 
    `cp .env.example .env` and fill in `POSTGRES_PASSWORD`, `AS_TOKEN`, `HS_TOKEN`, and `JWT_SECRET`.
2.  **Synapse Config**: 
    `cp pluralmatrix/synapse/config/homeserver.yaml.example pluralmatrix/synapse/config/homeserver.yaml`. 
    *Note: Replace all "REPLACE_ME" tokens.*
3.  **App Service Registration**: 
    `cp pluralmatrix/synapse/config/app-service-registration.yaml.example pluralmatrix/synapse/config/app-service-registration.yaml`.
    *Note: Ensure tokens match your `.env`.*

### 2. Launch the Stack
The stack includes 5 services (Synapse, Postgres, App Service, Pantalaimon, and the Gatekeeper). Use the helper script to ensure clean volume mapping:
```bash
cd pluralmatrix
./restart-stack.sh
```

### 3. Register the Decrypter User
The decrypter ghost needs a standard user account to log into Pantalaimon:
```bash
sudo docker exec plural-synapse register_new_matrix_user -c /data/homeserver.yaml -u plural_decrypter -p decrypter_password --admin http://localhost:8008
```

### 4. Port Reference
*   **9000:** App Service Brain (Dashboard API)
*   **8008:** Matrix Client API (Direct Synapse)
*   **8010:** Decrypter Sidecar Proxy (Pantalaimon)

## Usage

### Commands
*   `pk;list` - List all members in your system.
*   `pk;member <id>` - Show detailed info for a specific member.

### Proxying
Simply send a message with your configured member tags (e.g., `[Name] Message`). 
*   **In Plaintext Rooms:** Proxying is invisible and instant.
*   **In E2EE Rooms:** Ensure the bot is invited. On the first encrypted message, the bot will invite the Decrypter Ghost. Once the ghost joins and syncs (a few seconds), proxying will begin.

## Development & Testing

### Running Tests
To avoid CLI hangs, always pipe output to a log file:
```bash
cd pluralmatrix/app-service
npm test > test_output.log 2>&1; cat test_output.log
```
The suite includes full E2E roundtrips for both **plaintext** and **encrypted** rooms.

## Troubleshooting
* **Logs:** `sudo docker logs -f plural-app-service`
* **Synapse Logs:** `sudo docker logs -f plural-synapse`
* **Pantalaimon Logs:** `sudo docker logs -f plural-pantalaimon`
* **Permission Issues:** If Synapse fails to write config, run: `sudo chown -R 991:991 synapse/config`
