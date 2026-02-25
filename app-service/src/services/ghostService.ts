import { getBridge, cryptoManager } from '../bot';
import { sendEncryptedEvent } from '../crypto/encryption';

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
}

export const sendGhostMessage = async (options: GhostMessageOptions) => {
    const { roomId, cleanContent, system, member, asToken } = options;
    
    try {
        const bridge = getBridge();
        if (!bridge) {
            console.error("[GhostService] Bridge not initialized!");
            return;
        }

        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
        console.log(`[GhostService] Sending ghost message as ${ghostUserId}`);
        
        const intent = bridge.getIntent(ghostUserId);
        
        try { 
            await intent.ensureRegistered(); 
        } catch(e: any) {
            if (e.errcode !== 'M_USER_IN_USE') {
                console.error("[GhostService] Registration error:", e.message);
            }
        }
        
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
        
        // USE sendEncryptedEvent for ghosts too
        await sendEncryptedEvent(intent, roomId, "m.room.message", {
            msgtype: "m.text",
            body: cleanContent
        }, cryptoManager, asToken);

        console.log(`[GhostService] Ghost message sent!`);
    } catch (e: any) { 
        console.error("[GhostService] Error:", e.message || e);
        throw e;
    }
};
