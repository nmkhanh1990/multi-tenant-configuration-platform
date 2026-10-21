import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_TENANTS } from "@mtcp/shared";
import { createDatabase } from "./database.js";
import { TenantStore } from "./tenant-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite persistence", () => {
  it("persists tenant configs and immutable history across database connections", () => {
    const directory = mkdtempSync(join(tmpdir(), "mtcp-sqlite-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "platform.sqlite");
    const firstDatabase = createDatabase(databasePath);
    const firstStore = new TenantStore(firstDatabase);
    firstStore.create(SAMPLE_TENANTS[0]!, "test");
    firstDatabase.close();

    const reopenedDatabase = createDatabase(databasePath);
    try {
      const reopenedStore = new TenantStore(reopenedDatabase);
      expect(reopenedStore.get("safeguard-insurance").config.branding.companyName)
        .toBe("SafeGuard Insurance");
      expect(reopenedStore.listVersions("safeguard-insurance")).toHaveLength(1);
    } finally {
      reopenedDatabase.close();
    }
  });
});
