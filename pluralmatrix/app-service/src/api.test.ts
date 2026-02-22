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
        },
        member: {
            findMany: jest.fn(),
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

describe('API Endpoints', () => {
    const mockMxid = '@chiara:localhost';
    const mockToken = auth.generateToken(mockMxid);

    describe('POST /api/auth/login', () => {
        it('should return 200 and a token on valid login', async () => {
            (auth.loginToMatrix as jest.Mock).mockResolvedValue(true);
            (prisma.system.upsert as jest.Mock).mockResolvedValue({ id: 'sys1' });

            const response = await request(app)
                .post('/api/auth/login')
                .send({ mxid: mockMxid, password: 'password' });

            expect(response.status).toBe(200);
            expect(response.body.token).toBeDefined();
            expect(prisma.system.upsert).toHaveBeenCalled();
        });
    });

    describe('Member CRUD API', () => {
        const authHeader = { 'Authorization': `Bearer ${mockToken}` };

        it('GET /api/members should return member list', async () => {
            (prisma.system.findUnique as jest.Mock).mockResolvedValue({
                members: [{ id: 'm1', name: 'Lily' }]
            });

            const response = await request(app)
                .get('/api/members')
                .set(authHeader);

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0].name).toBe('Lily');
        });

        it('POST /api/members should create a new member', async () => {
            (prisma.system.findUnique as jest.Mock).mockResolvedValue({ id: 'sys1' });
            (prisma.member.create as jest.Mock).mockResolvedValue({ id: 'm2', name: 'John' });

            const response = await request(app)
                .post('/api/members')
                .set(authHeader)
                .send({ name: 'John', proxyTags: [] });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('John');
        });

        it('PATCH /api/members/:id should update existing member', async () => {
            (prisma.member.findFirst as jest.Mock).mockResolvedValue({ id: 'm1' });
            (prisma.member.update as jest.Mock).mockResolvedValue({ id: 'm1', name: 'Lily Updated' });

            const response = await request(app)
                .patch('/api/members/m1')
                .set(authHeader)
                .send({ name: 'Lily Updated' });

            expect(response.status).toBe(200);
            expect(response.body.name).toBe('Lily Updated');
        });

        it('DELETE /api/members/:id should remove member', async () => {
            (prisma.member.findFirst as jest.Mock).mockResolvedValue({ id: 'm1' });
            (prisma.member.delete as jest.Mock).mockResolvedValue({ id: 'm1' });

            const response = await request(app)
                .delete('/api/members/m1')
                .set(authHeader);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should return 403 if updating/deleting member of another system', async () => {
            (prisma.member.findFirst as jest.Mock).mockResolvedValue(null);

            const response = await request(app)
                .delete('/api/members/m99')
                .set(authHeader);

            expect(response.status).toBe(403);
        });
    });
});
