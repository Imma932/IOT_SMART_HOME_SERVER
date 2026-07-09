import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { logServiceFailure, logServiceRecovery, logError } from './logger.js';

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: (process.env.DB_PASSWORD || '').trim(),
    database: process.env.DB_NAME || 'SmartHome',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
    decimalNumbers: true
});

// Monitor pool connection errors
pool.on('connection', (connection) => {
    logServiceRecovery('Database');
});

pool.on('acquire', (connection) => {
    // Connection acquired from pool
});

pool.on('release', (connection) => {
    // Connection released back to pool
});

pool.on('enqueue', () => {
    logError('Database connection pool waiting for available connection');
});

export async function testDatabaseConnection() {
    try {
        const [rows] = await pool.query('SELECT 1 AS ok');
        return rows[0];
    } catch (error) {
        logServiceFailure('Database', error);
        throw error;
    }
}

export async function withTransaction(callback) {
    const connection = await pool.getConnection();

    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
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

    return withTransaction(async (connection) => {
        const [deviceRows] = await connection.query(
            'SELECT device_mac_address FROM microcontroller WHERE device_mac_address = ?',
            [deviceMacAddress]
        );

        if (!deviceRows.length) {
            throw new Error(`Unknown device: ${deviceMacAddress}`);
        }

        const validatedLightStatus = validateLightStatus(light_status);

        const [result] = await connection.query(
            'INSERT INTO telemetry (temperature, humidity, light_status, device_mac_address) VALUES (?, ?, ?, ?)',
            [temperature, humidity, validatedLightStatus, deviceMacAddress]
        );

        return { insertedId: result.insertId };
    });
}

export async function insertMQTTTelemetryData(payload) {
    const { temperature, humidity, light_status, deviceMacAddress } = payload;

    if (!deviceMacAddress) {
        console.warn('Skipping telemetry insert: deviceMacAddress is required.');
        return { success: false, message: 'deviceMacAddress is required' };
    }

    const [deviceRows] = await pool.query(
        'SELECT device_mac_address FROM microcontroller WHERE device_mac_address = ?',
        [deviceMacAddress]
    );

    if (!deviceRows.length) {
        return { success: false, message: `Unknown device: ${deviceMacAddress}` };
    }

    if (temperature === undefined || humidity === undefined) {
        return { success: false, message: 'Both temperature and humidity are required for telemetry inserts.' };
    }

    try {
        const validatedLightStatus = validateLightStatus(light_status);
        const [result] = await pool.query(
            'INSERT INTO telemetry (temperature, humidity, light_status, device_mac_address) VALUES (?, ?, ?, ?)',
            [temperature, humidity, validatedLightStatus, deviceMacAddress]
        );
        return { success: true, insertedId: result.insertId };
    } catch (error) {
        console.error('Failed to insert MQTT telemetry:', error.message);
        return { success: false, message: error.message };
    }
}

export async function deviceBelongsToUser(username, deviceMacAddress) {
    if (!username || !deviceMacAddress) {
        return false;
    }

    const [rows] = await pool.query(
        'SELECT 1 FROM microcontroller WHERE username = ? AND device_mac_address = ? LIMIT 1',
        [username, deviceMacAddress]
    );

    return rows.length > 0;
}

export async function getLatestTelemetryForDevice(deviceMacAddress) {
    if (!deviceMacAddress) {
        return null;
    }

    const [rows] = await pool.query(
        'SELECT temperature, humidity, light_status, device_mac_address AS deviceMacAddress, created_at FROM telemetry WHERE device_mac_address = ? ORDER BY created_at DESC LIMIT 1',
        [deviceMacAddress]
    );

    return rows.length ? rows[0] : null;
}

export async function getUsernameForDevice(deviceMacAddress) {
    if (!deviceMacAddress) {
        return null;
    }

    const [rows] = await pool.query(
        'SELECT username FROM microcontroller WHERE device_mac_address = ? LIMIT 1',
        [deviceMacAddress]
    );

    return rows.length ? rows[0].username : null;
}

export async function userExists(userDetails = {}) {
    const { username, phoneNumber } = userDetails;

    if (!username && !phoneNumber) {
        throw new Error('Provide at least a username or phone number to check for an existing user.');
    }

    let query = 'SELECT username FROM users WHERE 1 = 1';
    const values = [];

    if (username) {
        query += ' AND username = ?';
        values.push(username);
    }

    if (phoneNumber) {
        query += ' AND phone_number = ?';
        values.push(phoneNumber);
    }

    const [rows] = await pool.query(query, values);
    return rows.length > 0;
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
        await withTransaction(async (connection) => {
            await connection.query(
                'INSERT INTO users (username, password, fname, lname, gender_id, location, phone_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [username, password, fname || null, lname || null, genderId || null, location || null, phoneNumber || null]
            );
        });

        return { success: true, message: 'User saved successfully.' };
    } catch (error) {
        console.error('Failed to save user:', error.message);
        return { success: false, message: 'Failed to save user record.' };
    }
}

// New functions for API spec compliance
export async function registerUser(userDetails = {}) {
    const {
        username,
        email,
        password
    } = userDetails;

    if (!username || !email || !password) {
        return { success: false, message: 'Username, email, and password are required.' };
    }

    // Check if user already exists by email
    const [existingRows] = await pool.query(
        'SELECT user_id FROM users WHERE email = ? OR username = ?',
        [email, username]
    );

    if (existingRows.length > 0) {
        return { success: false, message: 'User with this email or username already exists.' };
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
        );

        return { success: true, userId: result.insertId };
    } catch (error) {
        console.error('Failed to register user:', error.message);
        return { success: false, message: 'Failed to register user.' };
    }
}

export async function getUserByEmail(email) {
    if (!email) {
        return null;
    }

    const [rows] = await pool.query(
        'SELECT user_id, username, email, password FROM users WHERE email = ? LIMIT 1',
        [email]
    );

    return rows.length ? rows[0] : null;
}

export async function getUserById(userId) {
    if (!userId) {
        return null;
    }

    const [rows] = await pool.query(
        'SELECT user_id, username, email FROM users WHERE user_id = ? LIMIT 1',
        [userId]
    );

    return rows.length ? rows[0] : null;
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

    // Check if user exists
    const user = await getUserById(userId);
    if (!user) {
        return { success: false, message: 'User not found.' };
    }

    // Check if device already exists
    const [existingDevice] = await pool.query(
        'SELECT device_id FROM microcontroller WHERE device_id = ? LIMIT 1',
        [deviceId]
    );

    if (existingDevice.length > 0) {
        return { success: false, message: 'Device with this ID already exists.' };
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO microcontroller (device_id, user_id, device_name, device_type) VALUES (?, ?, ?, ?)',
            [deviceId, userId, deviceName, deviceType]
        );

        return { 
            success: true, 
            device: { 
                deviceId, 
                userId, 
                deviceName, 
                deviceType,
                id: result.insertId 
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

    const [rows] = await pool.query(
        'SELECT 1 FROM microcontroller WHERE user_id = ? AND device_id = ? LIMIT 1',
        [userId, deviceId]
    );

    return rows.length > 0;
}

export async function getUserIdByDeviceId(deviceId) {
    if (!deviceId) {
        return null;
    }

    const [rows] = await pool.query(
        'SELECT user_id FROM microcontroller WHERE device_id = ? LIMIT 1',
        [deviceId]
    );

    return rows.length ? rows[0].user_id : null;
}

export async function insertTelemetryByDeviceId(payload) {
    const { deviceId, temperature, humidity, timestamp } = payload;

    if (!deviceId) {
        throw new Error('deviceId is required');
    }

    const [deviceRows] = await pool.query(
        'SELECT device_id FROM microcontroller WHERE device_id = ?',
        [deviceId]
    );

    if (!deviceRows.length) {
        throw new Error(`Unknown device: ${deviceId}`);
    }

    const validatedLightStatus = 'OFF'; // Default for new schema
    const [result] = await pool.query(
        'INSERT INTO telemetry (temperature, humidity, light_status, device_id) VALUES (?, ?, ?, ?)',
        [temperature, humidity, validatedLightStatus, deviceId]
    );

    return { insertedId: result.insertId };
}

export async function getLatestTelemetryByDeviceId(deviceId) {
    if (!deviceId) {
        return null;
    }

    const [rows] = await pool.query(
        'SELECT temperature, humidity, light_status, device_id AS deviceId, created_at FROM telemetry WHERE device_id = ? ORDER BY created_at DESC LIMIT 1',
        [deviceId]
    );

    return rows.length ? rows[0] : null;
}

export default pool;