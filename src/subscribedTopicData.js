const subscribedTopicData = new Map();

export function markTopicSubscription(port, topic, subscribed) {
  const topicKey = `${port}:${topic}`;
  subscribedTopicData.set(topicKey, {
    port,
    topic,
    subscribed,
    payload: null
  });
}

export function storeTopicPayload(port, topic, payload) {
  const topicKey = `${port}:${topic}`;
  const existing = subscribedTopicData.get(topicKey) || { port, topic, subscribed: false, payload: null };

  subscribedTopicData.set(topicKey, {
    ...existing,
    payload,
    subscribed: true
  });
}

export function getSubscribedTopicData(port, topic) {
  if (!port || !topic) {
    throw new Error("A port number and topic are required to inspect subscribed data.");
  }

  const topicKey = `${port}:${topic}`;
  const subscriptionState = subscribedTopicData.get(topicKey);

  if (!subscriptionState || !subscriptionState.subscribed) {
    return { ok: false, port, topic, message: "Server is not subscribed to this topic." };
  }

  return {
    ok: true,
    port,
    topic,
    payload: subscriptionState.payload,
    message: "Subscribed topic data is available."
  };
}
