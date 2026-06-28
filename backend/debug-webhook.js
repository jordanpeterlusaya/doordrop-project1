const { config } = require('./config');

function maskSecretValue(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

function shouldMaskKey(key) {
  return /(api.?key|google.*key|secret|authorization|token)$/i.test(String(key || ''));
}

function sanitizePayload(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item, parentKey));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        if (shouldMaskKey(key)) {
          return [key, maskSecretValue(nestedValue)];
        }

        return [key, sanitizePayload(nestedValue, key)];
      })
    );
  }

  if (typeof value === 'string' && shouldMaskKey(parentKey)) {
    return maskSecretValue(value);
  }

  return value;
}

async function sendDebugWebhook(event, payload) {
  const webhookUrl = config.debugWebhookUrl;

  if (!webhookUrl) {
    return;
  }

  const requestBody = {
    event,
    timestamp: new Date().toISOString(),
    payload: sanitizePayload(payload),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.warn(
        `[DoorDrop][DebugWebhook] ${event} failed with ${response.status}`
      );
    }
  } catch (error) {
    console.warn(
      `[DoorDrop][DebugWebhook] ${event} failed`,
      error instanceof Error ? error.message : error
    );
  }
}

module.exports = {
  maskSecretValue,
  sanitizePayload,
  sendDebugWebhook,
};
