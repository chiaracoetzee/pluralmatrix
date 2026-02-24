# PluralMatrix: Developer Notes 🌌

## Git Mandate
* **NEVER** commit and push to GitHub without stopping and asking for explicit permission first.

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
sudo docker exec -it pluralmatrix-app-service npx ts-node seed-db.ts
```

## Testing

When running `npm test` within the App Service, always redirect stdout and stderr to a temporary file and then `cat` it to avoid hanging issues in the Gemini CLI:
```bash
cd app-service && npm test > test_output.log 2>&1; cat test_output.log
```

## Troubleshooting
* **Logs:** `sleep 5 && sudo docker logs pluralmatrix-app-service --tail 50` (Never use -f!)
* **Synapse Logs:** `sudo docker logs pluralmatrix-synapse --tail 50`
* **Permission Issues:** If Synapse crashes on boot, run:
  `sudo chown -R 991:991 synapse/config`
