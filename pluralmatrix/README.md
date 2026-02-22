# PluralMatrix 🌌

A high-performance Matrix Application Service for Plurality, featuring **"Zero Flash"** message proxying via a synchronous Synapse Gatekeeper module.

## Architecture

*   **Synapse (Homeserver):** Runs the core chat server.
*   **Gatekeeper Module (Python):** Intercepts messages *before* they are saved. It asks the App Service if the message should be proxied.
*   **App Service (Node.js):**
    *   **Brain:** Checks if a message matches a member's proxy tags.
    *   **Bridge:** Controls "Ghost" users (`@_plural_...`) to send messages on behalf of members.
    *   **Database:** PostgreSQL (stores Systems, Members, and Tags).

## Getting Started

### 1. Start the Stack
```bash
cd pluralmatrix
sudo docker-compose up -d
# Note: If the app-service fails, run: sudo docker start plural-app-service
```

### 2. Create an Admin User
You need a Matrix account to test this. Run this command to register a user on your new local server:

```bash
sudo docker exec -it plural-synapse register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008
# Follow the prompts. Make the user admin.
# Example User: @admin:localhost
```

### 3. Seed the Database
Since the Web UI is not fully connected yet, use this script to create a test System and Member for your new user.

1.  Edit `pluralmatrix/app-service/seed-db.ts` and change `OWNER_ID` to match the user you just created (e.g., `@admin:localhost`).
2.  Run the seed script:
    ```bash
    # You need to run this inside the container or have node installed locally
    # Easiest way is inside the container:
    sudo docker exec -it plural-app-service npx ts-node seed-db.ts
    ```

### 4. Test It!
1.  Open a Matrix Client (e.g., [Element Web](https://app.element.io)).
2.  Change the Homeserver URL to `http://localhost:8008` (if running locally) or your server's IP.
3.  Log in as `@admin:localhost`.
4.  Join a room (or create one).
5.  Type: `[Lily] Hello world`
6.  **Magic:** You should see **Lily 🌸** say "Hello world" instantly. Your original message will never appear.

## Troubleshooting
*   **Logs:** `sudo docker logs plural-app-service`
*   **Restart:** `sudo docker-compose restart`
