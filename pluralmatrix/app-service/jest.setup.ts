// Mock global fetch if not present (Node < 18 or specific test envs)
if (typeof global.fetch === 'undefined') {
    global.fetch = require('node-fetch');
}
