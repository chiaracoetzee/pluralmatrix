import { ProxyCacheService } from './services/cache';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
const mockFindUnique = jest.fn();
const mockPrisma = {
    system: {
        findUnique: mockFindUnique
    }
} as unknown as PrismaClient;

describe('ProxyCacheService', () => {
    let cache: ProxyCacheService;
    const TEST_MXID = '@alice:localhost';
    const MOCK_SYSTEM = {
        id: 'sys_123',
        ownerId: TEST_MXID,
        slug: 'alice',
        systemTag: null,
        members: [
            { id: 'm_1', name: 'Bob', proxyTags: [{ prefix: 'b:' }] }
        ]
    };

    beforeEach(() => {
        cache = new ProxyCacheService();
        jest.clearAllMocks();
    });

    test('First call should hit the database', async () => {
        mockFindUnique.mockResolvedValue(MOCK_SYSTEM);

        const result = await cache.getSystemRules(TEST_MXID, mockPrisma);

        expect(result).toEqual(MOCK_SYSTEM);
        expect(mockFindUnique).toHaveBeenCalledTimes(1);
    });

    test('Second call should hit the cache (no DB call)', async () => {
        mockFindUnique.mockResolvedValue(MOCK_SYSTEM);

        // First call (Prime cache)
        await cache.getSystemRules(TEST_MXID, mockPrisma);
        
        // Second call
        const result = await cache.getSystemRules(TEST_MXID, mockPrisma);

        expect(result).toEqual(MOCK_SYSTEM);
        expect(mockFindUnique).toHaveBeenCalledTimes(1); // Still 1!
    });

    test('Invalidation should force a new DB call', async () => {
        mockFindUnique.mockResolvedValue(MOCK_SYSTEM);

        // 1. Prime cache
        await cache.getSystemRules(TEST_MXID, mockPrisma);
        expect(mockFindUnique).toHaveBeenCalledTimes(1);

        // 2. Invalidate
        cache.invalidate(TEST_MXID);

        // 3. Fetch again
        await cache.getSystemRules(TEST_MXID, mockPrisma);
        
        expect(mockFindUnique).toHaveBeenCalledTimes(2); // DB hit again
    });

    test('Should cache null results (non-existent users)', async () => {
        mockFindUnique.mockResolvedValue(null);

        // 1. Fetch non-existent user
        const result1 = await cache.getSystemRules('@ghost:localhost', mockPrisma);
        expect(result1).toBeNull();
        expect(mockFindUnique).toHaveBeenCalledTimes(1);

        // 2. Fetch again
        const result2 = await cache.getSystemRules('@ghost:localhost', mockPrisma);
        expect(result2).toBeNull();
        expect(mockFindUnique).toHaveBeenCalledTimes(1); // Still 1
    });
});
