import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const environmentPath = path.join(process.cwd(), ".env");

function randomHex(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

function secureMode() {
  if (process.platform === "win32") return;
  fs.chmodSync(environmentPath, 0o600);
}

if (fs.existsSync(environmentPath)) {
  const existing = fs.readFileSync(environmentPath, "utf8");
  if (!/^AGENT_TOKEN=.+$/m.test(existing)) {
    const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(environmentPath, `${prefix}AGENT_TOKEN=${randomHex()}\n`);
    secureMode();
    console.log("Added a private Agent Token to .env (value not printed).");
  } else {
    console.log("Existing .env and Agent Token were preserved.");
  }
} else {
  const publishedPort = process.env.HOST_PORT ?? "3000";
  if (!/^\d+$/.test(publishedPort)) {
    console.error("HOST_PORT must be a number.");
    process.exit(1);
  }
  const content = [
    "DATABASE_PATH=./data/booking.db",
    "ADMIN_USERNAME=host",
    `ADMIN_PASSWORD=${randomBytes(24).toString("base64url")}`,
    `AGENT_TOKEN=${randomHex()}`,
    `SESSION_SECRET=${randomHex()}`,
    "APP_TIME_ZONE=UTC",
    `HOST_PORT=${publishedPort}`,
    "TRUST_PROXY=0",
    "INITIAL_HOME_NAME=Home",
    "INITIAL_HOME_LOCATION=Seattle",
    'INITIAL_HOME_RESOURCES="Guest bed | 2 | normal; Sofa | 1 | sofa; Air mattress | 1 | hidden"',
    "",
  ].join("\n");
  fs.writeFileSync(environmentPath, content, { flag: "wx", mode: 0o600 });
  secureMode();
  console.log("Created private .env with Admin, session, and Agent credentials (values not printed).");
}
