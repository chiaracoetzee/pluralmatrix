import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { startMatrixBot } from './bot';
import routes from './routes';

const app = express();
const PORT = process.env.APP_PORT || 9000;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the React app
const clientPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientPath));

// API Routes
app.use('/api', routes);

// The /check endpoint is actually at root /check in your old code
// My gatekeeperRoutes uses router.post('/check', ...) and it's mounted at /api
// Wait, the old code had app.post('/check', ...) at the root level.
// Let's ensure compatibility.
import * as gatekeeperController from './controllers/gatekeeperController';
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
