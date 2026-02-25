import { OlmMachine, UserId, DeviceId } from "@matrix-org/matrix-sdk-crypto-nodejs";
import * as fs from "fs";
import * as path from "path";

export class OlmMachineManager {
    private machines: Map<string, OlmMachine> = new Map();
    private storageRoot: string;

    constructor(storageRoot: string = "./data/crypto") {
        this.storageRoot = storageRoot;
        if (!fs.existsSync(this.storageRoot)) {
            fs.mkdirSync(this.storageRoot, { recursive: true });
        }
    }

    async getMachine(userId: string): Promise<OlmMachine> {
        if (this.machines.has(userId)) {
            return this.machines.get(userId)!;
        }

        const sanitizedId = userId.replace(/[^a-zA-Z0-9]/g, "_");
        const storePath = path.join(this.storageRoot, sanitizedId);
        
        // Ensure store directory exists
        if (!fs.existsSync(storePath)) {
            fs.mkdirSync(storePath, { recursive: true });
        }

        const deviceId = new DeviceId("PLURAL_CTX_V4"); 

        console.log(`[Crypto] Initializing OlmMachine for ${userId} (Device: ${deviceId.toString()}) at ${storePath}`);
        const machine = await OlmMachine.initialize(new UserId(userId), deviceId, storePath);
        
        // Identity Keys are read-only properties
        const keys = machine.identityKeys;
        console.log(`[Crypto] Machine initialized for ${userId}. Identity: curve25519=${keys.curve25519.toString().substring(0,10)}...`);
        
        this.machines.set(userId, machine);
        return machine;
    }
}
