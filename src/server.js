import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import net from "net";
import os from "os";

// Import your custom modules (Ensure these files use 'export' instead of 'module.exports')
import { createSocketConnection, testSocketConnection, setSocketPortUser, broadcastTelemetryToUser, getSocketPortUser, hasSocketServer, getActivePortAllocationsCount, getActiveSocketServersCount, getSocketPortUserMap } from "./createSocketConnection.js";
import { testDatabaseConnection, insertTelemetryWithConcurrencyControl, insertMQTTTelemetryData, userExists, deviceBelongsToUser, getLatestTelemetryForDevice, getUsernameForDevice, registerUser, getUserByEmail, registerDevice, deviceBelongsToUserId, getUserIdByDeviceId, insertTelemetryByDeviceId, getLatestTelemetryByDeviceId } from "./database.js";
import { connectToMQTT, publishToMQTT, subscribeToMQTT } from "./connectToMQTT.js";
import { logUserConnection, logServiceFailure, logCritical, logInfo, logError, generateSystemReport } from "./logger.js";
import { authenticateToken, generateToken } from "./authMiddleware.js";

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT) || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER;
const MQTT_PORT = process.env.MQTT_PORT;
const MQTT_TOPICS = [
    process.env.TOPIC_TEMPERATURE, 
    process.env.TOPIC_HUMIDITY, 
    process.env.TOPIC_OUTSIDE_LED_STATUS, 
    process.env.TOPIC_INSIDE_LED_STATUS, 
    process.env.TOPIC_FAN_STATUS, 
    process.env.TOPIC_ALERT, 
    process.env.TOPIC_STATUS
].filter(topic => topic && typeof topic === 'string'); // Filter out undefined or invalid topics

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Initialize MQTT
var client;
const latestTopicMessages = new Map();

// System health tracking
let databaseHealth = 'UNKNOWN';
let mqttHealth = 'UNKNOWN';

// Get reference to socket port user map for reporting
const socketPortUserMap = getSocketPortUserMap();

// Helper: Check if port is empty
function isPortEmpty(port) {
    return new Promise((resolve) => {
        const testServer = net.createServer();
        
        const cleanup = () => {
            testServer.removeAllListeners();
            try {
                testServer.close();
            } catch (err) {
                // Ignore close errors if already closed
            }
        };
        
        testServer
            .once("error", (err) => {
                cleanup();
                resolve(err.code !== "EADDRINUSE");
            })
            .once("listening", () => {
                cleanup();
                resolve(true);
            })
            .listen(port);
    });
}

// Helper: Scan for a range of open ports
async function lookForAvailablePort(startPort, maxAttempts = 10) {
    let port = startPort;
    for (let i = 0; i < maxAttempts; i++) {
        const isEmpty = await isPortEmpty(port);
        if (isEmpty) return port;
        port++;
    }
    throw new Error("No available ports found in the specified range.");
}

app.post('/createSocket', authenticateToken, async (request, response) => {
    try {
        const { userId } = request.body;

        if (!userId) {
            return response.status(400).json({
                error: "Missing required field: 'userId' is required."
            });
        }

        // Verify the authenticated user matches the userId in the request
        if (request.userId !== parseInt(userId)) {
            return response.status(403).json({
                error: "Unauthorized. You can only create sockets for your own account."
            });
        }

        // Default to port 443 for Render environments as per spec
        const port = 443;

        createSocketConnection(port, { userId });
        logUserConnection(userId, port, 'socket connection created via API');

        return response.status(201).json({
            success: true,
            port
        });
    } catch (error) {
        console.error("Error creating socket:", error.message);
        return response.status(500).json({
            error: "Failed to create socket connection",
            details: error.message
        });
    }
});

app.post('/registerSocketPort', authenticateToken, (request, response) => {
    try {
        const { userId, port } = request.body;

        if (!userId || !port) {
            return response.status(400).json({
                error: "Both 'userId' and 'port' are required."
            });
        }

        // Verify the authenticated user matches the userId in the request
        if (request.userId !== parseInt(userId)) {
            return response.status(403).json({
                error: "Unauthorized. You can only register sockets for your own account."
            });
        }

        setSocketPortUser(port, userId);
        logUserConnection(userId, port, 'socket port registered via API');

        return response.status(200).json({
            success: true
        });
    } catch (error) {
        console.error('Error registering socket port:', error.message);
        return response.status(500).json({
            error: 'Failed to register socket port',
            details: error.message
        });
    }
});
app.get('/health/db', async (_request, response) => {
    try {
        await testDatabaseConnection();
        databaseHealth = 'CONNECTED';
        return response.status(200).json({ 
            status: 'healthy', 
            database: 'connected' 
        });
    } catch (error) {
        databaseHealth = 'DISCONNECTED';
        logServiceFailure('Database', error);
        return response.status(503).json({ 
            status: 'unhealthy', 
            database: 'disconnected' 
        });
    }
});
app.post('/telemetry', async (request, response) => {
    try {
        const { deviceId, temperature, humidity, timestamp } = request.body;

        if (!deviceId || temperature === undefined || humidity === undefined) {
            return response.status(400).json({ error: 'deviceId, temperature, and humidity are required.' });
        }

        const result = await insertTelemetryByDeviceId({
            deviceId,
            temperature,
            humidity,
            timestamp: timestamp || new Date().toISOString()
        });

        // Get userId for this device to broadcast telemetry
        const userId = await getUserIdByDeviceId(deviceId);
        if (userId) {
            const telemetryPayload = {
                deviceId,
                temperature,
                humidity,
                timestamp: timestamp || new Date().toISOString()
            };
            broadcastTelemetryToUser(userId, telemetryPayload);
        }

        return response.status(201).json({ status: 'logged' });
    } catch (error) {
        console.error('Telemetry insert failed:', error.message);
        return response.status(500).json({ error: error.message });
    }
});
app.post('/testSocket', async (request, response) => {
    try {
        const { port } = request.body;

        if (!port) {
            return response.status(400).json({
                error: "Missing required field: 'port' is required."
            });
        }

        const result = await testSocketConnection(port);
        return response.status(200).json(result);
    } catch (error) {
        console.error("Error testing socket:", error.message);
        return response.status(500).json({
            error: "Failed to test socket connection",
            details: error.message
        });
    }
});
// POST /register - Register a new user
app.post('/register', async (request, response) => {
    try {
        const { username, email, password } = request.body;

        if (!username || !email || !password) {
            return response.status(400).json({
                error: "username, email, and password are required."
            });
        }

        const result = await registerUser({ username, email, password });

        if (!result.success) {
            return response.status(400).json({
                error: result.message
            });
        }

        const token = generateToken(result.userId);

        return response.status(201).json({
            success: true,
            userId: result.userId,
            token
        });
    } catch (error) {
        console.error('User registration failed:', error.message);
        return response.status(500).json({
            error: "Server Error. Failed to register user",
            details: error.message
        });
    }
});

// POST /checkUserExists - Check if email is already registered
app.post('/checkUserExists', async (request, response) => {
    try {
        const { email } = request.body;

        if (!email) {
            return response.status(400).json({
                error: "email is required."
            });
        }

        const user = await getUserByEmail(email);
        const exists = user !== null;

        return response.status(200).json({
            exists,
            userId: exists ? user.user_id : null
        });
    } catch (error) {
        console.error('User existence check failed:', error.message);
        return response.status(500).json({
            error: "Server Error. Failed to check user existence",
            details: error.message
        });
    }
});

// POST /registerDevice - Pair a new device to a user
app.post('/registerDevice', authenticateToken, async (request, response) => {
    try {
        const { userId, deviceId, deviceName, deviceType } = request.body;

        if (!userId || !deviceId || !deviceName || !deviceType) {
            return response.status(400).json({
                error: "userId, deviceId, deviceName, and deviceType are required."
            });
        }

        // Verify the authenticated user matches the userId in the request
        if (request.userId !== parseInt(userId)) {
            return response.status(403).json({
                error: "Unauthorized. You can only register devices for your own account."
            });
        }

        const result = await registerDevice({ userId, deviceId, deviceName, deviceType });

        if (!result.success) {
            return response.status(400).json({
                error: result.message
            });
        }

        return response.status(201).json({
            success: true,
            device: result.device
        });
    } catch (error) {
        console.error('Device registration failed:', error.message);
        return response.status(500).json({
            error: "Server Error. Failed to register device",
            details: error.message
        });
    }
});

app.post("/publishToMQTT", authenticateToken, (request, response) => {
    try {
        const { userId, topic, command } = request.body;

        if (!userId || !topic || !command) {
            return response.status(400).json({ error: "userId, topic, and command are required" });
        }

        // Verify the authenticated user matches the userId in the request
        if (request.userId !== parseInt(userId)) {
            return response.status(403).json({
                error: "Unauthorized. You can only publish for your own account."
            });
        }

        if (!client) {
            return response.status(503).json({ error: "MQTT client is not connected" });
        }

        publishToMQTT(client, topic, command);
        latestTopicMessages.set(topic, command);

        return response.status(200).json({
            published: true
        });
    } catch (error) {
        console.error("Error publishing to MQTT:", error.message);
        return response.status(500).json({
            error: "Failed to publish message",
            details: error.message
        });
    }
});
// Admin endpoint for system report
app.get('/admin/reports', async (_request, response) => {
    try {
        // Check database health
        try {
            await testDatabaseConnection();
            databaseHealth = 'CONNECTED';
        } catch (error) {
            databaseHealth = 'DISCONNECTED';
        }

        // Check MQTT health
        mqttHealth = client && client.connected ? 'CONNECTED' : 'DISCONNECTED';

        // Get active socket servers count
        const activeSocketServers = getActiveSocketServersCount();
        const activePortAllocations = getActivePortAllocationsCount();

        const reportData = {
            coreServerPort: PORT,
            coreServerStatus: 'ONLINE',
            databaseStatus: databaseHealth,
            mqttStatus: mqttHealth,
            mqttTopicsCount: MQTT_TOPICS.length,
            activeSocketServers,
            activePortAllocations
        };

        const report = generateSystemReport(reportData);
        return response.status(200).json(report);
    } catch (error) {
        logError('Failed to generate system report', error);
        return response.status(500).json({ error: 'Failed to generate system report', details: error.message });
    }
});

app.post("/getSubscribedTopicData", async (request, response) => {
    try {
        const { topic } = request.body;

        if (!topic) {
            return response.status(400).json({ error: "topic is required." });
        }

        const latestMessage = latestTopicMessages.get(topic);
        if (latestMessage !== undefined) {
            return response.status(200).json({
                topic,
                lastState: typeof latestMessage === 'string' ? latestMessage : JSON.stringify(latestMessage)
            });
        }

        return response.status(404).json({
            topic,
            lastState: null
        });
    } catch (error) {
        console.error("Error fetching subscribed topic data:", error.message);
        return response.status(500).json({
            error: "Failed to fetch subscribed topic data",
            details: error.message
        });
    }
});

// Initialize and Connect to Secure HiveMQ Broker
client = connectToMQTT(MQTT_BROKER, MQTT_PORT);

// Extracted validation logic for MQTT message processing
async function processMQTTTelemetry(formattedPayload, incomingTopic) {
    try {
        const { temperature, humidity, light_status, deviceMacAddress } = formattedPayload;

        if (!deviceMacAddress) {
            console.warn('Discarding MQTT telemetry: deviceMacAddress is missing');
            return;
        }

        if (temperature === undefined && humidity === undefined && light_status === undefined) {
            console.warn('Discarding MQTT telemetry: no telemetry data (temperature, humidity, or light_status) provided');
            return;
        }

        const username = await getUsernameForDevice(deviceMacAddress);
        if (!username) {
            console.warn(`Discarding MQTT telemetry because device ${deviceMacAddress} is not registered in database.`);
            return;
        }

        const dbResult = await insertMQTTTelemetryData({
            temperature,
            humidity,
            light_status,
            deviceMacAddress
        });
        
        if (!dbResult.success) {
            console.warn(`Failed to save telemetry to database: ${dbResult.message}`);
        } else {
            console.log(`✅ Telemetry saved to database (id: ${dbResult.insertedId})`);
        }

        const telemetryPayload = {
            username,
            deviceMacAddress,
            temperature,
            humidity,
            light_status: light_status || 'OFF',
            topic: incomingTopic,
            timestamp: new Date().toISOString()
        };
        broadcastTelemetryToUser(username, telemetryPayload);
    } catch (error) {
        console.error(`Error in processMQTTTelemetry for topic ${incomingTopic}:`, error.message);
    }
}

if (client) {
    // Using forEach cleanly encapsulates the scope for each individual topic
    MQTT_TOPICS.forEach((topic) => {
        // The 3rd parameter receives (topicName, rawMessagePacket) from your utility file
        subscribeToMQTT(client, topic, (incomingTopic, rawPayload) => {
            try {
                // Convert binary buffer payload from MQTT to readable string text
                const messageString = rawPayload.toString();
                
                console.log(`📥 New MQTT Message [${incomingTopic}]: ${messageString}`);

                // Try to store it as a clean JSON object if applicable, otherwise fall back to string text
                let formattedPayload;
                try {
                    formattedPayload = JSON.parse(messageString);
                } catch {
                    formattedPayload = messageString;
                }

                // Store the message to cache so the /getSubscribedTopicData endpoint can return live broker data
                latestTopicMessages.set(incomingTopic, formattedPayload);

                if (typeof formattedPayload === 'object' && formattedPayload !== null) {
                    // Process telemetry asynchronously with proper error handling
                    processMQTTTelemetry(formattedPayload, incomingTopic).catch(err => {
                        console.error(`Unhandled promise rejection in MQTT telemetry processing for topic ${incomingTopic}:`, err.message);
                    });
                }

            } catch (err) {
                console.error(`Error processing message on topic ${incomingTopic}:`, err.message);
            }
        });
    });
}

// Global error handlers for unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
    logCritical('Unhandled Promise Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
    logCritical('Uncaught Exception', { error: error.message, stack: error.stack });
});

// Periodic system health report (every 5 minutes)
const REPORT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
    try {
        // Check database health
        testDatabaseConnection()
            .then(() => { databaseHealth = 'CONNECTED'; })
            .catch(() => { databaseHealth = 'DISCONNECTED'; });

        // Check MQTT health
        mqttHealth = client && client.connected ? 'CONNECTED' : 'DISCONNECTED';

        // Get active port allocations
        const activePortAllocations = getActivePortAllocationsCount();
        const activeSocketServers = getActiveSocketServersCount();

        generateSystemReport({
            coreServerPort: PORT,
            coreServerStatus: 'ONLINE',
            databaseStatus: databaseHealth,
            mqttStatus: mqttHealth,
            mqttTopicsCount: MQTT_TOPICS.length,
            activeSocketServers,
            activePortAllocations
        });
    } catch (error) {
        logError('Failed to generate periodic system report', error);
    }
}, REPORT_INTERVAL_MS);

// Start Main Express HTTP Server
const server = app.listen(PORT, () => {
    const networkInterfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const name of Object.keys(networkInterfaces)) {
        for (const iface of networkInterfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        }
    }
    
    console.log(`🚀 Main Server started on http://localhost:${PORT}`);
    if (addresses.length > 0) {
        console.log(`🌐 Server accessible at: ${addresses.map(addr => `http://${addr}:${PORT}`).join(', ')}`);
    }
});