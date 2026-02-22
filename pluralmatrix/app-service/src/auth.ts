import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';
const HOMESERVER_URL = process.env.SYNAPSE_URL || 'http://plural-synapse:8008';

export interface AuthRequest extends Request {
    user?: {
        mxid: string;
    };
}

/**
 * Middleware to protect routes with JWT
 */
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

/**
 * Logic to verify Matrix credentials against Synapse
 */
export const loginToMatrix = async (mxid: string, password: string): Promise<boolean> => {
    try {
        // Extract localpart if full MXID provided
        const localpart = mxid.startsWith('@') ? mxid.split(':')[0].substring(1) : mxid;

        const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v3/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'm.login.password',
                user: localpart,
                password: password
            })
        });

        if (response.ok) {
            return true;
        } else {
            const data = await response.json();
            console.warn(`[Auth] Login failed for ${mxid}:`, data.error);
            return false;
        }
    } catch (error) {
        console.error('[Auth] Error connecting to Synapse:', error);
        return false;
    }
};

/**
 * Generate a JWT for a verified user
 */
export const generateToken = (mxid: string) => {
    // Ensure we use the full MXID format and LOWERCASE it for consistency
    const domain = process.env.SYNAPSE_DOMAIN || 'localhost';
    let fullMxid = mxid.includes(':') ? mxid : `@${mxid}:${domain}`;
    if (!fullMxid.startsWith('@')) fullMxid = `@${fullMxid}`;
    
    return jwt.sign({ mxid: fullMxid.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' });
};
