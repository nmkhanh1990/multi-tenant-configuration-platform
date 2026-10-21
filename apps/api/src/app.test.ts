import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_TENANTS, type Tenant } from "@mtcp/shared";
import { createApp, seedSampleTenants } from "./app.js";
import { createDatabase } from "./database.js";
import { TenantStore, type TenantRecord } from "./tenant-store.js";

let server: Server;
let database: ReturnType<typeof createDatabase>;
let baseUrl: string;

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

beforeEach(async () => {
  database = createDatabase(":memory:");
  const store = new TenantStore(database);
  seedSampleTenants(store);
  const app = createApp(store);
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API test server did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  database.close();
});

describe("tenant API and claim processing", () => {
  it("allows the configured web app to make cross-origin API requests", async () => {
    const response = await fetch(`${baseUrl}/api/tenants`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("seeds sample tenants only when the database is empty", async () => {
    const response = await request("/api/tenants");
    const body = await response.json() as { tenants: TenantRecord[] };

    expect(response.status).toBe(200);
    expect(body.tenants).toHaveLength(3);
    expect(body.tenants.every((tenant) => tenant.currentVersion === 1)).toBe(true);

    seedSampleTenants(new TenantStore(database));
    expect(new TenantStore(database).list()).toHaveLength(3);
  });

  it("returns distinct processing outcomes for one claim across three tenants", async () => {
    const sampleClaim = {
      claimType: "OUTPATIENT",
      amount: 10000,
      submittedAt: "2026-10-23T09:00:00.000Z",
      customFields: {}
    };
    const results = await Promise.all(SAMPLE_TENANTS.map(async (tenant) => {
      const response = await request(`/api/tenants/${tenant.id}/preview`, {
        method: "POST",
        body: JSON.stringify(sampleClaim)
      });
      expect(response.status).toBe(200);
      return (await response.json() as { result: {
        approval: { autoApproved: boolean; approverRole: string | null };
        notifications: Array<{ event: string; channels: string[] }>;
        sla: { deadline: string };
        customFields: { valid: boolean };
        requiredDocuments: Array<{ id: string }>;
      } }).result;
    }));

    expect(results.map((result) => result.approval.approverRole)).toEqual([
      null,
      "assessor",
      "committee"
    ]);
    expect(results.map((result) => result.notifications[0]?.channels)).toEqual([
      ["email"],
      ["email", "sms"],
      ["email", "webhook"]
    ]);
    expect(results[0]?.notifications.map((notification) => notification.event)).toEqual([
      "claim_submitted",
      "approved"
    ]);
    expect(results[1]?.notifications.map((notification) => notification.event)).toEqual([
      "claim_submitted"
    ]);
    expect(results.map((result) => result.sla.deadline)).toEqual([
      "2026-10-30T09:00:00.000Z",
      "2026-11-03T09:00:00.000Z",
      "2026-11-13T09:00:00.000Z"
    ]);
    expect(results[0]?.customFields.valid).toBe(false);
    expect(results[2]?.requiredDocuments.map((document) => document.id)).toContain("budget_approval");
  });

  it("routes claims at the exact auto-approval threshold to a manual tier", async () => {
    const response = await request("/api/tenants/healthfirst/preview", {
      method: "POST",
      body: JSON.stringify({
        claimType: "OUTPATIENT",
        amount: 5000,
        submittedAt: "2026-10-23T09:00:00.000Z"
      })
    });
    const body = await response.json() as {
      result: { approval: { autoApproved: boolean; approverRole: string | null } };
    };

    expect(body.result.approval).toEqual({ autoApproved: false, approverRole: "assessor", tier: {
      minAmount: 5000,
      maxAmount: 100000
    } });
  });

  it("creates immutable snapshots and rolls back by creating a new version", async () => {
    const tenantId = "safeguard-insurance";
    const currentResponse = await request(`/api/tenants/${tenantId}`);
    const current = (await currentResponse.json() as { tenant: Tenant & { currentVersion: number } }).tenant;
    const updatedConfig = structuredClone(current.config);
    updatedConfig.branding.primaryColor = "#123456";

    const updateResponse = await request(`/api/tenants/${tenantId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: current.name,
        segment: current.segment,
        config: updatedConfig,
        expectedVersion: 1,
        createdBy: "operator-1"
      })
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json() as { tenant: { currentVersion: number } }).tenant.currentVersion)
      .toBe(2);

    const rollbackResponse = await request(
      `/api/tenants/${tenantId}/versions/1/rollback`,
      json({ createdBy: "operator-2" })
    );
    expect(rollbackResponse.status).toBe(200);
    const rolledBack = (await rollbackResponse.json() as { tenant: Tenant & {
      currentVersion: number;
    } }).tenant;
    expect(rolledBack.currentVersion).toBe(3);
    expect(rolledBack.config.branding.primaryColor).toBe(current.config.branding.primaryColor);

    const historyResponse = await request(`/api/tenants/${tenantId}/versions`);
    const history = (await historyResponse.json() as { versions: Array<{
      version: number;
      note: string | null;
      createdBy: string;
    }> }).versions;
    expect(history.map((version) => version.version)).toEqual([3, 2, 1]);
    expect(history[0]?.note).toBe("Rollback to version 1");
    expect(history[1]?.createdBy).toBe("operator-1");
  });

  it("rejects invalid configuration and stale writes", async () => {
    const current = (await (await request("/api/tenants/govhealth")).json() as {
      tenant: Tenant;
    }).tenant;
    const invalidConfig = structuredClone(current.config);
    invalidConfig.approval.autoApprovalThreshold = -1;

    const invalidResponse = await request("/api/tenants/govhealth", {
      method: "PUT",
      body: JSON.stringify({
        name: current.name,
        segment: current.segment,
        config: invalidConfig,
        expectedVersion: 1
      })
    });
    expect(invalidResponse.status).toBe(400);

    const staleResponse = await request("/api/tenants/govhealth", {
      method: "PUT",
      body: JSON.stringify({
        name: current.name,
        segment: current.segment,
        config: current.config,
        expectedVersion: 2
      })
    });
    expect(staleResponse.status).toBe(409);
  });

  it("compares configs and supports onboarding and deleting a fourth tenant", async () => {
    const compareResponse = await request("/api/tenants/compare", json({
      leftTenantId: "safeguard-insurance",
      rightTenantId: "healthfirst"
    }));
    const comparison = await compareResponse.json() as {
      differences: Array<{ path: string }>;
    };
    expect(compareResponse.status).toBe(200);
    expect(comparison.differences.map((difference) => difference.path)).toContain(
      "approval.autoApprovalThreshold"
    );
    expect(comparison.differences.map((difference) => difference.path)).toContain(
      "claimTypes.MATERNITY.enabled"
    );

    const fourthTenant = structuredClone(SAMPLE_TENANTS[0]!);
    fourthTenant.id = "new-insurer";
    fourthTenant.name = "New Insurer";
    fourthTenant.config.branding.companyName = "New Insurer";
    const createResponse = await request("/api/tenants", json(fourthTenant));
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json() as { tenant: { currentVersion: number } }).tenant.currentVersion)
      .toBe(1);

    const claimResponse = await request("/api/claims/process", json({
      tenantId: fourthTenant.id,
      claimData: {
        claimType: "OUTPATIENT",
        amount: 1000,
        submittedAt: "2026-10-23T09:00:00.000Z",
        customFields: { employee_id: "E-123" }
      }
    }));
    expect(claimResponse.status).toBe(200);

    const deleteResponse = await request(`/api/tenants/${fourthTenant.id}`, {
      method: "DELETE"
    });
    expect(deleteResponse.status).toBe(204);
    expect((await request(`/api/tenants/${fourthTenant.id}`)).status).toBe(404);
  });

  it("rejects disabled claim types and invalid custom field values", async () => {
    const disabledResponse = await request("/api/tenants/govhealth/preview", {
      method: "POST",
      body: JSON.stringify({
        claimType: "DENTAL",
        amount: 1,
        submittedAt: "2026-10-23T09:00:00.000Z"
      })
    });
    expect(disabledResponse.status).toBe(422);

    const invalidFieldsResponse = await request("/api/tenants/govhealth/preview", {
      method: "POST",
      body: JSON.stringify({
        claimType: "OUTPATIENT",
        amount: 1,
        submittedAt: "2026-10-23T09:00:00.000Z",
        customFields: { department: "Finance" }
      })
    });
    const body = await invalidFieldsResponse.json() as {
      result: { customFields: { valid: boolean; errors: string[] } };
    };
    expect(invalidFieldsResponse.status).toBe(200);
    expect(body.result.customFields.valid).toBe(false);
    expect(body.result.customFields.errors).toContain("Budget Code is required");
  });

  it("returns a claim validation error for invalid processing input", async () => {
    const response = await request("/api/claims/process", json({
      tenantId: "healthfirst",
      claimData: {
        claimType: "OUTPATIENT",
        amount: -1,
        submittedAt: "2026-10-23T09:00:00.000Z"
      }
    }));

    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_claim");
  });

  it("validates date, number, and select custom field types", async () => {
    const tenant = structuredClone(SAMPLE_TENANTS[1]!);
    tenant.id = "field-validation";
    tenant.name = "Field Validation";
    tenant.config.customFields = [
      { id: "effective_date", label: "Effective Date", type: "date", required: true },
      {
        id: "urgency",
        label: "Urgency",
        type: "select",
        required: true,
        options: ["routine", "urgent"]
      },
      { id: "dependents", label: "Dependents", type: "number", required: true }
    ];
    const createResponse = await request("/api/tenants", json(tenant));
    expect(createResponse.status).toBe(201);

    const previewResponse = await request(`/api/tenants/${tenant.id}/preview`, {
      method: "POST",
      body: JSON.stringify({
        claimType: "OUTPATIENT",
        amount: 100,
        submittedAt: "2026-10-23T09:00:00.000Z",
        customFields: {
          effective_date: "2025-02-31",
          urgency: "immediate",
          dependents: "two",
          unexpected: true
        }
      })
    });
    const body = await previewResponse.json() as {
      result: { customFields: { valid: boolean; errors: string[] } };
    };

    expect(body.result.customFields.valid).toBe(false);
    expect(body.result.customFields.errors).toEqual(expect.arrayContaining([
      "Effective Date must be a valid date",
      "Urgency must be one of the configured options",
      "Dependents must be a finite number",
      'Unknown custom field "unexpected"'
    ]));
  });
});
