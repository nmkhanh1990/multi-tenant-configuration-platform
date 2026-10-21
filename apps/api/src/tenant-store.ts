import type Database from "better-sqlite3";
import {
  TenantSchema,
  TenantVersionSchema,
  type Tenant,
  type TenantConfig,
  type TenantSegment,
  type TenantVersion
} from "@mtcp/shared";
import { ApiError } from "./errors.js";

interface TenantRow {
  id: string;
  name: string;
  segment: string;
  created_at: string;
  updated_at: string;
  current_version: number;
  config_json: string;
}

interface VersionRow {
  tenant_id: string;
  version: number;
  config_json: string;
  created_at: string;
  created_by: string;
  note: string | null;
}

export interface TenantRecord extends Tenant {
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
}

export interface UpdateTenantInput {
  name: string;
  segment: TenantSegment;
  config: TenantConfig;
  expectedVersion: number;
  note: string | null;
  createdBy: string;
}

function parseConfig(configJson: string): TenantConfig {
  let value: unknown;
  try {
    value = JSON.parse(configJson);
  } catch (error) {
    throw new Error("A stored tenant configuration is not valid JSON", { cause: error });
  }

  return TenantSchema.shape.config.parse(value);
}

function mapTenant(row: TenantRow): TenantRecord {
  return {
    ...TenantSchema.parse({
      id: row.id,
      name: row.name,
      segment: row.segment,
      config: parseConfig(row.config_json)
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentVersion: row.current_version
  };
}

function mapVersion(row: VersionRow): TenantVersion {
  return TenantVersionSchema.parse({
    tenantId: row.tenant_id,
    version: row.version,
    config: parseConfig(row.config_json),
    createdAt: row.created_at,
    createdBy: row.created_by,
    note: row.note
  });
}

export class TenantStore {
  constructor(private readonly database: Database.Database) {}

  list(): TenantRecord[] {
    const rows = this.database.prepare(`
      SELECT tenants.id, tenants.name, tenants.segment, tenants.created_at,
             tenants.updated_at, tenants.current_version, tenant_versions.config_json
      FROM tenants
      JOIN tenant_versions
        ON tenant_versions.tenant_id = tenants.id
       AND tenant_versions.version = tenants.current_version
      ORDER BY tenants.name COLLATE NOCASE, tenants.id
    `).all() as TenantRow[];

    return rows.map(mapTenant);
  }

  get(id: string): TenantRecord {
    const row = this.database.prepare(`
      SELECT tenants.id, tenants.name, tenants.segment, tenants.created_at,
             tenants.updated_at, tenants.current_version, tenant_versions.config_json
      FROM tenants
      JOIN tenant_versions
        ON tenant_versions.tenant_id = tenants.id
       AND tenant_versions.version = tenants.current_version
      WHERE tenants.id = ?
    `).get(id) as TenantRow | undefined;

    if (!row) {
      throw new ApiError(404, "tenant_not_found", `Tenant "${id}" was not found`);
    }
    return mapTenant(row);
  }

  create(tenant: Tenant, createdBy: string): TenantRecord {
    const now = new Date().toISOString();
    const createTransaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO tenants (id, name, segment, created_at, updated_at, current_version)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(tenant.id, tenant.name, tenant.segment, now, now);

      this.database.prepare(`
        INSERT INTO tenant_versions (tenant_id, version, config_json, created_at, created_by, note)
        VALUES (?, 1, ?, ?, ?, ?)
      `).run(tenant.id, JSON.stringify(tenant.config), now, createdBy, "Initial configuration");
    });

    try {
      createTransaction();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new ApiError(409, "tenant_already_exists", `Tenant "${tenant.id}" already exists`);
      }
      throw error;
    }

    return this.get(tenant.id);
  }

  update(id: string, input: UpdateTenantInput): TenantRecord {
    const now = new Date().toISOString();
    const saveTransaction = this.database.transaction(() => {
      const current = this.database.prepare(
        "SELECT current_version FROM tenants WHERE id = ?"
      ).get(id) as { current_version: number } | undefined;

      if (!current) {
        throw new ApiError(404, "tenant_not_found", `Tenant "${id}" was not found`);
      }
      if (current.current_version !== input.expectedVersion) {
        throw new ApiError(
          409,
          "version_conflict",
          `Tenant "${id}" is at version ${current.current_version}; reload before saving`
        );
      }

      const version = current.current_version + 1;
      this.database.prepare(`
        INSERT INTO tenant_versions (tenant_id, version, config_json, created_at, created_by, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, version, JSON.stringify(input.config), now, input.createdBy, input.note);

      this.database.prepare(`
        UPDATE tenants
        SET name = ?, segment = ?, updated_at = ?, current_version = ?
        WHERE id = ? AND current_version = ?
      `).run(input.name, input.segment, now, version, id, input.expectedVersion);
    });

    saveTransaction();
    return this.get(id);
  }

  delete(id: string): void {
    const result = this.database.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw new ApiError(404, "tenant_not_found", `Tenant "${id}" was not found`);
    }
  }

  listVersions(tenantId: string): TenantVersion[] {
    this.get(tenantId);
    const rows = this.database.prepare(`
      SELECT tenant_id, version, config_json, created_at, created_by, note
      FROM tenant_versions
      WHERE tenant_id = ?
      ORDER BY version DESC
    `).all(tenantId) as VersionRow[];

    return rows.map(mapVersion);
  }

  getVersion(tenantId: string, version: number): TenantVersion {
    const row = this.database.prepare(`
      SELECT tenant_id, version, config_json, created_at, created_by, note
      FROM tenant_versions
      WHERE tenant_id = ? AND version = ?
    `).get(tenantId, version) as VersionRow | undefined;

    if (!row) {
      throw new ApiError(
        404,
        "version_not_found",
        `Version ${version} for tenant "${tenantId}" was not found`
      );
    }
    return mapVersion(row);
  }

  rollback(
    tenantId: string,
    version: number,
    createdBy: string
  ): TenantRecord {
    const target = this.getVersion(tenantId, version);
    const current = this.get(tenantId);
    return this.update(tenantId, {
      name: current.name,
      segment: current.segment,
      config: target.config,
      expectedVersion: this.currentVersion(tenantId),
      createdBy,
      note: `Rollback to version ${version}`
    });
  }

  currentVersion(tenantId: string): number {
    const row = this.database.prepare(
      "SELECT current_version FROM tenants WHERE id = ?"
    ).get(tenantId) as { current_version: number } | undefined;

    if (!row) {
      throw new ApiError(404, "tenant_not_found", `Tenant "${tenantId}" was not found`);
    }
    return row.current_version;
  }
}
