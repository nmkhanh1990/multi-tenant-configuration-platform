import { z } from "zod";

export const CLAIM_TYPES = [
  "OUTPATIENT",
  "INPATIENT",
  "DENTAL",
  "MATERNITY",
  "OPTICAL"
] as const;

export const NOTIFICATION_EVENTS = [
  "claim_submitted",
  "approved",
  "rejected",
  "payment_sent"
] as const;

export const NOTIFICATION_CHANNELS = ["email", "sms", "webhook"] as const;

export const TENANT_SEGMENTS = [
  "corporate",
  "retail",
  "government",
  "other"
] as const;

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select"
] as const;

const HexColorSchema = z.string().regex(/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/);

const DocumentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
});

const ClaimTypeConfigurationSchema = z.object({
  enabled: z.boolean(),
  requiredDocuments: z.array(DocumentSchema),
  optionalDocuments: z.array(DocumentSchema)
}).superRefine((claimType, context) => {
  const requiredIds = new Set(claimType.requiredDocuments.map((document) => document.id));

  claimType.optionalDocuments.forEach((document, index) => {
    if (requiredIds.has(document.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Document "${document.id}" cannot be both required and optional`,
        path: ["optionalDocuments", index, "id"]
      });
    }
  });
});

const ApprovalTierSchema = z.object({
  minAmount: z.number().finite().min(0),
  maxAmount: z.number().finite().positive().nullable(),
  approverRole: z.string().trim().min(1)
}).superRefine((tier, context) => {
  if (tier.maxAmount !== null && tier.maxAmount <= tier.minAmount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maxAmount must be greater than minAmount, or null for no upper limit",
      path: ["maxAmount"]
    });
  }
});

const ApprovalConfigurationSchema = z.object({
  autoApprovalThreshold: z.number().finite().min(0),
  tiers: z.array(ApprovalTierSchema).min(1)
}).superRefine((approval, context) => {
  if (approval.tiers[0]?.minAmount !== approval.autoApprovalThreshold) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The first approval tier must start at the auto-approval threshold",
      path: ["tiers", 0, "minAmount"]
    });
  }

  approval.tiers.forEach((tier, index) => {
    const nextTier = approval.tiers[index + 1];
    if (!nextTier) {
      if (tier.maxAmount !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The last approval tier must have no upper limit",
          path: ["tiers", index, "maxAmount"]
        });
      }
      return;
    }

    if (tier.maxAmount !== nextTier.minAmount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Approval tiers must be contiguous and non-overlapping",
        path: ["tiers", index, "maxAmount"]
      });
    }
  });
});

const NotificationConfigurationSchema = z.object({
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)),
  emailTemplate: z.string().nullable().optional()
});

const SlaConfigurationSchema = z.object({
  byClaimType: z.record(z.enum(CLAIM_TYPES), z.number().int().positive()),
  escalation: z.object({
    afterBusinessDays: z.number().int().positive(),
    notifyRoles: z.array(z.string().trim().min(1)).min(1)
  })
});

const CustomFieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1)).optional()
}).superRefine((field, context) => {
  if (field.type === "select" && (!field.options || field.options.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select fields must define at least one option",
      path: ["options"]
    });
  }

  if (field.type !== "select" && field.options !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Only select fields may define options",
      path: ["options"]
    });
  }
});

export const TenantConfigSchema = z.object({
  branding: z.object({
    companyName: z.string().trim().min(1),
    logoUrl: z.string().url().nullable(),
    primaryColor: HexColorSchema,
    secondaryColor: HexColorSchema
  }),
  claimTypes: z.record(z.enum(CLAIM_TYPES), ClaimTypeConfigurationSchema),
  approval: ApprovalConfigurationSchema,
  notifications: z.record(z.enum(NOTIFICATION_EVENTS), NotificationConfigurationSchema),
  sla: SlaConfigurationSchema,
  customFields: z.array(CustomFieldSchema)
}).superRefine((config, context) => {
  const enabledClaimTypes = CLAIM_TYPES.filter((claimType) => config.claimTypes[claimType]?.enabled);
  if (enabledClaimTypes.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one claim type must be enabled",
      path: ["claimTypes"]
    });
  }

  enabledClaimTypes.forEach((claimType) => {
    if (config.sla.byClaimType[claimType] === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `An SLA target is required for enabled claim type ${claimType}`,
        path: ["sla", "byClaimType", claimType]
      });
    }
  });

  const fieldIds = new Set<string>();
  config.customFields.forEach((field, index) => {
    if (fieldIds.has(field.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Custom field id "${field.id}" must be unique`,
        path: ["customFields", index, "id"]
      });
    }
    fieldIds.add(field.id);
  });
});

export const TenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  segment: z.enum(TENANT_SEGMENTS),
  config: TenantConfigSchema
});

export const TenantVersionSchema = z.object({
  tenantId: TenantSchema.shape.id,
  version: z.number().int().positive(),
  config: TenantConfigSchema,
  createdAt: z.string().datetime(),
  createdBy: z.string().trim().min(1),
  note: z.string().nullable()
});

export const ClaimDataSchema = z.object({
  claimType: z.enum(CLAIM_TYPES),
  amount: z.number().finite().min(0),
  submittedAt: z.string().datetime(),
  customFields: z.record(z.unknown()).default({})
});

export type ClaimType = (typeof CLAIM_TYPES)[number];
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type TenantSegment = (typeof TENANT_SEGMENTS)[number];
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type Tenant = z.infer<typeof TenantSchema>;
export type TenantVersion = z.infer<typeof TenantVersionSchema>;
export type ClaimData = z.infer<typeof ClaimDataSchema>;
