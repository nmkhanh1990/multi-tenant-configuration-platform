import { describe, expect, it } from "vitest";
import {
  CLAIM_TYPES,
  SAMPLE_TENANTS,
  TenantConfigSchema
} from "./index.js";

describe("tenant configuration models", () => {
  it("provides valid sample tenants for every segment in the brief", () => {
    expect(SAMPLE_TENANTS.map((tenant) => tenant.name)).toEqual([
      "SafeGuard Insurance",
      "HealthFirst",
      "GovHealth"
    ]);
    expect(SAMPLE_TENANTS.every((tenant) => TenantConfigSchema.safeParse(tenant.config).success)).toBe(true);
  });

  it("covers every supported claim type in each tenant configuration", () => {
    for (const tenant of SAMPLE_TENANTS) {
      expect(Object.keys(tenant.config.claimTypes).sort()).toEqual([...CLAIM_TYPES].sort());
    }
  });

  it("rejects a negative auto-approval threshold", () => {
    const config = structuredClone(SAMPLE_TENANTS[0]!.config);
    config.approval.autoApprovalThreshold = -1;

    expect(TenantConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects configurations with no enabled claim types", () => {
    const config = structuredClone(SAMPLE_TENANTS[0]!.config);
    for (const claimType of CLAIM_TYPES) {
      const claimTypeConfig = config.claimTypes[claimType];
      if (claimTypeConfig) {
        claimTypeConfig.enabled = false;
      }
    }

    expect(TenantConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects non-positive SLA targets", () => {
    const config = structuredClone(SAMPLE_TENANTS[0]!.config);
    config.sla.byClaimType.OUTPATIENT = 0;

    expect(TenantConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects approval tier gaps", () => {
    const config = structuredClone(SAMPLE_TENANTS[0]!.config);
    config.approval.tiers[0]!.maxAmount = 90000;

    expect(TenantConfigSchema.safeParse(config).success).toBe(false);
  });
});
