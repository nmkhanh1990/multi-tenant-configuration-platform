import {
  ClaimDataSchema,
  type ClaimData,
  type ClaimType,
  type NotificationEvent,
  type Tenant,
  type TenantConfig
} from "@mtcp/shared";
import { ApiError } from "./errors.js";

export interface ClaimProcessingResult {
  tenantId: string;
  claimType: ClaimType;
  amount: number;
  requiredDocuments: NonNullable<
    TenantConfig["claimTypes"][ClaimType]
  >["requiredDocuments"];
  approval: {
    autoApproved: boolean;
    approverRole: string | null;
    tier: {
      minAmount: number;
      maxAmount: number | null;
    } | null;
  };
  notifications: Array<{
    event: NotificationEvent;
    channels: NonNullable<
      TenantConfig["notifications"][NotificationEvent]
    >["channels"];
    emailTemplate?: string | null;
  }>;
  sla: {
    targetBusinessDays: number;
    deadline: string;
  };
  customFields: {
    required: TenantConfig["customFields"];
    valid: boolean;
    errors: string[];
  };
}

function addBusinessDays(date: Date, businessDays: number): Date {
  const deadline = new Date(date);
  let remainingDays = businessDays;

  while (remainingDays > 0) {
    deadline.setUTCDate(deadline.getUTCDate() + 1);
    const weekday = deadline.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      remainingDays -= 1;
    }
  }

  return deadline;
}

function validateCustomFields(
  tenant: Tenant,
  values: Record<string, unknown>
): ClaimProcessingResult["customFields"] {
  const errors: string[] = [];
  const fieldsById = new Map(tenant.config.customFields.map((field) => [field.id, field]));

  for (const field of tenant.config.customFields) {
    const value = values[field.id];
    const missing = value === undefined
      || value === null
      || (typeof value === "string" && value.trim() === "");

    if (missing) {
      if (field.required) {
        errors.push(`${field.label} is required`);
      }
      continue;
    }

    switch (field.type) {
      case "text":
        if (typeof value !== "string") {
          errors.push(`${field.label} must be text`);
        }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`${field.label} must be a finite number`);
        }
        break;
      case "date":
        if (typeof value !== "string" || !isCalendarDate(value)) {
          errors.push(`${field.label} must be a valid date`);
        }
        break;
      case "select":
        if (typeof value !== "string" || !field.options?.includes(value)) {
          errors.push(`${field.label} must be one of the configured options`);
        }
        break;
    }
  }

  for (const fieldId of Object.keys(values)) {
    if (!fieldsById.has(fieldId)) {
      errors.push(`Unknown custom field "${fieldId}"`);
    }
  }

  return {
    required: tenant.config.customFields.filter((field) => field.required),
    valid: errors.length === 0,
    errors
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function processClaim(tenant: Tenant, input: unknown): ClaimProcessingResult {
  const parsed = ClaimDataSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(422, "invalid_claim", "Claim data is invalid", parsed.error.issues);
  }
  const claim: ClaimData = parsed.data;
  const claimConfiguration = tenant.config.claimTypes[claim.claimType];

  if (!claimConfiguration?.enabled) {
    throw new ApiError(
      422,
      "claim_type_disabled",
      `Claim type "${claim.claimType}" is not enabled for tenant "${tenant.id}"`
    );
  }

  const autoApproved = claim.amount < tenant.config.approval.autoApprovalThreshold;
  const tier = autoApproved
    ? null
    : tenant.config.approval.tiers.find((candidate) =>
      claim.amount >= candidate.minAmount
      && (candidate.maxAmount === null || claim.amount < candidate.maxAmount)
    );

  if (!autoApproved && !tier) {
    throw new ApiError(500, "approval_tier_missing", "No approval tier matches this claim amount");
  }

  const events: NotificationEvent[] = autoApproved
    ? ["claim_submitted", "approved"]
    : ["claim_submitted"];
    
  const notifications = events.flatMap((event) => {
    const configuration = tenant.config.notifications[event];
    if (!configuration || configuration.channels.length === 0) {
      return [];
    }
    return [{
      event,
      channels: configuration.channels,
      ...(configuration.emailTemplate === undefined
        ? {}
        : { emailTemplate: configuration.emailTemplate })
    }];
  });

  const targetBusinessDays = tenant.config.sla.byClaimType[claim.claimType];
  if (targetBusinessDays === undefined) {
    throw new ApiError(500, "sla_missing", `No SLA is configured for ${claim.claimType}`);
  }

  return {
    tenantId: tenant.id,
    claimType: claim.claimType,
    amount: claim.amount,
    requiredDocuments: claimConfiguration.requiredDocuments,
    approval: {
      autoApproved,
      approverRole: tier?.approverRole ?? null,
      tier: tier
        ? { minAmount: tier.minAmount, maxAmount: tier.maxAmount }
        : null
    },
    notifications,
    sla: {
      targetBusinessDays,
      deadline: addBusinessDays(new Date(claim.submittedAt), targetBusinessDays).toISOString()
    },
    customFields: validateCustomFields(tenant, claim.customFields)
  };
}
