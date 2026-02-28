import { getBridge, cryptoManager } from '../bot';
import { sendEncryptedEvent } from '../crypto/encryption';
import { messageQueue } from './queue/MessageQueue';
import { registerDevice } from '../crypto/crypto-utils';

const DOMAIN = process.env.SYNAPSE_DOMAIN || "localhost";

export interface GhostMessageOptions {
    roomId: string;
    cleanContent: string;
    system: {
        slug: string;
        systemTag?: string | null;
    };
    member: {
        slug: string;
        name: string;
        displayName?: string | null;
        avatarUrl?: string | null;
    };
    asToken: string;
    senderId: string;
}

export const sendGhostMessage = async (options: GhostMessageOptions) => {
    const { roomId, cleanContent, system, member, asToken, senderId } = options;
    
    try {
        const bridge = getBridge();
        if (!bridge) {
            console.error("[GhostService] Bridge not initialized!");
            return;
        }

        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
        const intent = bridge.getIntent(ghostUserId);
        
        // Ensure ghost user is registered
        try { 
            await intent.ensureRegistered(); 
        } catch(e: any) {
            if (e.errcode !== 'M_USER_IN_USE') {
                console.error("[GhostService] Registration error:", e.message);
            }
        }

        // Ensure cryptographic device is registered before enqueueing
        const machine = await cryptoManager.getMachine(ghostUserId);
        await registerDevice(intent, machine.deviceId.toString());
        
        const finalDisplayName = system.systemTag 
            ? `${member.displayName || member.name} ${system.systemTag}`
            : (member.displayName || member.name);

        // Ensure ghost is in the room and has profile set
        try {
            await intent.sendStateEvent(roomId, "m.room.member", ghostUserId, {
                membership: "join",
                displayname: finalDisplayName,
                avatar_url: member.avatarUrl || undefined
            });
        } catch (joinError) {
            await intent.join(roomId);
            await intent.setDisplayName(finalDisplayName);
            if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
        }
        
        // Pass the prepared message into the Dead Letter Queue
        messageQueue.enqueue(roomId, senderId, intent, cleanContent);

    } catch (e: any) { 
        console.error("[GhostService] Error:", e.message || e);
        throw e;
    }
};
