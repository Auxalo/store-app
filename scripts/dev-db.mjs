// Local single-node MongoDB replica set for development (transactions need a replica set).
// Data persists in .data/mongo. Usage: pnpm db:dev
import { mkdirSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const port = Number(process.env.DEV_DB_PORT ?? 27018);
const dbPath = ".data/mongo";
mkdirSync(dbPath, { recursive: true });

const rs = await MongoMemoryReplSet.create({
  replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ port, dbPath, storageEngine: "wiredTiger" }],
});

console.log(
  `\nMongoDB replica set ready.\nMONGODB_URI=mongodb://127.0.0.1:${port}/?replicaSet=rs0\n`,
);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await rs.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
