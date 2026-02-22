# PluralMatrix 🌌

A high-performance Matrix Application Service for Plurality, featuring **"Zero Flash"** message proxying via a synchronous Synapse Gatekeeper module.

## Architecture

*   **Synapse (Homeserver):** Runs the core chat server.
*   **Gatekeeper Module (Python):** Intercepts messages *before* they are saved. It asks the App Service if the message should be proxied. If so, it rewrites the original message to be blank.
*   **App Service (Node.js):**
    *   **Brain:** Checks if a message matches a member's proxy tags.
    *   **Bridge:** Controls "Ghost" users (`@_plural_...`) to send messages on behalf of members.
    *   **Janitor:** Automatically redacts the blanked-out original messages for a clean timeline.
    *   **Database:** PostgreSQL (stores Systems, Members, and Tags).

## Setup & Installation

### 1. Configure Secrets
PluralMatrix requires several configuration files that contain secrets. Templates are provided:

1.  **Environment Variables**: 
    `cp .env.example .env` and fill in your database passwords and Matrix domain.
2.  **Synapse Config**: 
    `cp pluralmatrix/synapse/config/homeserver.yaml.example pluralmatrix/synapse/config/homeserver.yaml`. 
    *Note: You must replace all "REPLACE_ME" tokens with secure strings.*
3.  **App Service Registration**: 
    `cp pluralmatrix/synapse/config/app-service-registration.yaml.example pluralmatrix/synapse/config/app-service-registration.yaml`.
    *Note: The tokens here must match what you put in your `.env` and `homeserver.yaml`.*
4.  **Signing Key**:
    Synapse requires a `localhost.signing.key`. If you don't have one, you can generate it using the Synapse image:
    `sudo docker run -it --rm -v $(pwd)/pluralmatrix/synapse/config:/data matrixdotorg/synapse:latest generate`

### 2. Start the Stack
Run the helper script to build and launch everything:
```bash
cd pluralmatrix
./restart-stack.sh
```

### 3. Create an Admin User
Register a user on your new local server:
```bash
sudo docker exec -it plural-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008
```

### 4. Seed the Database
```bash
sudo docker exec -it plural-app-service npx ts-node seed-db.ts
```

## Testing
1.  Open a Matrix Client (e.g., [Element](https://app.element.io) or [Cinny](https://app.cinny.in)).
2.  Connect to your server (e.g. `http://localhost:8008`).
3.  Invite `@plural_bot:localhost` to a room.
4.  Type: `[Lily] Hello world`
5.  **Result:** You should see **Lily 🌸** say "Hello world". Your original message will be blanked and then redacted.

## Troubleshooting
* **Logs:** `sudo docker logs -f plural-app-service`
* **Synapse Logs:** `sudo docker logs -f plural-synapse`
* **Restart:** `./restart-stack.sh`
