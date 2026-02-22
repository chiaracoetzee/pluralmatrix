import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { startMatrixBot } from './bot';
import routes from './routes';
import * as gatekeeperController from './controllers/gatekeeperController';

const app = express();
const PORT = process.env.APP_PORT || 9000;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the React app
const clientPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientPath));

// API Routes
app.use('/api', routes);

// Check for mandatory environment variables
if (!process.env.AS_TOKEN || !process.env.JWT_SECRET) {
    console.error('FATAL: Missing mandatory environment variables AS_TOKEN or JWT_SECRET!');
    process.exit(1);
}

// Synapse Gatekeeper Compatibility (Module expects /check at root)
app.post('/check', gatekeeperController.checkMessage);

// All other requests will return the React app
app.use((req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

if (require.main === module) {
    startMatrixBot().then(async () => {
        app.listen(PORT, () => {
            console.log(`App Service (Brain) listening on port ${PORT}`);
        });
    }).catch(err => {
        console.error("Failed to start Matrix Bot:", err);
        process.exit(1);
    });
}

export { app };
