import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
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

export default pool;