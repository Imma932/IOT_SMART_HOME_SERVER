# IOT_SMART_HOME_SERVER
# AuraHome — AI-Augmented Smart Room Controller

AuraHome is an intelligent, localized smart home automation platform developed over a 3-day hackathon sprint. The system seamlessly integrates distributed edge hardware, a robust centralized backend database engine, and a mobile client interface to deliver automated ambient room controls alongside an AI-driven domestic advisory assistant powered by the Google Gemini API.

## 🚀 System Architecture Overview

The application is split across three decoupled layers working in tandem over local Wi-Fi networks:

1. **IoT Edge Layer (ESP32 WROOM):** Captures physical environmental metrics via DHT11 sensors and executes hardware actions using electronic relays. Communication is driven entirely via the lightweight **MQTT (Publish/Subscribe)** protocol over a shared public broker.
2. **Centralized Backend (Node.js & Express):** Serves as the central nervous system. It processes incoming MQTT data streams, handles user session management, manages transactional state persistence inside **MySQL**, and orchestrates a local **Retrieval-Augmented Generation (RAG)** pipeline to contextually prompt the Gemini API.
3. **Frontend Client (Mobile Interface):** A responsive, mobile-first dashboard optimized for Android environments that lets users register/login securely, view real-time room telemetry analytics, manually trigger hardware overrides, and interact with the generative AI chat layout.

---

## 🛠️ Tech Stack & Protocols

- **Edge Hardware:** ESP32 WROOM microcontrollers, DHT11 (Temperature & Humidity Sensor), 5V Relay Modules.
- **M2M Communication:** MQTT Protocol managed via HiveMQ Public Broker.
- **Backend Application:** Node.js, Express.js, JWT (JSON Web Tokens) Session Middleware, Bcrypt.js Hashing.
- **Database Layer:** MySQL (Relational Schema supporting multi-user profiles, gender lookups, explicit device matching, and timestamped telemetry time-series logging).
- **AI Integration:** Google Gen AI SDK (`gemini-3.5-flash`) executing dynamic text-rulebook parsing via a custom RAG architecture.
- **Frontend View:** Mobile-responsive dashboard with real-time UI data binding.

---

## 📋 Features & Functionality

### 🔐 Multi-User Authentication
Secure user registration and session management. Passwords undergo cryptographic one-way hashing (`bcrypt`) before persistence into the relational schema. Secure routes are restricted on the mobile layout using signed JWT HTTP headers.

### 📊 Scalable Device & Telemetry Management
The system supports multiple unique ESP32 WROOM microcontrollers running concurrently on a single user profile. Hardware devices authenticate using their hard-coded physical MAC address. Telemetry streams push structural JSON payloads upstream every 15 seconds to populate relational database rows.

### 🤖 Gemini-Powered Contextual RAG Chat
Instead of relying on generic AI prompts, users can conversationalize their actual data logs. The backend reads an on-disk plain-text operational rulebook (`rules.txt`), selects the user’s recent live sensor logs out of MySQL, and packages them inside an explicit context block to provide deterministic, zero-hallucination house safety audits.

### ⚡ Autonomous Fail-Safe Operations
The application manages automated triggers independently of human interaction. If a localized sensor registers temperature thresholds higher than $26^\circ\text{C}$, the backend triggers automated MQTT command payloads (`"COOLING_ON"`) back to the specific edge node, maintaining room comfort smoothly.

---

## 👥 Group Collaborators & Contributions

This project was built concurrently by three focused teams collaborating via rigid Contract-Driven Development specifications:

- **IoT Group:** Managed the hardware schematic prototyping, breadboard wiring, sensor calibrations, Wi-Fi reconnection logic, and MQTT client configurations inside Arduino IDE.
- **Backend Group:** Implemented the MySQL database schemas, Express API route security middleware, background automation logic loops, and the Gemini API RAG interface helper functions.
- **Frontend Group:** Engineered the complete Android user layout, form input validations, stateful UI bindings for database updates, and chat message interface screens.

---

## 📦 Setup & Installation

### Prerequisites
- Node.js (v18 or higher)
- MySQL (v8.0 or higher)
- npm or yarn package manager

### Environment Variables

Create a `.env` file in the project root based on `.env.example`:

```bash
cp .env.example .env
```

Configure the following environment variables:

```env
# Server Configuration
PORT=3000

# Database Configuration (MySQL)
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_database_password
DB_NAME=SmartHome

# JWT Secret (Change this to a secure random string in production)
JWT_SECRET=your-secret-key-change-in-production

# MQTT Broker Configuration
MQTT_BROKER=mqtts://your-mqtt-broker.com
MQTT_PORT=8883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password

# MQTT Topics
TOPIC_TEMPERATURE=smart_home/temperature
TOPIC_HUMIDITY=smart_home/humidity
TOPIC_OUTSIDE_LED_STATUS=smart_home/outside_led
TOPIC_INSIDE_LED_STATUS=smart_home/inside_led
TOPIC_FAN_STATUS=smart_home/fan
TOPIC_ALERT=smart_home/alert
TOPIC_STATUS=smart_home/status
```

### Database Setup

1. Create a MySQL database named `SmartHome`:

```sql
CREATE DATABASE SmartHome;
```

2. Create the required tables:

```sql
-- Users table
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    fname VARCHAR(255),
    lname VARCHAR(255),
    gender_id INT,
    location VARCHAR(255),
    phone_number VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Microcontrollers table
CREATE TABLE microcontroller (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL UNIQUE,
    user_id INT NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Telemetry table
CREATE TABLE telemetry (
    id INT AUTO_INCREMENT PRIMARY KEY,
    temperature DECIMAL(5,2),
    humidity DECIMAL(5,2),
    light_status ENUM('ON', 'OFF') DEFAULT 'OFF',
    device_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES microcontroller(device_id) ON DELETE CASCADE
);
```

### Installation Steps

1. Install dependencies:

```bash
npm install
```

2. Configure your `.env` file with your database and MQTT broker credentials.

3. Start the server:

```bash
npm start
```

For development with auto-reload:

```bash
npm run start:dev
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

---

## 🔌 REST API Endpoints

### Authentication

#### POST `/register`
Register a new user account.

**Request Body:**
```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "string",
  "token": "string"
}
```

#### POST `/checkUserExists`
Check if an email is already registered.

**Request Body:**
```json
{
  "email": "string"
}
```

**Response:**
```json
{
  "exists": true,
  "userId": "string"
}
```

### Device Management

#### POST `/registerDevice` (Requires Authentication)
Pair a new IoT device to a user.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "userId": "string",
  "deviceId": "string",
  "deviceName": "string",
  "deviceType": "string"
}
```

**Response:**
```json
{
  "success": true,
  "device": {}
}
```

### WebSocket Management

#### POST `/createSocket` (Requires Authentication)
Allocate a WebSocket port for the user's session.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "userId": "string"
}
```

**Response:**
```json
{
  "success": true,
  "port": 443
}
```

#### POST `/registerSocketPort` (Requires Authentication)
Map and save the assigned port configuration.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "userId": "string",
  "port": 443
}
```

**Response:**
```json
{
  "success": true
}
```

### Telemetry

#### POST `/telemetry`
Accept incoming sensor data from devices.

**Request Body:**
```json
{
  "deviceId": "string",
  "temperature": 24.5,
  "humidity": 60.2,
  "timestamp": "2026-07-09T11:20:47Z"
}
```

**Response:**
```json
{
  "status": "logged"
}
```

### MQTT

#### POST `/publishToMQTT` (Requires Authentication)
Relay action commands to the MQTT broker.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "userId": "string",
  "topic": "string",
  "command": "ON/OFF"
}
```

**Response:**
```json
{
  "published": true
}
```

#### POST `/getSubscribedTopicData`
Fetch the latest retained status for a specific topic.

**Request Body:**
```json
{
  "topic": "string"
}
```

**Response:**
```json
{
  "topic": "string",
  "lastState": "string"
}
```

### Health Check

#### GET `/health/db`
Periodic health check for database connectivity.

**Response:**
```json
{
  "status": "healthy",
  "database": "connected"
}
```

---

## 🔌 WebSocket Connection

The server supports real-time updates via Socket.io.

**Connection URL Format:**
```
wss://iot-smart-home-server.onrender.com:443
```

**Event Stream:**
- **Event:** `telemetry`
- **Payload:**
```json
{
  "deviceId": "ESP32_LivingRoom",
  "temperature": 24.5,
  "humidity": 60.2,
  "timestamp": "2026-07-09T11:20:47Z"
}
```

Whenever telemetry is received via POST `/telemetry` or MQTT, it's immediately broadcast over the WebSocket channel.

---

## 🚀 Deployment on Render

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Set the following environment variables in Render dashboard
4. Deploy - Render will automatically install dependencies and start the server

**Important:** Ensure your `JWT_SECRET` is set to a strong random value in production.
