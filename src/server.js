import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import net from "net";
import os from "os";

// Import your custom modules (Ensure these files use 'export' instead of 'module.exports')
import { createSocketConnection, testSocketConnection, setSocketPortUser, broadcastTelemetryToUser, getSocketPortUser, hasSocketServer, getActivePortAllocationsCount, getActiveSocketServersCount, getSocketPortUserMap } from "./createSocketConnection.js";
import { testDatabaseConnection, insertTelemetryWithConcurrencyControl, insertMQTTTelemetryData, userExists, deviceBelongsToUser, getLatestTelemetryForDevice, getUsernameForDevice } from "./database.js";
import { connectToMQTT, publishToMQTT, subscribeToMQTT } from "./connectToMQTT.js";
import { logUserConnection, logServiceFailure, logCritical, logInfo, logError, generateSystemReport } from "./logger.js";

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

app.post('/createSocket', async (request, response) => {
    try {
        const { username } = request.body;

        if (!username) {
            return response.status(400).json({
                error: "Missing required field: 'username' is required."
            });
        }

        const START_PORT_RANGE = 4000;
        const availablePort = await lookForAvailablePort(START_PORT_RANGE);

        createSocketConnection(availablePort, { username });
        logUserConnection(username, availablePort, 'socket connection created via API');

        return response.status(201).json({
            message: "Socket connection successfully initialized",
            username,
            assignedPort: availablePort
        });
    } catch (error) {
        console.error("Error creating socket:", error.message);
        return response.status(500).json({
            error: "Failed to create socket connection",
            details: error.message
        });
    }
});

app.post('/registerSocketPort', (request, response) => {
    try {
        const { port, username } = request.body;

        if (!port || !username) {
            return response.status(400).json({
                error: "Both 'port' and 'username' are required."
            });
        }

        setSocketPortUser(port, username);
        logUserConnection(username, port, 'socket port registered via API');

        return response.status(200).json({
            message: 'Socket port registered for user successfully.',
            port,
            username
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
        const result = await testDatabaseConnection();
        databaseHealth = 'CONNECTED';
        return response.status(200).json({ ok: true, result });
    } catch (error) {
        databaseHealth = 'DISCONNECTED';
        logServiceFailure('Database', error);
        return response.status(503).json({ ok: false, error: error.message });
    }
});
app.post('/telemetry', async (request, response) => {
    try {
        const { username, temperature, humidity, light_status, deviceMacAddress } = request.body;

        if (!username || !deviceMacAddress || temperature === undefined || humidity === undefined) {
            return response.status(400).json({ error: 'username, deviceMacAddress, temperature, and humidity are required.' });
        }

        const belongsToUser = await deviceBelongsToUser(username, deviceMacAddress);
        if (!belongsToUser) {
            return response.status(403).json({ error: 'Device is not registered for this username.' });
        }

        const result = await insertTelemetryWithConcurrencyControl({
            temperature,
            humidity,
            light_status: light_status || 'OFF',
            deviceMacAddress
        });

        const telemetryPayload = {
            username,
            deviceMacAddress,
            temperature,
            humidity,
            light_status: light_status || 'OFF',
            timestamp: new Date().toISOString()
        };
        broadcastTelemetryToUser(username, telemetryPayload);

        return response.status(201).json({ ok: true, data: result });
    } catch (error) {
        console.error('Telemetry insert failed:', error.message);
        return response.status(500).json({ ok: false, error: error.message });
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
app.post('/checkUserExists', async (request, response) => {
    try {
        const { username, phoneNumber } = request.body;

        if (!username && !phoneNumber) {
            return response.status(400).json({
                error: "At least one of 'username' or 'phoneNumber' is required."
            });
        }

        const exists = await userExists({ username, phoneNumber });
        return response.status(200).json({
            exists,
            username: username || undefined,
            phoneNumber: phoneNumber || undefined
        });
    } catch (error) {
        console.error('User existence check failed:', error.message);
        return response.status(500).json({
            error: "Server Error. Failed to check user existence",
            details: error.message
        });
    }
});
app.post("/publishToMQTT", (request, response) => {
    try {
        const { publishTopic, publishMessage } = request.body;
        if (!publishTopic || !MQTT_TOPICS.includes(publishTopic)) {
            return response.status(400).json({ error: "Invalid MQTT topic" });
        }

        if (publishMessage === undefined || publishMessage === null) {
            return response.status(400).json({ error: "publishMessage is required" });
        }

        if (!client) {
            return response.status(503).json({ error: "MQTT client is not connected" });
        }

        publishToMQTT(client, publishTopic, publishMessage);
        latestTopicMessages.set(publishTopic, publishMessage);

        return response.status(200).json({
            message: "Message published successfully",
            topic: publishTopic,
            payload: publishMessage
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
        const { topic, username, deviceMacAddress } = request.body;

        if (!topic || !username || !deviceMacAddress) {
            return response.status(400).json({ error: "topic, username, and deviceMacAddress are required." });
        }

        if (!MQTT_TOPICS.includes(topic)) {
            return response.status(400).json({ 
                error: `Invalid MQTT topic: '${topic}'. The topic must match one configured in your environment variables.` 
            });
        }

        const belongsToUser = await deviceBelongsToUser(username, deviceMacAddress);
        if (!belongsToUser) {
            return response.status(403).json({ error: 'Device is not registered for this username.' });
        }

        const latestMessage = latestTopicMessages.get(topic);
        if (latestMessage !== undefined) {
            return response.status(200).json({
                topic,
                payload: latestMessage,
                source: 'mqtt',
                timestamp: new Date().toISOString()
            });
        }

        const latestTelemetry = await getLatestTelemetryForDevice(deviceMacAddress);
        if (!latestTelemetry) {
            return response.status(404).json({
                topic,
                payload: null,
                message: 'No MQTT telemetry and no database telemetry found for this device.'
            });
        }

        return response.status(200).json({
            topic,
            payload: latestTelemetry,
            source: 'database',
            timestamp: latestTelemetry.created_at
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