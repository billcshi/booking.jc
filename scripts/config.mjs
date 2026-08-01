export const secretRules = {
  ADMIN_USERNAME: 2,
  ADMIN_PASSWORD: 16,
  AGENT_TOKEN: 32,
  SESSION_SECRET: 32,
};

const knownWeakValues = new Set([
  "friends",
  "admin",
  "change-me",
  "dev-only-change-me",
  "development-only",
]);

export function requiredSecret(name, value) {
  const minimum = secretRules[name];
  if (
    minimum === undefined ||
    !value ||
    value.length < minimum ||
    value.startsWith("replace-with-") ||
    knownWeakValues.has(value)
  ) {
    throw new Error(`${name} must be configured securely`);
  }
  return value;
}

export function validateRuntimeSecrets(environment = process.env) {
  for (const name of Object.keys(secretRules)) {
    requiredSecret(name, environment[name]);
  }
}
