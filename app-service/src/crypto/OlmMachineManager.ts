import { OlmMachine, UserId, DeviceId, RequestType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import * as fs from "fs";
import * as path from "path";
import { bootstrapCrossSigning, BootstrapResult } from "./CrossSigningBootstrapper";

export class OlmMachineManager {
    private machines: Map<string, OlmMachine> = new Map();
    private storageRoot: string;
    private bridge: any;
    private asToken: string | undefined;

    constructor(storageRoot: string = "./data/crypto") {
        this.storageRoot = storageRoot;
        if (!fs.existsSync(this.storageRoot)) {
            fs.mkdirSync(this.storageRoot, { recursive: true });
        }
    }

    setContext(bridge: any, asToken: string) {
        this.bridge = bridge;
        this.asToken = asToken;
    }

    async getMachine(userId: string): Promise<OlmMachine> {
        if (this.machines.has(userId)) {
            return this.machines.get(userId)!;
        }

        const sanitizedId = userId.replace(/[^a-zA-Z0-9]/g, "_");
        const storePath = path.join(this.storageRoot, sanitizedId);
        const deviceId = "PLURAL_CTX_V8"; 

        // Ensure store directory exists
        if (!fs.existsSync(storePath)) {
            fs.mkdirSync(storePath, { recursive: true });
        }

        // Automated Cross-Signing Bootstrapping via Rust Sidecar
        // Must happen BEFORE OlmMachine.initialize to avoid sqlite locks
        let bootstrapResult: BootstrapResult | null = null;
        if (this.bridge && this.asToken) {
            bootstrapResult = await bootstrapCrossSigning(
                userId,
                deviceId,
                storePath,
                this.bridge.getIntent(userId),
                this.asToken
            );
        }

        console.log(`[Crypto] Initializing OlmMachine for ${userId} (Device: ${deviceId}) at ${storePath}`);
        const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId), storePath);
        
        // Identity Keys are read-only properties
        const keys = machine.identityKeys;
        console.log(`[Crypto] Machine initialized for ${userId}. Identity: curve25519=${keys.curve25519.toString().substring(0,10)}...`);
        
        this.machines.set(userId, machine);
        return machine;
    }
}
