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
