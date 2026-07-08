// Centralized logging utility for the Smart Home backend

const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
  EVENT: 'EVENT'
};

function getTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, data = null) {
  const timestamp = getTimestamp();
  let output = `[${timestamp}] [${level}] ${message}`;
  
  if (data) {
    output += ` | Data: ${JSON.stringify(data)}`;
  }
  
  return output;
}

export function logInfo(message, data = null) {
  console.log(formatMessage(LOG_LEVELS.INFO, message, data));
}

export function logWarn(message, data = null) {
  console.warn(formatMessage(LOG_LEVELS.WARN, message, data));
}

export function logError(message, data = null) {
  console.error(formatMessage(LOG_LEVELS.ERROR, message, data));
}

export function logCritical(message, data = null) {
  console.error(formatMessage(LOG_LEVELS.CRITICAL, message, data));
}

export function logEvent(message, data = null) {
  console.log(formatMessage(LOG_LEVELS.EVENT, message, data));
}

export function logUserConnection(username, port, action = 'connected') {
  logEvent(`👥 User ${action}: ${username} on port ${port}`, { username, port, action });
}

export function logServiceFailure(service, error) {
  logCritical(`❌ ${service} service failure!`, { service, error: error.message });
}

export function logServiceRecovery(service) {
  logInfo(`✅ ${service} service recovered`);
}

// System report function for active services and port allocation
export function generateSystemReport(metrics) {
  const {
    coreServerPort,
    coreServerStatus,
    databaseStatus,
    mqttStatus,
    mqttTopicsCount,
    activeSocketServers,
    activePortAllocations
  } = metrics;

  const timestamp = new Date().toISOString();
  
  const report = `
=============== SYSTEM SERVICE REPORT ================
⏰ Timestamp: ${timestamp}
🟢 Core Server Status: ${coreServerStatus} (Port ${coreServerPort})
🗄️ Database Status: ${databaseStatus}
📡 MQTT Broker Status: ${mqttStatus} (Subscribed to ${mqttTopicsCount} topics)
👥 Active User Sockets: ${activePortAllocations} active port allocations
🔌 Active Socket Servers: ${activeSocketServers} running
======================================================
`;

  console.log(report);
  return {
    timestamp,
    coreServerPort,
    coreServerStatus,
    databaseStatus,
    mqttStatus,
    mqttTopicsCount,
    activeSocketServers,
    activePortAllocations
  };
}

export { LOG_LEVELS };
