import { createInterface } from "node:readline/promises";
import {
  databasePathFromEnvironment,
  databaseHasGroupKey,
  databaseHasPermanentHome,
  defaultHomeConfiguration,
  homeConfigurationFromEnvironment,
  generateGroupKey,
  initializeDatabase,
  parseHomeResources,
} from "./database.mjs";

const databasePath = databasePathFromEnvironment();
const hadGroupKey = databaseHasGroupKey(databasePath);
const requestKey = generateGroupKey();
let home;
try {
  home = homeConfigurationFromEnvironment();
  if (process.argv.includes("--interactive") && databaseHasPermanentHome(databasePath)) {
    console.log("The permanent home already exists. Use the Admin console to edit it.");
  } else if (process.argv.includes("--interactive")) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answers = prompt[Symbol.asyncIterator]();
    async function ask(message) {
      process.stdout.write(message);
      const answer = await answers.next();
      return answer.done ? "" : answer.value.trim();
    }
    console.log("Configure the permanent home. Private values are stored only in SQLite.");
    const name = await ask(`Home name [${home.name}]: `);
    const location = await ask(`Location label [${home.location}]: `);
    const defaultResources = home.resources
      .map((resource) => {
        const flags = [
          resource.requiresSofaConsent ? "sofa" : "",
          resource.adminOnly ? "hidden" : "",
        ].filter(Boolean);
        if (!flags.length) flags.push("normal");
        return `${resource.name} | ${resource.capacity} | ${flags.join(",")}`;
      })
      .join("; ");
    console.log("Resource flags: normal, sofa (requires guest consent), hidden (admin-only).");
    const resources = await ask(`Resources [${defaultResources}]: `);
    prompt.close();
    home = {
      name: name || home.name || defaultHomeConfiguration.name,
      location: location || home.location || defaultHomeConfiguration.location,
      resources: resources ? parseHomeResources(resources) : home.resources,
    };
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Initial home configuration is invalid");
  process.exit(1);
}

const db = initializeDatabase({ databasePath, requestKey, home });
const tableCount = db
  .prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .get().count;
const activeGroupKey = db.prepare("SELECT value FROM settings WHERE key='group_key'").get().value;
db.close();

console.log(`Database initialized successfully (${tableCount} tables).`);
if (!hadGroupKey) console.log(`Generated group key (save it now): ${activeGroupKey}`);
