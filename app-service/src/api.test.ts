import request from 'supertest';
import { app } from './index';
import * as auth from './auth';
import { prisma } from './bot';

// Mock auth functions
jest.mock('./auth', () => ({
    ...jest.requireActual('./auth'),
    loginToMatrix: jest.fn(),
}));

// Mock Prisma
jest.mock('./bot', () => ({
    ...jest.requireActual('./bot'),
    prisma: {
        system: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
        },
        member: {
            findMany: jest.fn(),
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
        },
        accountLink: {
            findUnique: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
            findMany: jest.fn(),
        }
    },
}));

// Mock Import module (for decommissionGhost and syncGhostProfile)
jest.mock('./import', () => ({
    importFromPluralKit: jest.fn(),
    syncGhostProfile: jest.fn(),
    decommissionGhost: jest.fn(),
}));

describe('API Endpoints', () => {
    const mockMxid = '@chiara:localhost';
    const mockToken = auth.generateToken(mockMxid);

    describe('POST /api/auth/login', () => {
        it('should return 200 and a token on valid login', async () => {
            (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });

            const response = await request(app)
                .post('/api/auth/login')
                .send({ mxid: mockMxid, password: 'password' });

            expect(response.status).toBe(200);
            expect(response.body.token).toBeDefined();
        });
    });

    describe('Member CRUD API', () => {
        const authHeader = { 'Authorization': `Bearer ${mockToken}` };

        it('GET /api/members should return member list', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                system: {
                    members: [{ id: 'm1', name: 'Lily' }]
                }
            });

            const response = await request(app)
                .get('/api/members')
                .set(authHeader);

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0].name).toBe('Lily');
        });

        it('POST /api/members should create a new member with all fields', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ 
                system: { id: 'sys1', systemTag: 'Tag' } 
            });
            (prisma.member.create as jest.Mock).mockResolvedValue({ 
                id: 'm2', 
                name: 'John',
                description: 'A test user',
                pronouns: 'He/Him',
                color: 'ff0000'
            });

            const response = await request(app)
                .post('/api/members')
                .set(authHeader)
                .send({ 
                    name: 'John', 
                    proxyTags: [],
                    description: 'A test user',
                    pronouns: 'He/Him',
                    color: 'ff0000'
                });

            expect(response.status).toBe(200);
            expect(response.body.description).toBe('A test user');
            expect(response.body.pronouns).toBe('He/Him');
            expect(response.body.color).toBe('ff0000');
        });

        it('PATCH /api/members/:id should update existing member', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.member.findFirst as jest.Mock).mockResolvedValue({ id: 'm1', systemId: 'sys1' });
            (prisma.member.update as jest.Mock).mockResolvedValue({ id: 'm1', name: 'Lily Updated' });

            const response = await request(app)
                .patch('/api/members/m1')
                .set(authHeader)
                .send({ name: 'Lily Updated' });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Lily Updated');
        });

        it('DELETE /api/members/:id should remove member', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.member.findFirst as jest.Mock).mockResolvedValue({ id: 'm1', systemId: 'sys1', system: { id: 'sys1' } });

            const response = await request(app)
                .delete('/api/members/m1')
                .set(authHeader);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('DELETE /api/members (Bulk) should remove all members', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.member.findMany as jest.Mock).mockResolvedValue([{ id: 'm1', systemId: 'sys1', system: { id: 'sys1' } }]);

            const response = await request(app)
                .delete('/api/members')
                .set(authHeader);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(prisma.member.deleteMany).toHaveBeenCalled();
        });

        it('should return 404 if member of another system', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.member.findFirst as jest.Mock).mockResolvedValue(null);

            const response = await request(app)
                .delete('/api/members/m1')
                .set(authHeader);

            expect(response.status).toBe(404);
        });
    });

    describe('System Settings API', () => {
        const authHeader = { 'Authorization': `Bearer ${mockToken}` };

        it('GET /api/system should return system details', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                system: { id: 'sys1', name: 'My System' }
            });

            const response = await request(app)
                .get('/api/system')
                .set(authHeader);

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('My System');
        });

        it('PATCH /api/system should update system details', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ systemId: 'sys1' });
            (prisma.system.findUnique as jest.Mock).mockResolvedValue({ id: 'sys1' });
            (prisma.system.update as jest.Mock).mockResolvedValue({ id: 'sys1', name: 'New Name' });

            const response = await request(app)
                .patch('/api/system')
                .set(authHeader)
                .send({ name: 'New Name' });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('New Name');
            expect(prisma.system.update).toHaveBeenCalled();
        });
    });
});
