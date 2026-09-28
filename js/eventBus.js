let requiredKeys = null;
let started = false;

const subscribers = [];
const pendingMessages = [];

function validate(message) {
  if (!requiredKeys.every(key => key in message)) {
    throw new Error("Invalid message");
  }
}

function dispatch(message) {
  validate(message);

  for (const { filter, callback } of subscribers) {
    const matches = Object.entries(filter).every(
      ([key, value]) => message[key] === value
    );

    if (matches) {
      callback(message);
    }
  }
}

// Every module imports this single function.
export function publish(message) {
  if (!started) {
    pendingMessages.push(message);
    return;
  }

  dispatch(message);
}

function subscribe(filter, callback) {
  subscribers.push({ filter, callback });

  return function unsubscribe() {
    const index = subscribers.findIndex(
      subscriber =>
        subscriber.filter === filter &&
        subscriber.callback === callback
    );

    if (index >= 0) {
      subscribers.splice(index, 1);
    }
  };
}

const bus = Object.freeze({
  publish,
  subscribe
});

// Only app.js calls this.
export default function initializeEventBus(shape) {
  if (!requiredKeys) {
    requiredKeys = Object.keys(shape);
  }

  return bus;
}

// app.js calls this after registering all initial subscribers.
export function startEventBus() {
  if (!requiredKeys) {
    throw new Error("The event bus has not been initialized.");
  }

  if (started) {
    return;
  }

  // Validate everything before changing the bus state.
  for (const message of pendingMessages) {
    validate(message);
  }

  started = true;

  for (const message of pendingMessages.splice(0)) {
    dispatch(message);
  }
}