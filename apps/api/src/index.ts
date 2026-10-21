import express from "express";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp, seedSampleTenants } from "./app.js";
import { createDatabase } from "./database.js";
import { TenantStore } from "./tenant-store.js";

export function startServer(): ReturnType<ReturnType<typeof createApp>["listen"]> {
  const port = Number(process.env.PORT ?? 3001);
  const databasePath = process.env.DATABASE_PATH ?? resolve("data", "platform.sqlite");
  const database = createDatabase(databasePath);
  const store = new TenantStore(database);
  seedSampleTenants(store);
  const app = createApp(store);

  const server = app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });

  const close = (): void => {
    server.close(() => {
      database.close();
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer();
}
