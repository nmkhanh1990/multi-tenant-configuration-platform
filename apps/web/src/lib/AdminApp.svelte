<script lang="ts">
  import { untrack, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import CompareValue from "../components/CompareValue.svelte";
  import {
    CLAIM_TYPES,
    CUSTOM_FIELD_TYPES,
    NOTIFICATION_CHANNELS,
    NOTIFICATION_EVENTS,
    SAMPLE_TENANTS,
    diffConfigs,
    TenantSchema,
    type ClaimType,
    type ConfigDifference,
    type CustomFieldType,
    type NotificationChannel,
    type NotificationEvent,
    type Tenant,
    type TenantConfig,
    type TenantVersion
  } from "@mtcp/shared";

  type TenantRecord = Tenant & {
    createdAt: string;
    updatedAt: string;
    currentVersion: number;
  };

  type ClaimResult = {
    tenantId: string;
    claimType: ClaimType;
    amount: number;
    requiredDocuments: Array<{ id: string; label: string }>;
    approval: {
      autoApproved: boolean;
      approverRole: string | null;
      tier: { minAmount: number; maxAmount: number | null } | null;
    };
    notifications: Array<{
      event: NotificationEvent;
      channels: NotificationChannel[];
      emailTemplate?: string | null;
    }>;
    sla: { targetBusinessDays: number; deadline: string };
    customFields: { required: TenantConfig["customFields"]; valid: boolean; errors: string[] };
  };

  type ApiErrorBody = { error?: { message?: string; details?: unknown } };
  type WorkspaceView = "tenants" | "configuration" | "preview" | "compare";
  type DetailTab =
    | "identity"
    | "claim-types"
    | "approval"
    | "notifications"
    | "sla"
    | "custom-fields"
    | "history";

  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api";
  const NAV_ITEMS = [
    { id: "tenants", label: "Tenants", icon: "▦" },
    { id: "preview", label: "Claim preview", icon: "▷" },
    { id: "compare", label: "Compare tenants", icon: "⇄" }
  ] as const;
  const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
    { id: "identity", label: "Identity & branding" },
    { id: "claim-types", label: "Claim types & documents" },
    { id: "approval", label: "Approval rules" },
    { id: "notifications", label: "Notifications" },
    { id: "sla", label: "Service levels" },
    { id: "custom-fields", label: "Custom fields" },
    { id: "history", label: "Version history" }
  ];
  const CREATE_TABS = DETAIL_TABS.filter((tab) => tab.id !== "history");
  const EVENT_LABELS: Record<NotificationEvent, string> = {
    claim_submitted: "Claim submitted",
    approved: "Approved",
    rejected: "Rejected",
    payment_sent: "Payment sent"
  };
  const CLAIM_LABELS: Record<ClaimType, string> = {
    OUTPATIENT: "Outpatient",
    INPATIENT: "Inpatient",
    DENTAL: "Dental",
    MATERNITY: "Maternity",
    OPTICAL: "Optical"
  };
  const CHANNEL_LABELS: Record<NotificationChannel, string> = {
    email: "Email",
    sms: "SMS",
    webhook: "Webhook"
  };
  const SEGMENT_LABELS: Record<Tenant["segment"], string> = {
    corporate: "Corporate",
    retail: "Retail",
    government: "Government",
    other: "Other"
  };

  let tenants: TenantRecord[] = $state([]);
  let selectedId = $state("");
  let draft: TenantRecord | null = $state(null);
  let activeView = $state<WorkspaceView>("tenants");
  let selectedDetailTab = $state<DetailTab>("identity");
  let loading = $state(true);
  let apiConnected = $state(false);
  let saving = $state(false);
  let errorMessage = $state("");
  let successMessage = $state("");
  let searchText = $state("");
  let isCreating = $state(false);
  let maxCreateStep = $state(0);
  let tenantIdManuallyEdited = $state(false);
  let createIdError = $state("");
  let createRouteInitialized = $state(false);
  let previewClaimType = $state<ClaimType>("OUTPATIENT");
  let previewAmount = $state(12000);
  let previewSubmittedAt = $state(new Date().toISOString().slice(0, 10));
  let previewCustomFields: Record<string, string> = $state({});
  let previewResult: ClaimResult | null = $state(null);
  let previewing = $state(false);
  let compareLeftId = $state("");
  let compareRightId = $state("");
  let compareDifferences: ConfigDifference[] = $state([]);
  let comparing = $state(false);
  let versions: TenantVersion[] = $state([]);
  let selectedVersion: TenantVersion | null = $state(null);
  let historyLoading = $state(false);

  let routeTenantId = $derived(page.params.tenantId ?? "");
  let createRoute = $derived(page.url.pathname === "/tenants/create");
  let selectedTenant = $derived(tenants.find((tenant) => tenant.id === selectedId) ?? null);
  let validationIssues = $derived.by(() => {
    if (!draft) return [];
    const config = {
      ...draft.config,
      branding: {
        ...draft.config.branding,
        companyName: draft.name,
        logoUrl: draft.config.branding.logoUrl?.trim() || null
      }
    };
    const result = TenantSchema.safeParse({
      id: draft.id,
      name: draft.name,
      segment: draft.segment,
      config
    });
    return result.success ? [] : result.error.issues;
  });
  let creationReady = $derived(
    isCreating
      && maxCreateStep === CREATE_TABS.length - 1
      && validationIssues.length === 0
  );
  let enabledClaimTypes = $derived(
    CLAIM_TYPES.filter((claimType) => draft?.config.claimTypes[claimType]?.enabled)
  );
  let filteredTenants = $derived(
    tenants.filter((tenant) => {
      const query = searchText.trim().toLowerCase();
      return !query
        || tenant.name.toLowerCase().includes(query)
        || tenant.segment.toLowerCase().includes(query);
    })
  );
  let comparedTenants = $derived({
    left: tenants.find((tenant) => tenant.id === compareLeftId) ?? null,
    right: tenants.find((tenant) => tenant.id === compareRightId) ?? null
  });
  let historyDifferences = $derived.by(() => {
    if (!selectedTenant || !selectedVersion) return [];
    const snapshot: TenantVersion = selectedVersion;
    return diffConfigs(selectedTenant.config, snapshot.config);
  });

  onMount(() => {
    void loadTenants(routeTenantId);
  });

  $effect(() => {
    const tenantId = routeTenantId;
    const isCreatePath = createRoute;
    const isLoading = loading;
    const hasCreateDraft = isCreating;
    const shouldInitializeCreateRoute = !isLoading && !createRouteInitialized;

    untrack(() => {
      if (isCreatePath) {
        activeView = "configuration";
        if (shouldInitializeCreateRoute) {
          createRouteInitialized = true;
          if (!hasCreateDraft) startNewTenant(false);
        }
      } else if (tenantId) {
        createRouteInitialized = false;
        if (loading) return;
        if (tenants.some((tenant) => tenant.id === tenantId)) {
          if (selectedId !== tenantId) selectTenant(tenantId);
          activeView = "configuration";
        } else {
          void goto("/");
        }
      } else if (activeView === "configuration" && !isCreating) {
        createRouteInitialized = false;
        activeView = "tenants";
      } else {
        createRouteInitialized = false;
      }
    });
  });

  async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers
      }
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const body = await response.json() as ApiErrorBody;
        message = body.error?.message ?? message;
        if (Array.isArray(body.error?.details)) {
          const messages = body.error.details
            .map((issue) => typeof issue === "object" && issue !== null && "message" in issue
              ? String(issue.message)
              : "")
            .filter(Boolean);
          if (messages.length) message = `${message}: ${messages.join("; ")}`;
        }
      } catch {
        // Preserve the HTTP status message when the server does not return JSON.
      }
      throw new Error(message);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async function loadTenants(preferredId?: string): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const result = await apiRequest<{ tenants: TenantRecord[] }>("/tenants");
      apiConnected = true;
      tenants = result.tenants;
      const nextId = preferredId && result.tenants.some((tenant) => tenant.id === preferredId)
        ? preferredId
        : routeTenantId && result.tenants.some((tenant) => tenant.id === routeTenantId)
          ? routeTenantId
        : result.tenants.some((tenant) => tenant.id === selectedId)
          ? selectedId
          : result.tenants[0]?.id ?? "";
      selectTenant(nextId);
    } catch (error) {
      apiConnected = false;
      errorMessage = error instanceof Error ? error.message : "Could not load tenant configurations";
    } finally {
      loading = false;
    }
  }

  function copyTenant(tenant: TenantRecord): TenantRecord {
    return {
      ...tenant,
      config: JSON.parse(JSON.stringify(tenant.config)) as TenantConfig
    };
  }

  function selectTenant(id: string): void {
    isCreating = false;
    selectedId = id;
    selectedDetailTab = "identity";
    const tenant = tenants.find((item) => item.id === id);
    draft = tenant ? copyTenant(tenant) : null;
    previewResult = null;
    previewCustomFields = {};
    selectedVersion = null;
  }

  function setView(view: (typeof NAV_ITEMS)[number]["id"]): void {
    activeView = view;
    errorMessage = "";
    successMessage = "";
    if (routeTenantId || createRoute) {
      isCreating = false;
      void goto("/");
    }
    if (view === "compare" && tenants.length > 1) {
      compareLeftId ||= tenants[0]?.id ?? "";
      compareRightId ||= tenants[1]?.id ?? "";
      void compareTenantConfigs();
    }
  }

  function selectDetailTab(tab: DetailTab): void {
    if (isCreating) {
      const tabIndex = CREATE_TABS.findIndex((item) => item.id === tab);
      if (tabIndex < 0 || tabIndex > maxCreateStep) return;
    }
    selectedDetailTab = tab;
    errorMessage = "";
    successMessage = "";
    if (tab === "history") void loadVersions();
  }

  function issueBelongsToTab(issue: (typeof validationIssues)[number], tab: DetailTab): boolean {
    const path = issue.path.map(String);
    if (tab === "identity") {
      return ["id", "name", "segment"].includes(path[0] ?? "") || path[1] === "branding";
    }
    const sectionByTab: Partial<Record<DetailTab, string>> = {
      "claim-types": "claimTypes",
      approval: "approval",
      notifications: "notifications",
      sla: "sla",
      "custom-fields": "customFields"
    };
    return path[0] === "config" && path[1] === sectionByTab[tab];
  }

  function issuesForTab(tab: DetailTab) {
    return validationIssues.filter((issue) => issueBelongsToTab(issue, tab));
  }

  function issueLabel(path: (string | number)[]): string {
    const parts = path.map(String);
    if (parts[0] === "id") return "Tenant ID";
    if (parts[0] === "name" || parts[1] === "branding" && parts[2] === "companyName") return "Company name";
    if (parts[0] === "segment") return "Business segment";
    if (parts[1] === "branding") {
      return ({
        logoUrl: "Logo URL",
        primaryColor: "Primary color",
        secondaryColor: "Secondary color"
      } as Record<string, string>)[parts[2] ?? ""] ?? "Branding";
    }
    if (parts[1] === "claimTypes") {
      const claimType = CLAIM_LABELS[parts[2] as ClaimType] ?? "Claim type";
      if (parts[3] === "requiredDocuments") return `${claimType} required documents`;
      if (parts[3] === "optionalDocuments") return `${claimType} optional documents`;
      return "Claim types";
    }
    if (parts[1] === "approval") {
      if (parts[2] === "autoApprovalThreshold") return "Auto-approval threshold";
      const tierIndex = Number(parts[3]);
      if (parts[2] === "tiers" && Number.isInteger(tierIndex)) {
        if (parts[4] === "minAmount") return `Tier ${tierIndex + 1} minimum amount`;
        if (parts[4] === "maxAmount") return `Tier ${tierIndex + 1} maximum amount`;
        if (parts[4] === "approverRole") return `Tier ${tierIndex + 1} approver role`;
      }
      return "Approval rules";
    }
    if (parts[1] === "sla") {
      if (parts[2] === "byClaimType") return `${CLAIM_LABELS[parts[3] as ClaimType] ?? "Claim"} service level`;
      if (parts[2] === "escalation" && parts[3] === "afterBusinessDays") return "Escalation delay";
      if (parts[2] === "escalation" && parts[3] === "notifyRoles") return "Escalation notification roles";
      return "Service levels";
    }
    if (parts[1] === "customFields") {
      const fieldLabel = draft?.config.customFields[Number(parts[2])]?.label || `Custom field ${Number(parts[2]) + 1}`;
      if (parts[3] === "id") return `${fieldLabel} ID`;
      if (parts[3] === "label") return `${fieldLabel} label`;
      if (parts[3] === "options") return `${fieldLabel} options`;
      return fieldLabel;
    }
    return "Configuration";
  }

  function issueReason(message: string, path: (string | number)[]): string {
    if (/at least \d+ character/i.test(message)) return "is required";
    if (/valid URL|Invalid url/i.test(message)) return "must be a valid URL";
    if (/^Invalid$|Invalid input|Invalid enum value/i.test(message)) {
      if (path[0] === "id") return "use lowercase letters and numbers separated by single hyphens";
      if (path[1] === "customFields" && path[3] === "id") {
        return "start with a lowercase letter and use only lowercase letters, numbers, and underscores";
      }
      if (path[1] === "branding" && ["primaryColor", "secondaryColor"].includes(String(path[2]))) {
        return "must be a valid hexadecimal color";
      }
      return "choose a valid option";
    }
    if (/String must contain/i.test(message)) return "must not be empty";
    if (/must be unique/i.test(message)) return "must be unique";
    if (/cannot be both required and optional/i.test(message)) return "cannot also be listed as required";
    if (/must be greater than minAmount/i.test(message)) return "must be greater than its minimum amount";
    if (/first approval tier/i.test(message)) return "must match the auto-approval threshold";
    if (/last approval tier/i.test(message)) return "must have no upper limit";
    if (/contiguous and non-overlapping/i.test(message)) return "must end where the next tier starts";
    if (/At least one claim type/i.test(message)) return "enable at least one claim type";
    if (/SLA target is required/i.test(message)) return "is required for an enabled claim type";
    if (/at least one option/i.test(message)) return "add at least one option";
    if (/greater than or equal to 0/i.test(message)) return "must be zero or greater";
    if (/positive/i.test(message)) return "must be greater than zero";
    if (/integer/i.test(message)) return "must be a whole number";
    return message;
  }

  function formatIssue(issue: (typeof validationIssues)[number]): string {
    return `${issueLabel(issue.path)}: ${issueReason(issue.message, issue.path)}`;
  }

  function fieldError(...paths: Array<(string | number)[]>): string {
    const issue = validationIssues.find((item) =>
      paths.some((path) => path.length === item.path.length
        && path.every((part, index) => String(part) === String(item.path[index])))
    );
    return issue ? formatIssue(issue) : "";
  }

  function fieldErrorPrefix(...prefix: (string | number)[]): string {
    const issue = validationIssues.find((item) =>
      prefix.every((part, index) => String(part) === String(item.path[index]))
    );
    return issue ? formatIssue(issue) : "";
  }

  function createStepIsValid(tab: DetailTab): boolean {
    return issuesForTab(tab).length === 0;
  }

  function advanceCreateStep(): void {
    const currentIndex = CREATE_TABS.findIndex((tab) => tab.id === selectedDetailTab);
    const currentTab = CREATE_TABS[currentIndex];
    if (!currentTab || !createStepIsValid(currentTab.id)) return;
    maxCreateStep = Math.max(maxCreateStep, currentIndex + 1);
    const nextTab = CREATE_TABS[currentIndex + 1];
    if (nextTab) selectedDetailTab = nextTab.id;
  }

  function updateCompanyName(name: string): void {
    if (!draft) return;
    draft.name = name;
    draft.config.branding.companyName = name;
    if (isCreating && !tenantIdManuallyEdited) draft.id = toTenantId(name);
    createIdError = "";
  }

  function toTenantId(value: string): string {
    return value.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function openTenant(tenantId: string): void {
    selectTenant(tenantId);
    activeView = "configuration";
    void goto(`/tenants/${encodeURIComponent(tenantId)}`);
  }

  function startNewTenant(navigate = true): void {
    const base = SAMPLE_TENANTS[0]!;
    const id = toTenantId("New insurance company");
    const config = JSON.parse(JSON.stringify(base.config)) as TenantConfig;
    config.branding.companyName = "New insurance company";
    draft = {
      ...base,
      id,
      name: "New insurance company",
      config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentVersion: 0
    };
    selectedId = id;
    isCreating = true;
    createRouteInitialized = true;
    selectedDetailTab = "identity";
    maxCreateStep = 0;
    tenantIdManuallyEdited = false;
    createIdError = "";
    activeView = "configuration";
    if (navigate && page.url.pathname !== "/tenants/create") void goto("/tenants/create");
    successMessage = "";
    errorMessage = "";
  }

  async function saveTenant(): Promise<void> {
    if (!draft) return;
    saving = true;
    errorMessage = "";
    successMessage = "";

    try {
      const config = JSON.parse(JSON.stringify(draft.config)) as TenantConfig;
      config.branding.companyName = draft.name.trim();
      config.branding.logoUrl = config.branding.logoUrl?.trim() || null;
      const body = {
        id: draft.id,
        name: draft.name,
        segment: draft.segment,
        config,
        createdBy: "admin"
      };
      const result = isCreating
        ? await apiRequest<{ tenant: TenantRecord }>("/tenants", {
            method: "POST",
            body: JSON.stringify(body)
          })
        : await apiRequest<{ tenant: TenantRecord }>(`/tenants/${encodeURIComponent(draft.id)}`, {
            method: "PUT",
            body: JSON.stringify({
              name: draft.name,
              segment: draft.segment,
              config: draft.config,
              expectedVersion: draft.currentVersion,
              note: "Updated from admin console",
              createdBy: "admin"
            })
          });
      isCreating = false;
      createIdError = "";
      await loadTenants(result.tenant.id);
      await goto(`/tenants/${encodeURIComponent(result.tenant.id)}`);
      activeView = "configuration";
      successMessage = "Tenant configuration saved as a new version.";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save tenant configuration";
      if (isCreating && /already exists|duplicate/i.test(message)) createIdError = message;
      else errorMessage = message;
    } finally {
      saving = false;
    }
  }

  async function deleteTenant(): Promise<void> {
    if (!selectedTenant) return;
    const confirmed = window.confirm(
      `Delete ${selectedTenant.name} and its entire configuration history? This cannot be undone.`
    );
    if (!confirmed) return;

    errorMessage = "";
    successMessage = "";
    try {
      await apiRequest<void>(`/tenants/${encodeURIComponent(selectedTenant.id)}`, {
        method: "DELETE"
      });
      await goto("/");
      await loadTenants();
      successMessage = "Tenant deleted.";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not delete tenant";
    }
  }

  function documentText(documents: Array<{ id: string; label: string }>): string {
    return documents.map((document) => `${document.id} | ${document.label}`).join("\n");
  }

  function parseDocuments(value: string): Array<{ id: string; label: string }> {
    return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const [rawId, ...labelParts] = line.split("|");
      const id = rawId?.trim() ?? "";
      const label = labelParts.join("|").trim() || id;
      return { id, label };
    });
  }

  function setDocuments(claimType: ClaimType, kind: "requiredDocuments" | "optionalDocuments", value: string): void {
    if (!draft) return;
    const configuration = draft.config.claimTypes[claimType];
    if (!configuration) return;
    configuration[kind] = parseDocuments(value);
  }

  function addApprovalTier(): void {
    if (!draft) return;
    const tiers = draft.config.approval.tiers;
    const last = tiers[tiers.length - 1];
    if (!last) return;
    const nextAmount = last.minAmount + 100000;
    last.maxAmount = nextAmount;
    tiers.push({ minAmount: nextAmount, maxAmount: null, approverRole: "approver" });
  }

  function removeApprovalTier(index: number): void {
    if (!draft || draft.config.approval.tiers.length <= 1) return;
    const tiers = draft.config.approval.tiers;
    tiers.splice(index, 1);
    if (index > 0 && tiers[index - 1]) {
      tiers[index - 1]!.maxAmount = tiers[index]?.minAmount ?? null;
    }
    if (tiers.length) tiers[tiers.length - 1]!.maxAmount = null;
  }

  function toggleChannel(eventName: NotificationEvent, channel: NotificationChannel, checked: boolean): void {
    if (!draft) return;
    const configuration = draft.config.notifications[eventName];
    if (!configuration) return;
    const channels = configuration.channels;
    configuration.channels = checked
      ? [...new Set([...channels, channel])]
      : channels.filter((item) => item !== channel);
  }

  function addCustomField(): void {
    if (!draft) return;
    draft.config.customFields.push({
      id: `custom_field_${draft.config.customFields.length + 1}`,
      label: "New custom field",
      type: "text",
      required: false
    });
  }

  function updateCustomFieldType(index: number, type: CustomFieldType): void {
    if (!draft) return;
    const field = draft.config.customFields[index];
    if (!field) return;
    field.type = type;
    if (type === "select") field.options = ["Option 1"];
    else delete field.options;
  }

  async function runPreview(): Promise<void> {
    if (!selectedTenant) return;
    if (!previewSubmittedAt || !Number.isFinite(Number(previewAmount)) || Number(previewAmount) < 0) {
      errorMessage = "Enter a valid submission date and a non-negative claim amount.";
      return;
    }
    previewing = true;
    errorMessage = "";
    previewResult = null;
    try {
      const result = await apiRequest<{ result: ClaimResult }>(
        `/tenants/${encodeURIComponent(selectedTenant.id)}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            claimType: previewClaimType,
            amount: Number(previewAmount),
            submittedAt: new Date(`${previewSubmittedAt}T09:00:00.000Z`).toISOString(),
            customFields: getPreviewCustomFields(selectedTenant)
          })
        }
      );
      previewResult = result.result;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not preview claim";
    } finally {
      previewing = false;
    }
  }

  async function compareTenantConfigs(): Promise<void> {
    if (!compareLeftId || !compareRightId || compareLeftId === compareRightId) {
      compareDifferences = [];
      return;
    }
    comparing = true;
    errorMessage = "";
    try {
      const result = await apiRequest<{ differences: ConfigDifference[] }>("/tenants/compare", {
        method: "POST",
        body: JSON.stringify({ leftTenantId: compareLeftId, rightTenantId: compareRightId })
      });
      compareDifferences = result.differences;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not compare tenant configurations";
      compareDifferences = [];
    } finally {
      comparing = false;
    }
  }

  async function loadVersions(): Promise<void> {
    if (!selectedTenant) return;
    historyLoading = true;
    selectedVersion = null;
    try {
      const result = await apiRequest<{ versions: TenantVersion[] }>(
        `/tenants/${encodeURIComponent(selectedTenant.id)}/versions`
      );
      versions = result.versions;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not load version history";
      versions = [];
    } finally {
      historyLoading = false;
    }
  }

  async function inspectVersion(version: number): Promise<void> {
    if (!selectedTenant) return;
    try {
      const result = await apiRequest<{ version: TenantVersion }>(
        `/tenants/${encodeURIComponent(selectedTenant.id)}/versions/${version}`
      );
      selectedVersion = result.version;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not load this version";
    }
  }

  async function rollbackVersion(version: number): Promise<void> {
    if (!selectedTenant) return;
    if (!window.confirm(`Restore version ${version}? This will create a new version and keep the full history.`)) {
      return;
    }
    try {
      const result = await apiRequest<{ tenant: TenantRecord }>(
        `/tenants/${encodeURIComponent(selectedTenant.id)}/versions/${version}/rollback`,
        { method: "POST", body: JSON.stringify({ createdBy: "admin" }) }
      );
      await loadTenants(result.tenant.id);
      await loadVersions();
      successMessage = `Restored version ${version} as version ${result.tenant.currentVersion}.`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not roll back this version";
    }
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function displayValue(value: unknown): string {
    if (value === undefined) return "Not configured";
    if (value === null) return "None";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value, null, 2);
  }

  function getPreviewCustomFields(tenant: Tenant): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of tenant.config.customFields) {
      const rawValue = previewCustomFields[field.id];
      if (rawValue === undefined || rawValue.trim() === "") continue;
      values[field.id] = field.type === "number" ? Number(rawValue) : rawValue;
    }
    return values;
  }
</script>

<svelte:head>
  <title>Tenant administration | Configuration Platform</title>
  <meta
    name="description"
    content="Manage insurer configurations, preview claim routing, compare tenants, and review configuration history."
  />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Tenant Admin home">
      <span class="brand-mark">N</span>
      <span class="brand-copy"><strong>AI Challenge 15</strong><small>INSURANCE PLATFORM</small></span>
    </a>

    <div class="sidebar-section-label">WORKSPACE</div>
    <nav class="primary-nav" aria-label="Main navigation">
      {#each NAV_ITEMS as item}
        <button
          class:active={activeView === item.id || (activeView === "configuration" && item.id === "tenants")}
          class="nav-item"
          aria-label={item.label}
          onclick={() => setView(item.id)}
        >
          <span class="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
          {#if item.id === "tenants"}
            <span class="nav-count">{tenants.length}</span>
          {/if}
        </button>
      {/each}
    </nav>

    <div class="sidebar-bottom">
      <div class="environment-card">
        <span class:dot-offline={!apiConnected} class="status-dot"></span>
        <span><strong>Platform status</strong><small>{apiConnected ? "Connected to API" : "API unavailable"}</small></span>
      </div>
      <div class="profile-row">
        <span class="avatar">AD</span>
        <span class="profile-copy"><strong>Admin user</strong><small>Operations</small></span>
        <span class="more-icon">•••</span>
      </div>
    </div>
  </aside>

  <main class="main-column">
    <header class="topbar">
      <div class="breadcrumbs">
        {#if activeView === "configuration" && isCreating}
          <span>Workspace</span><span class="crumb-separator">/</span>
          <button class="breadcrumb-link" onclick={() => setView("tenants")}>Tenants</button>
          <span class="crumb-separator">/</span><strong>Create</strong>
        {:else if activeView === "configuration" && selectedTenant}
          <span>Workspace</span><span class="crumb-separator">/</span>
          <button class="breadcrumb-link" onclick={() => setView("tenants")}>Tenants</button>
          <span class="crumb-separator">/</span><strong>{selectedTenant.name}</strong>
        {:else}
          <span>Workspace</span><span class="crumb-separator">/</span>
          <strong>{NAV_ITEMS.find((item) => item.id === activeView)?.label ?? "Tenants"}</strong>
        {/if}
      </div>
      <div class="topbar-right">
        <span class="api-status"><span class:dot-offline={!apiConnected} class="status-dot"></span> {apiConnected ? "API connected" : "API unavailable"}</span>
        {#if selectedTenant && !isCreating}
          <div class="active-tenant"><span class="tenant-monogram">{selectedTenant.name.slice(0, 1)}</span>
            <span>{selectedTenant.name}</span>
          </div>
        {/if}
      </div>
    </header>

    <div class="content-area">
      {#if errorMessage}
        <div class="notice notice-error" role="alert">
          <span class="notice-icon">!</span><span>{errorMessage}</span>
          <button class="notice-close" aria-label="Dismiss error" onclick={() => (errorMessage = "")}>×</button>
        </div>
      {/if}
      {#if successMessage}
        <div class="notice notice-success" role="status">
          <span class="notice-icon">✓</span><span>{successMessage}</span>
          <button class="notice-close" aria-label="Dismiss message" onclick={() => (successMessage = "")}>×</button>
        </div>
      {/if}

      {#if loading}
        <div class="loading-state"><span class="spinner"></span> Loading tenant workspace…</div>
      {:else if activeView === "tenants"}
        <section class="page-heading">
          <div>
            <div class="eyebrow">DIRECTORY</div>
            <h1>Tenant configurations</h1>
            <p class="page-description">Manage insurer profiles and the rules that power each claims experience.</p>
          </div>
          <button class="button button-primary" onclick={() => startNewTenant()}><span class="button-plus">+</span> Add tenant</button>
        </section>

        <div class="summary-grid">
          <article class="summary-card">
            <div class="summary-label">Total tenants <span class="summary-symbol symbol-blue">▦</span></div>
            <div class="summary-value">{tenants.length}</div>
            <div class="summary-foot">Active configuration profiles</div>
          </article>
          <article class="summary-card">
            <div class="summary-label">Claim types <span class="summary-symbol symbol-green">↗</span></div>
            <div class="summary-value">{CLAIM_TYPES.length}</div>
            <div class="summary-foot">Available across the platform</div>
          </article>
          <article class="summary-card">
            <div class="summary-label">Latest update <span class="summary-symbol symbol-purple">◷</span></div>
            <div class="summary-value summary-date">
              {tenants.length ? formatDate([...tenants].sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt))[0]!.updatedAt).split(",")[0] : "—"}
            </div>
            <div class="summary-foot">Most recent configuration change</div>
          </article>
        </div>

        <section class="panel tenant-panel">
          <div class="panel-heading">
            <div><h2>All tenants</h2><p>Configuration profiles in this workspace</p></div>
            <label class="search-control">
              <span aria-hidden="true">⌕</span>
              <input bind:value={searchText} placeholder="Search tenants…" aria-label="Search tenants" />
              <kbd>⌘ K</kbd>
            </label>
          </div>
          <div class="table-scroll">
            <table class="tenant-table">
              <thead><tr><th>INSURER</th><th>SEGMENT</th><th>CLAIM TYPES</th><th>APPROVAL</th><th>VERSION</th><th>LAST UPDATED</th><th></th></tr></thead>
              <tbody>
                {#each filteredTenants as tenant}
                  <tr>
                    <td>
                      <button class="tenant-name-cell" onclick={() => openTenant(tenant.id)}>
                        <span class="tenant-logo" style={`--tenant-color:${tenant.config.branding.primaryColor}`}>
                          {tenant.name.slice(0, 1)}
                        </span>
                        <span><strong>{tenant.name}</strong><small>{tenant.id}</small></span>
                      </button>
                    </td>
                    <td><span class={`segment-pill segment-${tenant.segment}`}>{SEGMENT_LABELS[tenant.segment]}</span></td>
                    <td>
                      <span class="claim-count">{CLAIM_TYPES.filter((type) => tenant.config.claimTypes[type]?.enabled).length} types enabled</span>
                    </td>
                    <td><span class="amount-cell">{tenant.config.approval.autoApprovalThreshold.toLocaleString()}</span></td>
                    <td><span class="version-pill">v{tenant.currentVersion}</span></td>
                    <td><span class="muted-cell">{formatDate(tenant.updatedAt)}</span></td>
                    <td><button class="row-action" aria-label={`Open ${tenant.name}`} onclick={() => openTenant(tenant.id)}>↗</button></td>
                  </tr>
                {:else}
                  <tr><td colspan="7" class="empty-row">No tenant matches your search.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="table-footer"><span>Showing <strong>{filteredTenants.length}</strong> of <strong>{tenants.length}</strong> tenants</span>
            <span class="footer-note"><span class="status-dot"></span> All configurations synced</span></div>
        </section>

        <section class="getting-started">
          <div class="getting-icon">✦</div>
          <div><strong>Every insurer, one flexible platform.</strong><p>Configure claim workflows without changing application code.</p></div>
          <button class="text-button" onclick={() => setView("preview")}>Explore claim preview <span>→</span></button>
        </section>

      {:else if activeView === "configuration"}
        <section class="page-heading tenant-detail-heading">
          <div>
            <h1>{isCreating ? "Create a tenant" : "Tenant details"}</h1>
            <p class="page-description">{isCreating
              ? "Set up a tenant step by step. Each section must be valid before continuing."
              : "Define branding, claim requirements, approval routing, and service levels."}</p>
          </div>
          <div class="heading-actions">
            {#if selectedTenant && !isCreating}
              <button class="button button-danger-quiet" onclick={deleteTenant}>Delete</button>
            {/if}
            {#if isCreating}
              <button
                class:button-primary-ready={creationReady}
                class="button button-primary"
                onclick={saveTenant}
                disabled={saving || !creationReady}
              >{saving ? "Creating…" : "Create tenant"}</button>
            {:else}
              <button class="button button-primary" onclick={saveTenant} disabled={saving || !draft}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            {/if}
          </div>
        </section>

        {#if draft}
          <div class="editor-layout">
            <nav class="editor-nav" aria-label="Configuration sections">
              {#each (isCreating ? CREATE_TABS : DETAIL_TABS) as tab, tabIndex}
                <button
                  class:active={selectedDetailTab === tab.id}
                  aria-current={selectedDetailTab === tab.id ? "page" : undefined}
                  disabled={isCreating && tabIndex > maxCreateStep}
                  onclick={() => selectDetailTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  {#if isCreating && tabIndex < maxCreateStep && issuesForTab(tab.id).length}
                    <span class="step-error-indicator" aria-label="This section has errors">!</span>
                  {/if}
                </button>
              {/each}
            </nav>
            <div class="editor-sections">
              {#if selectedDetailTab === "identity"}
              <section class="panel editor-panel" id="identity">
                <div class="editor-section-heading"><span class="section-number">01</span><div><h2>Identity & branding</h2><p>Company details displayed across the claims experience.</p></div></div>
                <div class="form-grid">
                  <label class="form-field"><span>Tenant ID <b>*</b></span>
                    <input
                      value={draft.id}
                      disabled={!isCreating}
                      aria-invalid={Boolean(fieldError(["id"]) || createIdError)}
                      oninput={(event) => {
                        draft!.id = event.currentTarget.value;
                        if (isCreating) tenantIdManuallyEdited = true;
                        createIdError = "";
                      }}
                    />
                    <small>Lowercase letters, numbers and hyphens</small>
                    {#if fieldError(["id"]) || createIdError}<small class="field-error">{fieldError(["id"]) || `Tenant ID: ${createIdError}`}</small>{/if}
                  </label>
                  <label class="form-field"><span>Company name <b>*</b></span>
                    <input value={draft.name} aria-invalid={Boolean(fieldError(["name"]))} oninput={(event) => updateCompanyName(event.currentTarget.value)} />
                    {#if fieldError(["name"])}<small class="field-error">{fieldError(["name"])}</small>{/if}
                  </label>
                  <label class="form-field"><span>Business segment</span>
                    <select bind:value={draft.segment}>
                      <option value="corporate">Corporate</option><option value="retail">Retail</option>
                      <option value="government">Government</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label class="form-field"><span>Logo URL</span><input bind:value={draft.config.branding.logoUrl} aria-invalid={Boolean(fieldError(["config", "branding", "logoUrl"]))} placeholder="https://…" />
                    {#if fieldError(["config", "branding", "logoUrl"])}<small class="field-error">{fieldError(["config", "branding", "logoUrl"])}</small>{/if}
                  </label>
                  <label class="form-field"><span>Primary color</span><div class="color-input"><input type="color" bind:value={draft.config.branding.primaryColor} /><input bind:value={draft.config.branding.primaryColor} /></div>
                    {#if fieldError(["config", "branding", "primaryColor"])}<small class="field-error">{fieldError(["config", "branding", "primaryColor"])}</small>{/if}
                  </label>
                  <label class="form-field"><span>Secondary color</span><div class="color-input"><input type="color" bind:value={draft.config.branding.secondaryColor} /><input bind:value={draft.config.branding.secondaryColor} /></div>
                    {#if fieldError(["config", "branding", "secondaryColor"])}<small class="field-error">{fieldError(["config", "branding", "secondaryColor"])}</small>{/if}
                  </label>
                </div>
              </section>
              {/if}

              {#if selectedDetailTab === "claim-types"}
              <section class="panel editor-panel" id="claim-types">
                <div class="editor-section-heading"><span class="section-number">02</span><div><h2>Claim types & documents</h2><p>Enable claim categories and list required or optional documents.</p></div></div>
                <div class="claim-config-list">
                  {#each CLAIM_TYPES as claimType}
                    {@const config = draft.config.claimTypes[claimType]!}
                    <article class="claim-config-card">
                      <div class="claim-config-title">
                        <label class="switch-label"><input type="checkbox" bind:checked={config.enabled} /><span class="switch"></span></label>
                        <div><strong>{CLAIM_LABELS[claimType]}</strong><small>{claimType}</small></div>
                        <span class:enabled-badge={config.enabled} class="state-badge">{config.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                      {#if config.enabled}
                        <div class="document-fields">
                          <label class="form-field"><span>Required documents <b>*</b></span>
                            <textarea rows="3" value={documentText(config.requiredDocuments)} oninput={(event) => setDocuments(claimType, "requiredDocuments", event.currentTarget.value)} placeholder="document_id | Document label"></textarea>
                            <small>One document per line: <code>id | label</code></small>
                            {#if fieldErrorPrefix("config", "claimTypes", claimType, "requiredDocuments")}<small class="field-error">{fieldErrorPrefix("config", "claimTypes", claimType, "requiredDocuments")}</small>{/if}
                          </label>
                          <label class="form-field"><span>Optional documents</span>
                            <textarea rows="3" value={documentText(config.optionalDocuments)} oninput={(event) => setDocuments(claimType, "optionalDocuments", event.currentTarget.value)} placeholder="document_id | Document label"></textarea>
                            <small>Leave blank when no optional documents apply.</small>
                            {#if fieldErrorPrefix("config", "claimTypes", claimType, "optionalDocuments")}<small class="field-error">{fieldErrorPrefix("config", "claimTypes", claimType, "optionalDocuments")}</small>{/if}
                          </label>
                        </div>
                      {/if}
                    </article>
                  {/each}
                </div>
                {#if fieldError(["config", "claimTypes"])}<small class="field-error section-validation-error">{fieldError(["config", "claimTypes"])}</small>{/if}
              </section>
              {/if}

              {#if selectedDetailTab === "approval"}
              <section class="panel editor-panel" id="approval">
                <div class="editor-section-heading"><span class="section-number">03</span><div><h2>Approval rules</h2><p>Set the auto-approval limit and escalation tiers by claim amount.</p></div></div>
                <label class="form-field threshold-field"><span>Auto-approval threshold</span>
                  <div class="amount-input"><span>$</span><input type="number" min="0" step="100" bind:value={draft.config.approval.autoApprovalThreshold} /></div>
                  <small>Claims below this amount are automatically approved. Claims at the threshold enter the first approval tier.</small>
                  {#if fieldError(["config", "approval", "autoApprovalThreshold"])}<small class="field-error">{fieldError(["config", "approval", "autoApprovalThreshold"])}</small>{/if}
                </label>
                <div class="tier-header"><span>AMOUNT RANGE</span><span>APPROVER ROLE</span><span></span></div>
                {#each draft.config.approval.tiers as tier, index}
                  <div class="tier-row">
                    <div class="range-fields">
                      <span class="validation-control"><input aria-label={`Tier ${index + 1} minimum amount`} type="number" min="0" bind:value={tier.minAmount} />
                        {#if fieldError(["config", "approval", "tiers", index, "minAmount"])}<small class="field-error">{fieldError(["config", "approval", "tiers", index, "minAmount"])}</small>{/if}
                      </span>
                      <span>to</span>
                      <span class="validation-control"><input aria-label={`Tier ${index + 1} maximum amount`} type="number" min="0" placeholder="No limit" value={tier.maxAmount ?? ""} oninput={(event) => { tier.maxAmount = event.currentTarget.value === "" ? null : Number(event.currentTarget.value); }} />
                        {#if fieldError(["config", "approval", "tiers", index, "maxAmount"])}<small class="field-error">{fieldError(["config", "approval", "tiers", index, "maxAmount"])}</small>{/if}
                      </span>
                    </div>
                    <div class="validation-control"><input aria-label={`Tier ${index + 1} approver role`} bind:value={tier.approverRole} placeholder="e.g. assessor" />
                      {#if fieldError(["config", "approval", "tiers", index, "approverRole"])}<small class="field-error">{fieldError(["config", "approval", "tiers", index, "approverRole"])}</small>{/if}
                    </div>
                    <button class="icon-button" aria-label="Remove approval tier" onclick={() => removeApprovalTier(index)} disabled={draft.config.approval.tiers.length <= 1}>×</button>
                  </div>
                {/each}
                <button class="button button-outline add-tier" onclick={addApprovalTier}>+ Add approval tier</button>
              </section>
              {/if}

              {#if selectedDetailTab === "notifications"}
              <section class="panel editor-panel" id="notifications">
                <div class="editor-section-heading"><span class="section-number">04</span><div><h2>Notifications</h2><p>Choose channels and optional email templates for each event.</p></div></div>
                <div class="notification-table">
                  <div class="notification-table-head"><span>EVENT</span><span>CHANNELS</span><span>EMAIL TEMPLATE</span></div>
                  {#each NOTIFICATION_EVENTS as eventName}
                    <div class="notification-row">
                      <strong>{EVENT_LABELS[eventName]}</strong>
                      <div class="channel-options">
                        {#each NOTIFICATION_CHANNELS as channel}
                          <label class="checkbox-label">
                            <input type="checkbox" checked={draft.config.notifications[eventName]!.channels.includes(channel)} onchange={(event) => toggleChannel(eventName, channel, event.currentTarget.checked)} />
                            <span>{CHANNEL_LABELS[channel]}</span>
                          </label>
                        {/each}
                      </div>
                      <input aria-label={`${EVENT_LABELS[eventName]} email template`} placeholder="Use default template" bind:value={draft.config.notifications[eventName]!.emailTemplate} />
                    </div>
                  {/each}
                </div>
              </section>
              {/if}

              {#if selectedDetailTab === "sla"}
              <section class="panel editor-panel" id="sla">
                <div class="editor-section-heading"><span class="section-number">05</span><div><h2>Service levels</h2><p>Set business-day processing targets and escalation contacts.</p></div></div>
                <div class="sla-grid">
                  {#each CLAIM_TYPES as claimType}
                    <label class:field-muted={!draft.config.claimTypes[claimType]!.enabled} class="form-field">
                      <span>{CLAIM_LABELS[claimType]}{draft.config.claimTypes[claimType]!.enabled ? " · enabled" : " · disabled"}</span>
                      <div class="days-input"><input type="number" min="1" step="1" bind:value={draft.config.sla.byClaimType[claimType]} /><span>business days</span></div>
                      {#if fieldError(["config", "sla", "byClaimType", claimType])}<small class="field-error">{fieldError(["config", "sla", "byClaimType", claimType])}</small>{/if}
                    </label>
                  {/each}
                </div>
                <div class="form-grid escalation-fields">
                  <label class="form-field"><span>Escalate after</span><div class="days-input"><input type="number" min="1" step="1" bind:value={draft.config.sla.escalation.afterBusinessDays} /><span>business days</span></div>
                    {#if fieldError(["config", "sla", "escalation", "afterBusinessDays"])}<small class="field-error">{fieldError(["config", "sla", "escalation", "afterBusinessDays"])}</small>{/if}
                  </label>
                  <label class="form-field"><span>Notify roles on escalation</span><input value={draft.config.sla.escalation.notifyRoles.join(", ")} oninput={(event) => { draft!.config.sla.escalation.notifyRoles = event.currentTarget.value.split(",").map((role) => role.trim()).filter(Boolean); }} placeholder="Claims manager, team lead" /><small>Separate multiple roles with commas.</small>
                    {#if fieldErrorPrefix("config", "sla", "escalation", "notifyRoles")}<small class="field-error">{fieldErrorPrefix("config", "sla", "escalation", "notifyRoles")}</small>{/if}
                  </label>
                </div>
              </section>
              {/if}

              {#if selectedDetailTab === "custom-fields"}
              <section class="panel editor-panel" id="custom-fields">
                <div class="editor-section-heading"><span class="section-number">06</span><div><h2>Custom fields</h2><p>Collect tenant-specific information when a claim is submitted.</p></div></div>
                {#if draft.config.customFields.length}
                  <div class="custom-field-list">
                    {#each draft.config.customFields as field, index}
                      <div class="custom-field-row">
                        <label class="form-field"><span>Field label</span><input bind:value={field.label} />
                          {#if fieldError(["config", "customFields", index, "label"])}<small class="field-error">{fieldError(["config", "customFields", index, "label"])}</small>{/if}
                        </label>
                        <label class="form-field"><span>Field ID</span><input bind:value={field.id} />
                          {#if fieldError(["config", "customFields", index, "id"])}<small class="field-error">{fieldError(["config", "customFields", index, "id"])}</small>{/if}
                        </label>
                        <label class="form-field"><span>Type</span><select value={field.type} onchange={(event) => updateCustomFieldType(index, event.currentTarget.value as CustomFieldType)}>
                          {#each CUSTOM_FIELD_TYPES as fieldType}<option value={fieldType}>{fieldType}</option>{/each}
                        </select></label>
                        <label class="required-toggle"><input type="checkbox" bind:checked={field.required} /><span>Required</span></label>
                        <button class="icon-button" aria-label="Remove custom field" onclick={() => draft!.config.customFields.splice(index, 1)}>×</button>
                        {#if field.type === "select"}
                          <label class="form-field options-field"><span>Select options</span><input value={field.options?.join(", ") ?? ""} oninput={(event) => { field.options = event.currentTarget.value.split(",").map((option) => option.trim()).filter(Boolean); }} placeholder="Option A, Option B" />
                            {#if fieldError(["config", "customFields", index, "options"])}<small class="field-error">{fieldError(["config", "customFields", index, "options"])}</small>{/if}
                          </label>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="empty-inline">No custom submission fields. This tenant uses the standard claim form.</div>
                {/if}
                <button class="button button-outline" onclick={addCustomField}>+ Add custom field</button>
              </section>
              {#if !isCreating}
                <div class="editor-bottom-actions">
                  <span><span class="status-dot dot-gray"></span> Validation runs before every save</span>
                  <button class="button button-primary" onclick={saveTenant} disabled={saving}>{saving ? "Saving…" : "Save configuration"}</button>
                </div>
              {/if}
              {/if}

              {#if selectedDetailTab === "history"}
                <section class="panel editor-panel history-editor-panel">
                  <div class="editor-section-heading">
                    <span class="section-number">07</span>
                    <div>
                      <h2>Version history</h2>
                      <p>Every saved configuration is preserved. Restore any version without losing the audit trail.</p>
                    </div>
                  </div>
                  {#if selectedTenant}
                    <div class="history-layout">
                      <section class="history-list-panel">
                        <div class="panel-heading compact-heading"><div><h2>Configuration versions</h2><p>{versions.length} saved snapshots</p></div></div>
                        {#if historyLoading}<div class="loading-state compact-loading"><span class="spinner"></span> Loading history…</div>
                        {:else if versions.length}
                          <div class="version-list">
                            {#each versions as version}
                              <article class:version-selected={selectedVersion?.version === version.version} class="version-item">
                                <button class="version-select" onclick={() => inspectVersion(version.version)}>
                                  <span class:timeline-current={version.version === selectedTenant.currentVersion} class="timeline-dot"></span>
                                  <span class="version-item-copy"><strong>Version {version.version}{version.version === selectedTenant.currentVersion ? " · Current" : ""}</strong>
                                    <small>{formatDate(version.createdAt)}</small><small>Saved by {version.createdBy}</small>
                                  </span>
                                  <span class="version-chevron">›</span>
                                </button>
                                {#if version.version !== selectedTenant.currentVersion}
                                  <button class="rollback-link" onclick={() => rollbackVersion(version.version)}>Restore this version</button>
                                {/if}
                              </article>
                            {/each}
                          </div>
                        {:else}<div class="empty-inline history-empty">No versions found.</div>{/if}
                      </section>
                      <section class="history-detail-panel">
                        {#if selectedVersion}
                          <div class="panel-heading compact-heading"><div><span class="version-pill">VERSION {selectedVersion.version}</span><h2 class="history-detail-title">Snapshot details</h2><p>Created {formatDate(selectedVersion.createdAt)} by {selectedVersion.createdBy}</p></div>
                            {#if selectedVersion.version !== selectedTenant.currentVersion}<button class="button button-outline" onclick={() => rollbackVersion(selectedVersion!.version)}>Restore version</button>{/if}
                          </div>
                          {#if selectedVersion.note}<div class="history-note"><strong>Version note</strong><span>{selectedVersion.note}</span></div>{/if}
                          <div class="history-summary">
                            <div><span>Company</span><strong>{selectedVersion.config.branding.companyName}</strong></div>
                            <div><span>Claim types enabled</span><strong>{CLAIM_TYPES.filter((type) => selectedVersion!.config.claimTypes[type]?.enabled).length}</strong></div>
                            <div><span>Auto-approval</span><strong>{selectedVersion.config.approval.autoApprovalThreshold.toLocaleString()}</strong></div>
                            <div><span>Custom fields</span><strong>{selectedVersion.config.customFields.length}</strong></div>
                          </div>
                          <div class="history-diff-heading"><strong>Changes from current version</strong><span>{historyDifferences.length} differences</span></div>
                          {#if historyDifferences.length}
                            <div class="history-diff-list">{#each historyDifferences as difference}
                              <div class="history-diff-row"><code>{difference.path}</code><span class="old-value">{displayValue(difference.left)}</span><span class="new-value">{displayValue(difference.right)}</span></div>
                            {/each}</div>
                          {:else}<div class="empty-inline">This snapshot matches the current configuration.</div>{/if}
                        {:else}
                          <div class="history-placeholder"><div class="history-placeholder-icon">◷</div><h2>Select a version</h2><p>Choose a snapshot to inspect its configuration and compare it with the current version.</p></div>
                        {/if}
                      </section>
                    </div>
                  {:else}
                    <div class="empty-state"><h2>No tenant history available</h2><p>Create a tenant to start recording configuration versions.</p></div>
                  {/if}
                </section>
              {/if}
            {#if isCreating}
              {@const currentCreateIndex = CREATE_TABS.findIndex((tab) => tab.id === selectedDetailTab)}
              <div class="wizard-step-actions">
                <span>Step {currentCreateIndex + 1} of {CREATE_TABS.length}</span>
                {#if currentCreateIndex < CREATE_TABS.length - 1}
                  <button
                    class="button button-primary"
                    onclick={advanceCreateStep}
                    disabled={!createStepIsValid(selectedDetailTab)}
                  >Next <span aria-hidden="true">→</span></button>
                {/if}
              </div>
            {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state panel"><div class="empty-state-icon">▦</div><h2>No tenants yet</h2><p>Create a tenant to configure its claims experience.</p><button class="button button-primary" onclick={() => startNewTenant()}>Add first tenant</button></div>
        {/if}

      {:else if activeView === "preview"}
        <section class="page-heading">
          <div><div class="eyebrow">RUNTIME SIMULATOR</div><h1>Claim preview</h1>
            <p class="page-description">See how a claim is routed using a tenant's current configuration.</p></div>
        </section>
        {#if selectedTenant}
          <div class="preview-layout">
            <section class="panel preview-form-panel">
              <div class="panel-heading compact-heading"><div><h2>Sample claim</h2><p>Enter claim details to preview processing.</p></div><span class="step-badge">INPUT</span></div>
              <label class="form-field"><span>Tenant</span><select value={selectedId} onchange={(event) => selectTenant(event.currentTarget.value)}>
                {#each tenants as tenant}<option value={tenant.id}>{tenant.name}</option>{/each}
              </select></label>
              <label class="form-field"><span>Claim type</span><select bind:value={previewClaimType}>
                {#each CLAIM_TYPES.filter((type) => selectedTenant.config.claimTypes[type]?.enabled) as claimType}<option value={claimType}>{CLAIM_LABELS[claimType]}</option>{/each}
              </select></label>
              <label class="form-field"><span>Claim amount</span><div class="amount-input"><span>$</span><input type="number" min="0" step="100" bind:value={previewAmount} /></div></label>
              <label class="form-field"><span>Submission date</span><input type="date" bind:value={previewSubmittedAt} /></label>
              {#if selectedTenant.config.customFields.length}
                <div class="preview-custom-fields"><h3>Tenant-specific details</h3>
                  {#each selectedTenant.config.customFields as field}
                    <label class="form-field"><span>{field.label}{field.required ? " *" : ""}</span>
                      {#if field.type === "select"}
                        <select bind:value={previewCustomFields[field.id]}><option value="">Select…</option>{#each field.options ?? [] as option}<option value={option}>{option}</option>{/each}</select>
                      {:else}
                        <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} bind:value={previewCustomFields[field.id]} placeholder={field.type === "text" ? `Enter ${field.label.toLowerCase()}` : ""} />
                      {/if}
                    </label>
                  {/each}
                </div>
              {/if}
              <button class="button button-primary button-wide" onclick={runPreview} disabled={previewing || !selectedTenant.config.claimTypes[previewClaimType]?.enabled}>
                {previewing ? "Processing preview…" : "Run claim preview"} <span>→</span>
              </button>
              <p class="form-footnote">Preview only — no claim is saved or submitted.</p>
            </section>

            <section class="preview-output">
              {#if previewResult}
                <div class="result-banner">
                  <span class="result-check">✓</span><span><strong>Processing outcome</strong><small>Calculated from {selectedTenant.name}'s current rules</small></span>
                  <span class="step-badge">PREVIEW</span>
                </div>
                <article class="panel result-card">
                  <div class="result-card-heading"><div><span class="result-label">APPROVAL ROUTING</span>
                    <h2>{previewResult.approval.autoApproved ? "Auto-approved" : previewResult.approval.approverRole}</h2></div>
                    <span class:badge-success={previewResult.approval.autoApproved} class="status-badge">{previewResult.approval.autoApproved ? "Automatic" : "Manual review"}</span>
                  </div>
                  <p class="result-detail">{previewResult.approval.autoApproved
                    ? `This claim is below the ${selectedTenant.config.approval.autoApprovalThreshold.toLocaleString()} auto-approval threshold.`
                    : `Route to ${previewResult.approval.approverRole} for review.`}</p>
                </article>
                <article class="panel result-card">
                  <div class="result-label">REQUIRED DOCUMENTS <span class="small-count">{previewResult.requiredDocuments.length}</span></div>
                  {#if previewResult.requiredDocuments.length}
                    <ul class="result-list">{#each previewResult.requiredDocuments as document}<li><span class="document-check">✓</span><span>{document.label}</span><code>{document.id}</code></li>{/each}</ul>
                  {:else}<p class="result-detail">No required documents configured for this claim type.</p>{/if}
                </article>
                <article class="panel result-card">
                  <div class="result-label">NOTIFICATIONS</div>
                  {#if previewResult.notifications.length}
                    <ul class="notification-result-list">{#each previewResult.notifications as notification}
                      <li><span class="notification-event">{EVENT_LABELS[notification.event]}</span><span class="channel-tags">{#each notification.channels as channel}<span class="channel-tag">{CHANNEL_LABELS[channel]}</span>{/each}</span></li>
                    {/each}</ul>
                  {:else}<p class="result-detail">No notifications fire for this outcome.</p>{/if}
                </article>
                <article class="panel result-card sla-result">
                  <div class="sla-result-icon">◷</div><div><div class="result-label">PROCESSING DEADLINE</div>
                    <strong>{formatDate(previewResult.sla.deadline)}</strong>
                    <p>{previewResult.sla.targetBusinessDays} business days from submission</p>
                  </div>
                </article>
                <article class="panel result-card">
                  <div class="result-card-heading"><div class="result-label">CUSTOM FIELD VALIDATION</div>
                    <span class:badge-success={previewResult.customFields.valid} class="status-badge">{previewResult.customFields.valid ? "Valid" : "Action required"}</span>
                  </div>
                  {#if previewResult.customFields.required.length}
                    <div class="required-field-tags">{#each previewResult.customFields.required as field}<span>{field.label}</span>{/each}</div>
                  {/if}
                  {#if previewResult.customFields.errors.length}
                    <ul class="field-errors">{#each previewResult.customFields.errors as message}<li>{message}</li>{/each}</ul>
                  {:else}<p class="result-detail">All required custom fields are valid.</p>{/if}
                </article>
              {:else}
                <div class="preview-empty panel"><div class="preview-empty-art"><span>↗</span><i></i><b></b></div>
                  <h2>Your claim outcome, at a glance</h2><p>Choose a tenant, enter sample claim details, and run the preview to see approval routing, documents, notifications, and SLA.</p>
                  <div class="preview-empty-points"><span>✓ Rules-based routing</span><span>✓ Required documents</span><span>✓ Business-day SLA</span></div>
                </div>
              {/if}
            </section>
          </div>
        {:else}
          <div class="empty-state panel"><h2>No tenant available</h2><p>Create a tenant before previewing claim processing.</p><button class="button button-primary" onclick={() => startNewTenant()}>Add tenant</button></div>
        {/if}

      {:else if activeView === "compare"}
        <section class="page-heading">
          <div><div class="eyebrow">CONFIGURATION ANALYSIS</div><h1>Compare tenants</h1>
            <p class="page-description">Review configuration differences side by side.</p></div>
        </section>
        <section class="panel compare-panel">
          <div class="compare-selectors">
            <label class="form-field"><span>First tenant</span><select bind:value={compareLeftId} onchange={compareTenantConfigs}>
              {#each tenants as tenant}<option value={tenant.id}>{tenant.name}</option>{/each}
            </select></label>
            <span class="compare-versus">VS</span>
            <label class="form-field"><span>Second tenant</span><select bind:value={compareRightId} onchange={compareTenantConfigs}>
              {#each tenants as tenant}<option value={tenant.id}>{tenant.name}</option>{/each}
            </select></label>
          </div>
          {#if compareLeftId === compareRightId && tenants.length > 1}<p class="inline-error">Choose two different tenants to compare.</p>{/if}
          <div class="compare-results-heading"><div><h2>Configuration differences</h2><p>{comparing ? "Comparing configurations…" : `${compareDifferences.length} differences found`}</p></div>
            {#if comparedTenants.left && comparedTenants.right}<div class="compare-legend"><span class="legend-left"></span>{comparedTenants.left.name}<span class="legend-right"></span>{comparedTenants.right.name}</div>{/if}
          </div>
          {#if comparing}
            <div class="loading-state compact-loading"><span class="spinner"></span> Comparing tenant configurations…</div>
          {:else if comparedTenants.left && comparedTenants.right && compareLeftId !== compareRightId}
            {#if compareDifferences.length}
              <div class="diff-table">
                {#each compareDifferences as difference}
                  <div class="diff-row"><div class="diff-path"><span class="diff-marker">↳</span><code>{difference.path}</code></div>
                    <div class="diff-value diff-value-left"><CompareValue path={difference.path} value={difference.left} /></div>
                    <div class="diff-value diff-value-right"><CompareValue path={difference.path} value={difference.right} /></div>
                  </div>
                {/each}
              </div>
            {:else}<div class="empty-inline comparison-empty">These tenant configurations are identical.</div>{/if}
          {:else}<div class="empty-inline comparison-empty">Add at least two tenants to compare configurations.</div>{/if}
        </section>

      {/if}

      <footer class="app-footer"><span>AI Challenge 15 Insurance Platform</span><span>Configuration workspace <i>·</i> v1.0</span></footer>
    </div>
  </main>
</div>
