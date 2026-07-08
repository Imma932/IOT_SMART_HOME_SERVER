import { Server } from "socket.io";
import { markTopicSubscription } from "./subscribedTopicData.js";
import { io as clientIo } from "socket.io-client";
import { logUserConnection, logEvent, logError } from "./logger.js";

const socketServers = new Map();
const socketClients = new Map(); // Track connected client sockets
const socketPortUserMap = new Map(); // Local storage mapping socket port to username

export function createSocketConnection(port, options = {}) {
  if (!port) {
    throw new Error("A port number is required to create a socket connection.");
  }

  if (options.username) {
    setSocketPortUser(port, options.username);
    logUserConnection(options.username, port, 'connection initialized');
  }

  const io = new Server(port, {
    cors: {
      origin: "*"
    }
  });

  io.on("connection", (socket) => {
    const username = socketPortUserMap.get(port);
    logEvent(`🔌 Socket.io client connected on port ${port}`, { username, port });

    socket.on("message", (message) => {
      console.log("Received message:", message);
      socket.emit("message", message);
    });

    socket.on("subscribe", (topic) => {
      markTopicSubscription(port, topic, true);
      console.log(`Socket subscribed to topic ${topic} on port ${port}`);
    });

    socket.on("unsubscribe", (topic) => {
      markTopicSubscription(port, topic, false);
      console.log(`Socket unsubscribed from topic ${topic} on port ${port}`);
    });

    socket.on("disconnect", () => {
      const username = socketPortUserMap.get(port);
      logEvent(`🔌 Socket.io client disconnected from port ${port}`, { username, port });
    });
  });

  socketServers.set(port, io);
  return io;
}

export function setSocketPortUser(port, username) {
  if (!port || !username) {
    throw new Error("Both port and username are required to register a socket user.");
  }
  socketPortUserMap.set(port, username);
}

export function getSocketPortUser(port) {
  return socketPortUserMap.get(port) || null;
}

export function getPortsForUser(username) {
  if (!username) return [];
  const ports = [];
  for (const [port, storedUsername] of socketPortUserMap.entries()) {
    if (storedUsername === username) {
      ports.push(port);
    }
  }
  return ports;
}

export function sendTelemetryOverSocket(port, telemetryData) {
  if (!port) {
    throw new Error("A port number is required to send telemetry.");
  }

  if (!telemetryData) {
    throw new Error("Telemetry data is required.");
  }

  const server = socketServers.get(port);

  if (!server) {
    return {
      ok: false,
      port,
      message: "Socket server does not exist on this port."
    };
  }

  server.emit("telemetry", telemetryData);
  return {
    ok: true,
    port,
    message: "Telemetry data sent successfully.",
    data: telemetryData
  };
}

export function hasSocketServer(port) {
  return socketServers.has(port);
}

export function getActivePortAllocationsCount() {
  return socketPortUserMap.size;
}

export function getActiveSocketServersCount() {
  return socketServers.size;
}

export function getSocketPortUserMap() {
  return socketPortUserMap;
}

export function closeSocketConnection(target) {
  const server = typeof target === "number" ? socketServers.get(target) : target;

  if (!server) {
    throw new Error("A socket connection was not found for the provided port or instance.");
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (typeof target === "number") {
        socketServers.delete(target);
      }

      if (error) {
        reject(error);
        return;
      }

      const address = server.httpServer?.address?.();
      resolve({ ok: true, port: address?.port ?? null });
    });
  });
}

export function testSocketConnection(port, timeout = 2000) {
  if (!port) {
    throw new Error("A port number is required to test a socket connection.");
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    
    // Connect explicitly using the Socket.io client protocol
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      timeout: timeout,
      transports: ["websocket"] 
    });

    socket.on("connect", () => {
      socket.disconnect();
      resolve({ ok: true, port, elapsedMs: Date.now() - startedAt });
    });

    socket.on("connect_error", (error) => {
      socket.disconnect();
      resolve({ ok: false, port, reason: error.message, elapsedMs: Date.now() - startedAt });
    });
  });
}

export function sendSocketData(port, eventName, payload) {
  if (!port) {
    throw new Error("A port number is required to send data through a socket.");
  }

  const server = socketServers.get(port);

  if (!server) {
    return { ok: false, port, message: "Socket server does not exist on this port." };
  }

  server.emit(eventName, payload);
  return { ok: true, port, message: "Data sent to connected clients." };
}

export function connectToSocket(port, options = {}) {
  if (!port) {
    throw new Error("A port number is required to connect to a socket.");
  }

  return new Promise((resolve, reject) => {
    try {
      const socket = clientIo(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        timeout: options.timeout || 5000,
        reconnection: options.reconnection !== false,
        reconnectionDelay: options.reconnectionDelay || 1000,
        reconnectionDelayMax: options.reconnectionDelayMax || 5000,
        reconnectionAttempts: options.reconnectionAttempts || 5
      });

      socket.on("connect", () => {
        socketClients.set(port, socket);
        console.log(`✅ Connected to socket server on port ${port}`);
        resolve({ ok: true, connected: true, port, message: "Successfully connected to socket server." });
      });

      socket.on("connect_error", (error) => {
        console.error(`❌ Connection error on port ${port}:`, error.message);
        reject(new Error(`Failed to connect to socket on port ${port}: ${error.message}`));
      });

      socket.on("disconnect", () => {
        socketClients.delete(port);
        console.log(`⚠️ Disconnected from socket server on port ${port}`);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function broadcastTelemetryToUser(username, telemetryData) {
  if (!username) {
    throw new Error("A username is required to broadcast telemetry to user ports.");
  }

  if (!telemetryData) {
    throw new Error("Telemetry data is required.");
  }

  const ports = getPortsForUser(username);
  if (!ports.length) {
    return {
      ok: false,
      username,
      message: "No socket ports registered for this user."
    };
  }

  const results = ports.map((port) => sendSocketData(port, "telemetry", telemetryData));
  return {
    ok: true,
    username,
    results,
    message: "Telemetry data broadcast to user ports."
  };
}

