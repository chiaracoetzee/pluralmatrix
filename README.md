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

## Visuals

### High-Fidelity Proxying
Seamless, "Zero-Flash" proxying in action within the Cinny Matrix client.
![Chat](docs/screenshots/chat.png)

### PluralMatrix Dashboard
The central hub for managing your system and members.
![Dashboard](docs/screenshots/dashboard.png)

### Member Editor
Detailed management of member profiles, proxy tags, and custom colors.
![Editor](docs/screenshots/editor.png)

## Architecture

*   **Synapse (Homeserver):** The core Matrix server (`port 8008`).
*   **Gatekeeper Module (Python):** Intercepts plaintext events synchronously for "Zero-Flash" cleanup.
*   **App Service (Node.js):** 
    *   **Bridge:** Connects directly to Synapse for maximum performance in plaintext rooms.
    *   **Decrypter Sidecar:** A separate client session connected to **Pantalaimon** (`port 8010`) that specifically observes and decrypts E2EE channels.
*   **Pantalaimon:** An E2EE-aware reverse proxy that manages keys and decryption for the Sidecar.
*   **PostgreSQL:** Persistent storage for systems, members, and proxy rules.

## Setup & Installation

### 1. Run the Setup Wizard
The easiest way to get started is using the automated setup script. It will generate all secure tokens and configure your `.env`, `homeserver.yaml`, and app-service registration files automatically.

```bash
./setup.sh
```

### 2. Launch the Stack
Once the setup is complete, use the helper script to build and launch the 5 core services (Synapse, Postgres, App Service, Pantalaimon, and the Gatekeeper):
```bash
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

### 1. Invite the Bot
**IMPORTANT:** You must manually `/invite @plural_bot:localhost` to every room you want it to operate in (both plaintext and encrypted).

### 2. Commands
*   `pk;list` - List all members in your system.
*   `pk;member <id>` - Show detailed info for a specific member.

### Proxying
Simply send a message with your configured member tags (e.g., `[Name] Message`). 
*   **In Plaintext Rooms:** Proxying is invisible and instant.
*   **In E2EE Rooms:** Ensure the bot is invited. On the first encrypted message, the bot will invite the Decrypter Ghost. Once the ghost joins and syncs (a few seconds), proxying will begin.

## Development & Testing

### Running Tests
Standard unit and E2E tests can be run via npm:
```bash
cd app-service && npm test
```
The suite includes full E2E roundtrips for both **plaintext** and **encrypted** rooms.

## Troubleshooting
* **Logs:** `sudo docker logs -f <PROJECT_NAME>_app-service`
* **Synapse Logs:** `sudo docker logs -f <PROJECT_NAME>_synapse`
* **Pantalaimon Logs:** `sudo docker logs -f <PROJECT_NAME>_pantalaimon`
* **Restart:** `./restart-stack.sh`
* **Stop (Safe):** `./stop-stack.sh`
* **Permission Issues:** If Synapse fails to write config, run: `sudo chown -R 991:991 synapse/config`
