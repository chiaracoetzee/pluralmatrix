# PluralMatrix: Developer Notes 🌌

## Stack Management

Since `docker-compose` can be unreliable in this environment (due to `ContainerConfig` errors), use the helper script to rebuild and restart the services.

### Restart the Stack
Run this from the project root:
```bash
./restart-stack.sh
```
This will:
1. Rebuild the App Service (TypeScript code).
2. Manually launch the container with correct network and volume mappings.
3. Restart Synapse to refresh the Python Gatekeeper module.

## Database Seeding
To reset or seed the test system:
```bash
sudo docker exec -it plural-app-service npx ts-node seed-db.ts
```

## Troubleshooting
* **Logs:** `sudo docker logs -f plural-app-service`
* **Synapse Logs:** `sudo docker logs -f plural-synapse`
* **Permission Issues:** If Synapse crashes on boot, run:
  `sudo chown -R 991:991 synapse/config`
