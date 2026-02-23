import { MatrixClient, MemoryStorageProvider } from "@vector-im/matrix-bot-sdk";
import { getBridge, handleEvent, prisma } from "../bot";

const PANTALAIMON_URL = process.env.PANTALAIMON_URL || "http://plural-pantalaimon:8010";
const DECRYPTER_USER = "plural_decrypter";
const DECRYPTER_PASS = process.env.DECRYPTER_PASSWORD || "decrypter_password";

export class DecrypterService {
    private client: MatrixClient | null = null;
    private processedEventIds = new Set<string>();
    private lastProcessedTs = Date.now();
    private encryptedRoomCache = new Map<string, boolean>();

    async start() {
        console.log("[Decrypter] Initialising Decryption Sidecar via Pantalaimon...");
        
        try {
            // 1. Login manually to get token
            const loginRes = await fetch(`${PANTALAIMON_URL}/_matrix/client/v3/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: "m.login.password",
                    identifier: { type: "m.id.user", user: DECRYPTER_USER },
                    password: DECRYPTER_PASS,
                    initial_device_display_name: "DECRYPTER_SIDECAR"
                })
            });

            if (!loginRes.ok) {
                throw new Error(`Login failed: ${loginRes.status}`);
            }

            const { access_token } = await loginRes.json() as any;
            
            // 2. Setup Client with memory storage
            this.client = new MatrixClient(PANTALAIMON_URL, access_token, new MemoryStorageProvider());
            
            // 3. Register Event Listeners
            this.client.on("room.event", async (roomId: string, event: any) => {
                await this.processDecryptedEvent(roomId, event);
            });

            this.client.on("room.invite", async (roomId: string, event: any) => {
                console.log(`[Decrypter] Invited to ${roomId}. Joining for E2EE support...`);
                await this.client?.joinRoom(roomId);
                this.encryptedRoomCache.delete(roomId);
            });

            console.log("[Decrypter] Sidecar started. SDK Sync Loop beginning...");
            await this.client.start();
        } catch (e: any) {
            console.error("[Decrypter] Failed to start:", e.message);
            // Retry in 30s
            setTimeout(() => this.start(), 30000);
        }
    }

    private async isRoomEncrypted(roomId: string): Promise<boolean> {
        if (this.encryptedRoomCache.has(roomId)) {
            return this.encryptedRoomCache.get(roomId)!;
        }

        try {
            // Manually check if room is encrypted by looking for m.room.encryption state
            const state = await this.client?.getRoomStateEvent(roomId, "m.room.encryption", "");
            const isEncrypted = !!state;
            this.encryptedRoomCache.set(roomId, isEncrypted);
            return isEncrypted;
        } catch (e: any) {
            // If the state event doesn't exist, it returns 404 (not encrypted)
            this.encryptedRoomCache.set(roomId, false);
            return false;
        }
    }

    private async processDecryptedEvent(roomId: string, event: any) {
        const eventId = event.event_id;
        const ts = event.origin_server_ts;
        if (!eventId || !ts) return;

        // --- 1. DEDUPLICATION ---
        if (this.processedEventIds.has(eventId)) return;
        this.processedEventIds.add(eventId);

        // --- 2. FORWARD-ONLY FILTER ---
        if (ts < this.lastProcessedTs) return;
        this.lastProcessedTs = ts;

        // --- 3. ENCRYPTION FILTER ---
        const isEncrypted = await this.isRoomEncrypted(roomId);
        if (!isEncrypted) return;

        // --- 4. TYPE FILTER ---
        if (event.type === "m.room.message" && event.content?.body) {
            console.log(`[Decrypter] Decrypted: [${roomId}] <${event.sender}> ${event.content.body.substring(0, 20)}...`);
            
            const fakeRequest = {
                getData: () => ({ ...event, room_id: roomId })
            };

            const bridge = getBridge();
            if (bridge) {
                try {
                    await handleEvent(fakeRequest as any, undefined, bridge, prisma);
                } catch (e: any) {
                    console.error(`[Decrypter] Error in handleEvent:`, e.message);
                }
            }
        }
    }

    getClient() {
        return this.client;
    }
}

export const decrypterService = new DecrypterService();
