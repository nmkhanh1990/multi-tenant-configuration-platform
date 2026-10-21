import type { Tenant } from "./models.js";
import { TenantSchema } from "./models.js";

const fixtures: Tenant[] = [
  {
    id: "safeguard-insurance",
    name: "SafeGuard Insurance",
    segment: "corporate",
    config: {
      branding: {
        companyName: "SafeGuard Insurance",
        logoUrl: "https://example.com/safeguard/logo.svg",
        primaryColor: "#174A7E",
        secondaryColor: "#57A773"
      },
      claimTypes: {
        OUTPATIENT: {
          enabled: true,
          requiredDocuments: [
            { id: "medical_report", label: "Medical report" },
            { id: "itemized_bill", label: "Itemized bill" }
          ],
          optionalDocuments: [{ id: "prescription", label: "Prescription" }]
        },
        INPATIENT: {
          enabled: true,
          requiredDocuments: [
            { id: "discharge_summary", label: "Discharge summary" },
            { id: "hospital_bill", label: "Hospital bill" }
          ],
          optionalDocuments: [{ id: "medical_report", label: "Medical report" }]
        },
        DENTAL: {
          enabled: true,
          requiredDocuments: [{ id: "dental_receipt", label: "Dental receipt" }],
          optionalDocuments: [{ id: "treatment_plan", label: "Treatment plan" }]
        },
        MATERNITY: { enabled: false, requiredDocuments: [], optionalDocuments: [] },
        OPTICAL: { enabled: false, requiredDocuments: [], optionalDocuments: [] }
      },
      approval: {
        autoApprovalThreshold: 20000,
        tiers: [
          { minAmount: 20000, maxAmount: 100000, approverRole: "assessor" },
          { minAmount: 100000, maxAmount: 500000, approverRole: "team lead" },
          { minAmount: 500000, maxAmount: null, approverRole: "director" }
        ]
      },
      notifications: {
        claim_submitted: { channels: ["email"] },
        approved: { channels: ["email"] },
        rejected: { channels: ["email"] },
        payment_sent: { channels: ["email"] }
      },
      sla: {
        byClaimType: { OUTPATIENT: 5, INPATIENT: 10, DENTAL: 5 },
        escalation: { afterBusinessDays: 2, notifyRoles: ["operations manager"] }
      },
      customFields: [
        { id: "employee_id", label: "Employee ID", type: "text", required: true }
      ]
    }
  },
  {
    id: "healthfirst",
    name: "HealthFirst",
    segment: "retail",
    config: {
      branding: {
        companyName: "HealthFirst",
        logoUrl: "https://example.com/healthfirst/logo.svg",
        primaryColor: "#087E8B",
        secondaryColor: "#FF5A5F"
      },
      claimTypes: {
        OUTPATIENT: {
          enabled: true,
          requiredDocuments: [{ id: "receipt", label: "Payment receipt" }],
          optionalDocuments: [{ id: "medical_report", label: "Medical report" }]
        },
        INPATIENT: {
          enabled: true,
          requiredDocuments: [{ id: "discharge_summary", label: "Discharge summary" }],
          optionalDocuments: [{ id: "itemized_bill", label: "Itemized bill" }]
        },
        DENTAL: {
          enabled: true,
          requiredDocuments: [{ id: "dental_receipt", label: "Dental receipt" }],
          optionalDocuments: []
        },
        MATERNITY: {
          enabled: true,
          requiredDocuments: [{ id: "birth_certificate", label: "Birth certificate" }],
          optionalDocuments: [{ id: "discharge_summary", label: "Discharge summary" }]
        },
        OPTICAL: {
          enabled: true,
          requiredDocuments: [{ id: "optical_receipt", label: "Optical receipt" }],
          optionalDocuments: [{ id: "prescription", label: "Prescription" }]
        }
      },
      approval: {
        autoApprovalThreshold: 5000,
        tiers: [
          { minAmount: 5000, maxAmount: 100000, approverRole: "assessor" },
          { minAmount: 100000, maxAmount: null, approverRole: "manager" }
        ]
      },
      notifications: {
        claim_submitted: { channels: ["email", "sms"] },
        approved: { channels: ["email", "sms"] },
        rejected: { channels: ["email", "sms"] },
        payment_sent: { channels: ["email", "sms"] }
      },
      sla: {
        byClaimType: {
          OUTPATIENT: 7,
          INPATIENT: 7,
          DENTAL: 7,
          MATERNITY: 7,
          OPTICAL: 7
        },
        escalation: { afterBusinessDays: 3, notifyRoles: ["claims manager"] }
      },
      customFields: []
    }
  },
  {
    id: "govhealth",
    name: "GovHealth",
    segment: "government",
    config: {
      branding: {
        companyName: "GovHealth",
        logoUrl: "https://example.com/govhealth/logo.svg",
        primaryColor: "#3B3B58",
        secondaryColor: "#C9A227"
      },
      claimTypes: {
        OUTPATIENT: {
          enabled: true,
          requiredDocuments: [
            { id: "medical_report", label: "Medical report" },
            { id: "budget_approval", label: "Budget approval" }
          ],
          optionalDocuments: [{ id: "receipt", label: "Payment receipt" }]
        },
        INPATIENT: {
          enabled: true,
          requiredDocuments: [
            { id: "discharge_summary", label: "Discharge summary" },
            { id: "hospital_bill", label: "Hospital bill" },
            { id: "budget_approval", label: "Budget approval" }
          ],
          optionalDocuments: []
        },
        DENTAL: { enabled: false, requiredDocuments: [], optionalDocuments: [] },
        MATERNITY: { enabled: false, requiredDocuments: [], optionalDocuments: [] },
        OPTICAL: { enabled: false, requiredDocuments: [], optionalDocuments: [] }
      },
      approval: {
        autoApprovalThreshold: 0,
        tiers: [{ minAmount: 0, maxAmount: null, approverRole: "committee" }]
      },
      notifications: {
        claim_submitted: { channels: ["email", "webhook"] },
        approved: { channels: ["email", "webhook"] },
        rejected: { channels: ["email", "webhook"] },
        payment_sent: { channels: ["email", "webhook"] }
      },
      sla: {
        byClaimType: { OUTPATIENT: 15, INPATIENT: 15 },
        escalation: { afterBusinessDays: 5, notifyRoles: ["department head", "committee"] }
      },
      customFields: [
        { id: "department", label: "Department", type: "text", required: true },
        { id: "budget_code", label: "Budget Code", type: "text", required: true }
      ]
    }
  }
];

export const SAMPLE_TENANTS: readonly Tenant[] = Object.freeze(
  fixtures.map((tenant) => TenantSchema.parse(tenant))
);
