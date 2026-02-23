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

### 1. Generate Secure Tokens
You will need several unique random strings for security. You can generate them using this command (run it multiple times to get different values):
```bash
openssl rand -hex 32
```

### 2. Configure Files
Follow this mapping carefully to ensure all services can communicate. **Warning:** If these don't match, Synapse or the App Service will fail to start.

#### Secret Mapping Table

| Token Purpose | Value Needed In... |
| :--- | :--- |
| **App Service Identity** | `synapse/config/app-service-registration.yaml` (`as_token`) **AND** `.env` (`AS_TOKEN`) **AND** `synapse/config/homeserver.yaml` (`modules -> config -> as_token`) |
| **Homeserver Identity** | `synapse/config/app-service-registration.yaml` (`hs_token`) |
| **User Registration** | `synapse/config/homeserver.yaml` (`registration_shared_secret`) |
| **Dashboard Security** | `.env` (`JWT_SECRET`) |
| **Internal Synapse Secrets** | `synapse/config/homeserver.yaml` (`macaroon_secret_key`, `form_secret`) |

#### Step-by-Step Configuration

1.  **Environment Variables**: 
    `cp .env.example .env` 
    *   Fill in `AS_TOKEN` and `JWT_SECRET` with fresh random hex strings.
    *   Set a secure `POSTGRES_PASSWORD`.
2.  **Synapse Config**: 
    `cp synapse/config/homeserver.yaml.example synapse/config/homeserver.yaml`
    *   Replace all `"REPLACE_ME"` tokens with unique random hex strings.
    *   Ensure the `as_token` under `modules -> config` matches the `AS_TOKEN` in your `.env`.
3.  **App Service Registration**: 
    `cp synapse/config/app-service-registration.yaml.example synapse/config/app-service-registration.yaml`
    *   `id`: Choose a unique string (e.g., `pluralmatrix`).
    *   `as_token`: **Must match** the one in `.env` and `homeserver.yaml`.
    *   `hs_token`: Use a fresh random hex string.
4.  **Signing Key**:
    Synapse requires a signing key. Generate it using the Docker image:
    ```bash
    sudo docker run -it --rm -v $(pwd)/synapse/config:/data matrixdotorg/synapse:latest generate
    ```

### 3. Launch the Stack
Use the helper script to build and launch everything:
```bash
./restart-stack.sh
```

### 4. Register the Decrypter User
The decrypter ghost needs a standard user account to log into Pantalaimon:
```bash
sudo docker exec plural-synapse register_new_matrix_user -c /data/homeserver.yaml -u plural_decrypter -p decrypter_password --admin http://localhost:8008
```

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
```bash
cd app-service && npm test
```
The suite includes full E2E roundtrips for both **plaintext** and **encrypted** rooms.

## Troubleshooting
* **Logs:** `sudo docker logs -f plural-app-service`
* **Synapse Logs:** `sudo docker logs -f plural-synapse`
* **Pantalaimon Logs:** `sudo docker logs -f plural-pantalaimon`
* **Permission Issues:** If Synapse fails to write config, run: `sudo chown -R 991:991 synapse/config`
