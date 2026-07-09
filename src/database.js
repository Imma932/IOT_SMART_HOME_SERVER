import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { logServiceFailure, logServiceRecovery, logError } from './logger.js';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/SmartHome',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Monitor pool connection errors
pool.on('connect', () => {
    logServiceRecovery('Database');
});

pool.on('error', (err) => {
    logError('Database pool error', err);
});

export async function testDatabaseConnection() {
    try {
        const result = await pool.query('SELECT 1 AS ok');
        return result.rows[0];
    } catch (error) {
        logServiceFailure('Database', error);
        throw error;
    }
}

export async function withTransaction(callback) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Validate light_status against database ENUM values
function validateLightStatus(light_status) {
    if (light_status === undefined || light_status === null) {
        return 'OFF';
    }
    const normalizedStatus = String(light_status).toUpperCase().trim();
    if (normalizedStatus !== 'ON' && normalizedStatus !== 'OFF') {
        console.warn(`Invalid light_status value: '${light_status}'. Defaulting to 'OFF'.`);
        return 'OFF';
    }
    return normalizedStatus;
}

export async function insertTelemetryWithConcurrencyControl(payload) {
    const { temperature, humidity, light_status, deviceMacAddress } = payload;

    return withTransaction(async (client) => {
        const deviceResult = await client.query(
            'SELECT device_mac_address FROM microcontroller WHERE device_mac_address = $1',
            [deviceMacAddress]
        );

        if (!deviceResult.rows.length) {
            throw new Error(`Unknown device: ${deviceMacAddress}`);
        }

        const validatedLightStatus = validateLightStatus(light_status);

        const result = await client.query(
            'INSERT INTO telemetry (temperature, humidity, light_status, device_mac_address) VALUES ($1, $2, $3, $4) RETURNING id',
            [temperature, humidity, validatedLightStatus, deviceMacAddress]
        );

        return { insertedId: result.rows[0].id };
    });
}

export async function insertMQTTTelemetryData(payload) {
    const { temperature, humidity, light_status, deviceMacAddress } = payload;

    if (!deviceMacAddress) {
        console.warn('Skipping telemetry insert: deviceMacAddress is required.');
        return { success: false, message: 'deviceMacAddress is required' };
    }

    const deviceResult = await pool.query(
        'SELECT device_mac_address FROM microcontroller WHERE device_mac_address = $1',
        [deviceMacAddress]
    );

    if (!deviceResult.rows.length) {
        return { success: false, message: `Unknown device: ${deviceMacAddress}` };
    }

    if (temperature === undefined || humidity === undefined) {
        return { success: false, message: 'Both temperature and humidity are required for telemetry inserts.' };
    }

    try {
        const validatedLightStatus = validateLightStatus(light_status);
        const result = await pool.query(
            'INSERT INTO telemetry (temperature, humidity, light_status, device_mac_address) VALUES ($1, $2, $3, $4) RETURNING id',
            [temperature, humidity, validatedLightStatus, deviceMacAddress]
        );
        return { success: true, insertedId: result.rows[0].id };
    } catch (error) {
        console.error('Failed to insert MQTT telemetry:', error.message);
        return { success: false, message: error.message };
    }
}

export async function deviceBelongsToUser(username, deviceMacAddress) {
    if (!username || !deviceMacAddress) {
        return false;
    }

    const result = await pool.query(
        'SELECT 1 FROM microcontroller WHERE username = $1 AND device_mac_address = $2 LIMIT 1',
        [username, deviceMacAddress]
    );

    return result.rows.length > 0;
}

export async function getLatestTelemetryForDevice(deviceMacAddress) {
    if (!deviceMacAddress) {
        return null;
    }

    const result = await pool.query(
        'SELECT temperature, humidity, light_status, device_mac_address AS "deviceMacAddress", created_at FROM telemetry WHERE device_mac_address = $1 ORDER BY created_at DESC LIMIT 1',
        [deviceMacAddress]
    );

    return result.rows.length ? result.rows[0] : null;
}

export async function getUsernameForDevice(deviceMacAddress) {
    if (!deviceMacAddress) {
        return null;
    }

    const result = await pool.query(
        'SELECT username FROM microcontroller WHERE device_mac_address = $1 LIMIT 1',
        [deviceMacAddress]
    );

    return result.rows.length ? result.rows[0].username : null;
}

export async function userExists(userDetails = {}) {
    const { username, phoneNumber } = userDetails;

    if (!username && !phoneNumber) {
        throw new Error('Provide at least a username or phone number to check for an existing user.');
    }

    let query = 'SELECT username FROM users WHERE 1 = 1';
    const values = [];
    let paramCounter = 1;

    if (username) {
        query += ` AND username = $${paramCounter}`;
        values.push(username);
        paramCounter++;
    }

    if (phoneNumber) {
        query += ` AND phone_number = $${paramCounter}`;
        values.push(phoneNumber);
    }

    const result = await pool.query(query, values);
    return result.rows.length > 0;
}

export async function saveUserRecord(userDetails = {}) {
    const {
        username,
        password,
        fname,
        lname,
        genderId,
        location,
        phoneNumber
    } = userDetails;

    if (!username || !password) {
        return { success: false, message: 'Username and password are required.' };
    }

    const alreadyExists = await userExists({ username, phoneNumber });
    if (alreadyExists) {
        return { success: false, message: 'A user with that username or phone number already exists.' };
    }

    try {
        await withTransaction(async (client) => {
            await client.query(
                'INSERT INTO users (username, password, fname, lname, gender_id, location, phone_number) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [username, password, fname || null, lname || null, genderId || null, location || null, phoneNumber || null]
            );
        });

        return { success: true, message: 'User saved successfully.' };
    } catch (error) {
        console.error('Failed to save user:', error.message);
        return { success: false, message: 'Failed to save user record.' };
    }
}

export async function registerUser(userDetails = {}) {
    const {
        username,
        email,
        password
    } = userDetails;

    if (!username || !email || !password) {
        return { success: false, message: 'Username, email, and password are required.' };
    }

    const existingResult = await pool.query(
        'SELECT user_id FROM users WHERE email = $1 OR username = $2',
        [email, username]
    );

    if (existingResult.rows.length > 0) {
        return { success: false, message: 'User with this email or username already exists.' };
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING user_id',
            [username, email, hashedPassword]
        );

        return { success: true, userId: result.rows[0].user_id };
    } catch (error) {
        console.error('Failed to register user:', error.message);
        return { success: false, message: 'Failed to register user.' };
    }
}

export async function getUserByEmail(email) {
    if (!email) {
        return null;
    }

    const result = await pool.query(
        'SELECT user_id, username, email, password FROM users WHERE email = $1 LIMIT 1',
        [email]
    );

    return result.rows.length ? result.rows[0] : null;
}

export async function getUserById(userId) {
    if (!userId) {
        return null;
    }

    const result = await pool.query(
        'SELECT user_id, username, email FROM users WHERE user_id = $1 LIMIT 1',
        [userId]
    );

    return result.rows.length ? result.rows[0] : null;
}

export async function registerDevice(deviceDetails = {}) {
    const {
        userId,
        deviceId,
        deviceName,
        deviceType
    } = deviceDetails;

    if (!userId || !deviceId || !deviceName || !deviceType) {
        return { success: false, message: 'userId, deviceId, deviceName, and deviceType are required.' };
    }

    const user = await getUserById(userId);
    if (!user) {
        return { success: false, message: 'User not found.' };
    }

    const existingDevice = await pool.query(
        'SELECT device_id FROM microcontroller WHERE device_id = $1 LIMIT 1',
        [deviceId]
    );

    if (existingDevice.rows.length > 0) {
        return { success: false, message: 'Device with this ID already exists.' };
    }

    try {
        const result = await pool.query(
            'INSERT INTO microcontroller (device_id, user_id, device_name, device_type) VALUES ($1, $2, $3, $4) RETURNING id',
            [deviceId, userId, deviceName, deviceType]
        );

        return { 
            success: true, 
            device: { 
                deviceId, 
                userId, 
                deviceName, 
                deviceType,
                id: result.rows[0].id 
            } 
        };
    } catch (error) {
        console.error('Failed to register device:', error.message);
        return { success: false, message: 'Failed to register device.' };
    }
}

export async function deviceBelongsToUserId(userId, deviceId) {
    if (!userId || !deviceId) {
        return false;
    }

    const result = await pool.query(
        'SELECT 1 FROM microcontroller WHERE user_id = $1 AND device_id = $2 LIMIT 1',
        [userId, deviceId]
    );

    return result.rows.length > 0;
}

export async function getUserIdByDeviceId(deviceId) {
    if (!deviceId) {
        return null;
    }

    const result = await pool.query(
        'SELECT user_id FROM microcontroller WHERE device_id = $1 LIMIT 1',
        [deviceId]
    );

    return result.rows.length ? result.rows[0].user_id : null;
}

export async function insertTelemetryByDeviceId(payload) {
    const { deviceId, temperature, humidity, timestamp } = payload;

    if (!deviceId) {
        throw new Error('deviceId is required');
    }

    const deviceResult = await pool.query(
        'SELECT device_id FROM microcontroller WHERE device_id = $1',
        [deviceId]
    );

    if (!deviceResult.rows.length) {
        throw new Error(`Unknown device: ${deviceId}`);
    }

    const validatedLightStatus = 'OFF'; 
    const result = await pool.query(
        'INSERT INTO telemetry (temperature, humidity, light_status, device_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [temperature, humidity, validatedLightStatus, deviceId]
    );

    return { insertedId: result.rows[0].id };
}

export async function getLatestTelemetryByDeviceId(deviceId) {
    if (!deviceId) {
        return null;
    }

    const result = await pool.query(
        'SELECT temperature, humidity, light_status, device_id AS "deviceId", created_at FROM telemetry WHERE device_id = $1 ORDER BY created_at DESC LIMIT 1',
        [deviceId]
    );

    return result.rows.length ? result.rows[0] : null;
}

export default pool;
