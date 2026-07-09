import mqtt from "mqtt";
import { logServiceFailure, logServiceRecovery, logError, logInfo } from "./logger.js";

export function connectToMQTT (brokerUrl = process.env.MQTT_BROKER, MQTT_PORT = process.env.MQTT_PORT) {
  if (!brokerUrl || !MQTT_PORT) {
    throw new Error("MQTT broker URL and port are required. Set process.env.MQTT_BROKER and process.env.MQTT_PORT.");
  }
  // Extract just the host name from your URL (remove the mqtts:// prefix)
  const host = brokerUrl.replace("mqtts://", "").replace("mqtt://", "");

  const OPTIONS = {
    host: host,
    port: MQTT_PORT,
    protocol: "mqtts", // 🔒 Force the library to use TLS explicitly
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clean: true,
    rejectUnauthorized: true,
    keepalive: 60,
    reconnectPeriod: 5000
  };

  console.log(`📡 Testing connection to host: ${host}`);
  if(!brokerUrl)
    throw new Error("MQTT_URL is undefined. Check if your .env file has the correct variable name!");
  const client = mqtt.connect(brokerUrl, OPTIONS);

  client.on("connect", () => {
    logInfo(`Connected to MQTT broker at ${brokerUrl}`);
    logServiceRecovery('MQTT');
  });

  client.on("error", (error) => {
    logServiceFailure('MQTT', error);
  });

  client.on("offline", () => {
    logServiceFailure('MQTT', new Error('MQTT client went offline'));
  });

  client.on("reconnect", () => {
    logInfo('MQTT client attempting to reconnect...');
  });

  client.on("close", () => {
    logError('MQTT connection closed');
  });

  return client;
}

export function publishToMQTT(client, topic, message, options = {}) {
  if (!client || typeof client.publish !== "function") {
    throw new Error("A valid MQTT client is required.");
  }

  const payload = typeof message === "string" ? message : JSON.stringify(message);
  client.publish(topic, payload, options);
  return client;
}

export function subscribeToMQTT(client, topic, callback) {
  if (!client || typeof client.subscribe !== "function") {
    throw new Error("A valid MQTT client is required.");
  }

  client.subscribe(topic, (error) => {
    if (error) {
      console.error(`Failed to subscribe to topic ${topic}:`, error);
      return;
    }

    console.log(`Subscribed to MQTT topic: ${topic}`);
  });

  if (typeof callback === "function") {
    client.on("message", callback);
  }

  return client;
}
