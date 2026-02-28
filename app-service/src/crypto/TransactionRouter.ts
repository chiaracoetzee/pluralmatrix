import { OlmMachineManager } from "./OlmMachineManager";
import { OlmMachine, UserId, RoomId, DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { maskMxid } from "../utils/privacy";

// Minimal event interface
interface MatrixEvent {
    type: string;
    sender: string;
    room_id?: string;
    content: any;
    event_id?: string;
    to_user_id?: string; // For to-device events in AS transactions (MSC2409)
    [key: string]: any;
}

interface TransactionBody {
    events: MatrixEvent[];
    "de.sorunome.msc2409.ephemeral"?: MatrixEvent[];
    "org.matrix.msc2409.ephemeral"?: MatrixEvent[];
    ephemeral?: MatrixEvent[];
    "de.sorunome.msc2409.to_device"?: MatrixEvent[];
    "org.matrix.msc3202.to_device"?: MatrixEvent[];
    to_device?: MatrixEvent[];
    [key: string]: any;
}

export class TransactionRouter {
    private manager: OlmMachineManager;
    private botUserId: string;
    private onRequestCallback: (userId: string) => Promise<void>;
    private onDecryptedEvent: (event: any) => Promise<void>;

    constructor(
        manager: OlmMachineManager, 
        botUserId: string, 
        onRequestCallback: (userId: string) => Promise<void>,
        onDecryptedEvent: (event: any) => Promise<void>
    ) {
        this.manager = manager;
        this.botUserId = botUserId;
        this.onRequestCallback = onRequestCallback;
        this.onDecryptedEvent = onDecryptedEvent;
    }

    async processTransaction(transaction: TransactionBody) {
        // --- STEP 1: Process To-Device/Ephemeral Events FIRST ---
        const toDeviceEvents: MatrixEvent[] = [
            ...(transaction.to_device || []),
            ...(transaction["org.matrix.msc3202.to_device"] || []),
            ...(transaction["de.sorunome.msc2409.to_device"] || []),
            ...(transaction.ephemeral || []),
            ...(transaction["org.matrix.msc2409.ephemeral"] || []),
            ...(transaction["de.sorunome.msc2409.ephemeral"] || []),
        ];

        const processedUsers = new Set<string>();

        if (toDeviceEvents.length > 0) {
            console.log(`[Router] Transaction Step 1: Processing ${toDeviceEvents.length} to-device/ephemeral events...`);
            for (const event of toDeviceEvents) {
                if (event.to_user_id) {
                    await this.routeToDeviceEvent(event);
                    processedUsers.add(event.to_user_id);
                }
            }

            // Sync database/requests for all users who received keys
            for (const userId of processedUsers) {
                await this.onRequestCallback(userId);
            }
        }

        // --- STEP 2: Process Timeline Events (PDUs) SECOND ---
        if (transaction.events && Array.isArray(transaction.events)) {
            for (const event of transaction.events) {
                if (event.type === "m.room.encrypted" && event.room_id) {
                    await this.routeTimelineEventToBot(event);
                }
            }
            
            // If the bot decrypted anything, it might have new requests
            if (transaction.events.some(e => e.type === "m.room.encrypted")) {
                await this.onRequestCallback(this.botUserId);
            }
        }
    }

    private async routeTimelineEventToBot(event: MatrixEvent) {
        try {
            // Attempting decryption of room event
            const machine = await this.manager.getMachine(this.botUserId);
            
            const eventJson = JSON.stringify(event);
            const roomId = new RoomId(event.room_id!);
            const decrypted = await machine.decryptRoomEvent(eventJson, roomId);
            
            if (decrypted.event) {
                // Decryption successful: Processing cleartext event
                const clearEvent = JSON.parse(decrypted.event);
                clearEvent.room_id = event.room_id;
                clearEvent.event_id = event.event_id;
                clearEvent.sender = event.sender;
                await this.onDecryptedEvent(clearEvent);
            }
        } catch (e) {
            console.error(`[Router] DECRYPTION FAILURE for ${event.event_id}:`, e);
            
            // Trigger a tracking nudge for the bot to discover this sender's keys if decryption fails
            try {
                const machine = await this.manager.getMachine(this.botUserId);
                await machine.updateTrackedUsers([new UserId(event.sender)]);
                await this.onRequestCallback(this.botUserId);
            } catch (nudgeErr) {
                // Ignore nudge failures
            }
        }
    }

    private async routeToDeviceEvent(event: MatrixEvent) {
        const targetUserId = event.to_user_id!;
        try {
            const machine = await this.manager.getMachine(targetUserId);
            const clientEvent = { ...event };
            delete clientEvent.to_user_id;

            const toDeviceEventsJson = JSON.stringify([clientEvent]);
            
            await machine.receiveSyncChanges(
                toDeviceEventsJson, 
                new DeviceLists(), 
                {}, 
                []
            );
        } catch (e) {
             console.error(`[Router] Failed to route to-device event to ${maskMxid(targetUserId)}:`, e);
        }
    }
}
