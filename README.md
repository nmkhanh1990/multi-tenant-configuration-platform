# AI Challenge 15 — Multi-Tenant Configuration Platform

## Context

An insurance platform serves multiple insurance companies (tenants). Each tenant has different branding, claim workflows, document requirements, benefit structures, and approval rules. The platform must be configurable per tenant without code changes — an operations team member should be able to onboard a new insurer by filling out a configuration form.

## Problem

Build a tenant configuration system with an admin UI where each tenant's claim processing behavior is fully configurable, and a runtime that processes claims differently based on tenant config.

## Tenant Configuration Schema

Each tenant's config covers:

### Branding
- Company name, logo URL, primary color, secondary color

### Claim Types
- Which claim types are enabled (OUTPATIENT, INPATIENT, DENTAL, MATERNITY, OPTICAL)
- Required documents per claim type
- Optional documents per claim type

### Approval Rules
- Auto-approval threshold (claims under this amount are approved automatically)
- Approval tiers: amount ranges mapped to required approver roles
  - e.g., < 10,000: auto-approve, 10,000–100,000: assessor, 100,000–500,000: team lead, > 500,000: director

### Notifications
- Events that trigger notifications (claim_submitted, approved, rejected, payment_sent)
- Channels per event (email, SMS, webhook)
- Custom email templates per event (or use default)

### SLA
- Target processing time per claim type (in business days)
- Escalation rules: if SLA breached, notify whom

### Custom Fields
- Additional data fields required during claim submission (e.g., "Employee ID" for corporate clients, "Department" for government clients)

## Sample Tenants

Create 3 tenant configurations with meaningful differences:

**Tenant A — "SafeGuard Insurance" (Corporate)**
- Enabled types: OUTPATIENT, INPATIENT, DENTAL
- Auto-approval: 20,000
- 3-tier approval (assessor, team lead, director)
- Notifications: email only
- SLA: 5 days outpatient, 10 days inpatient
- Custom field: Employee ID (required)

**Tenant B — "HealthFirst" (Retail)**
- Enabled types: OUTPATIENT, INPATIENT, DENTAL, MATERNITY, OPTICAL
- Auto-approval: 5,000
- 2-tier approval (assessor, manager)
- Notifications: email + SMS
- SLA: 7 days all types
- No custom fields

**Tenant C — "GovHealth" (Government)**
- Enabled types: OUTPATIENT, INPATIENT
- Auto-approval: 0 (all claims require manual review)
- Single-tier approval (committee)
- Notifications: email + webhook
- SLA: 15 days all types
- Custom fields: Department (required), Budget Code (required)

## Requirements

### Admin UI
- CRUD interface for tenant configurations
- Form validation: auto-approval threshold must be ≥ 0, at least one claim type enabled, SLA must be positive
- **Preview mode**: select a tenant + enter a sample claim → show how it would be processed (which approval tier, which notifications fire, which documents required)
- **Config diff**: select two tenants → side-by-side comparison highlighting differences
- **Config history**: every save creates a version — view past versions and rollback to any previous version

### Runtime Processing
- A function/API: `processClaim(tenantId, claimData)` that returns:
  - Required documents for this claim type (based on tenant config)
  - Approval routing (which tier and approver role)
  - Notifications to send (which channels)
  - SLA deadline (calculated from submission date + tenant's SLA days)
  - Custom fields required (with validation)
- Demonstrate with 3 identical claims submitted to 3 different tenants — each produces different processing behavior

### Adding a New Tenant
- Onboarding a 4th tenant must require zero code changes — only configuration via the admin UI
- Demonstrate by creating a 4th tenant through the UI and processing a claim against it

## Evaluation Criteria

- All 3 tenants produce different claim processing behavior for the same claim
- Admin UI validates config and prevents invalid configurations
- Preview mode accurately predicts processing outcome for a sample claim
- Config diff correctly identifies all differences between tenant pairs
- Config history and rollback work correctly
- 4th tenant onboarding requires zero code changes
- Runtime processing function returns correct results for each tenant
- Code is modular — adding a new config dimension (e.g., "currency settings") requires minimal changes

## Submission

- Push your project onto a GitHub repository
- Deploy to any free hosting and provide a live URL for the admin UI
- Include a brief demo script showing: create tenant, configure it, process claims, compare configs

## API and Runtime

### Run locally

Requirements: Node.js 20 or later and pnpm 11.

```sh
pnpm install
pnpm dev
```

The Express API listens on `http://localhost:3001` and the SvelteKit app on
`http://localhost:5173`. On first startup the API seeds the three sample tenants
if the SQLite database is empty. The default database is `data/platform.sqlite`.

Configure the API with:

- `PORT` — HTTP port (default `3001`)
- `DATABASE_PATH` — SQLite file path (default `data/platform.sqlite`; use `:memory:` for an ephemeral database)
- `CORS_ORIGINS` — comma-separated browser origins (default `http://localhost:5173,http://127.0.0.1:5173`)
- `VITE_API_BASE_URL` — browser-visible API base URL (default `http://localhost:3001/api`)

### Endpoints

All routes except `/health` are under `/api`. JSON validation errors return
`400`; unknown tenants or versions return `404`; stale writes return `409`;
invalid claim input or disabled claim types return `422`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tenants` | List tenants with their current config/version |
| `POST` | `/api/tenants` | Create a tenant with its initial config version |
| `GET` | `/api/tenants/:tenantId` | Read a tenant and current config |
| `PUT` | `/api/tenants/:tenantId` | Save config as a new version; requires `expectedVersion` |
| `DELETE` | `/api/tenants/:tenantId` | Delete a tenant and its version history |
| `GET` | `/api/tenants/:tenantId/versions` | List immutable config snapshots |
| `GET` | `/api/tenants/:tenantId/versions/:version` | Read a historical config snapshot |
| `POST` | `/api/tenants/:tenantId/versions/:version/rollback` | Restore a snapshot as a new version |
| `POST` | `/api/tenants/compare` | Compare two tenant configs and return changed paths |
| `POST` | `/api/tenants/:tenantId/preview` | Preview processing for a claim against a tenant |
| `POST` | `/api/claims/process` | Process a claim using `{ "tenantId", "claimData" }` |

Claim input contains `claimType`, non-negative `amount`, ISO `submittedAt`, and
an optional `customFields` object. Processing returns required documents,
approval routing, notifications, a business-day SLA deadline, and the required
custom field definitions plus any validation errors. Custom-field validation
errors are part of the preview result (`customFields.valid` and `customFields.errors`).
Approval at the threshold amount is routed to the matching approval tier; only
amounts strictly below the threshold are auto-approved. Business-day deadlines
skip Saturdays and Sundays.

Run workspace checks and tests with `pnpm check`, `pnpm test`, and `pnpm build`.

## Free demo deployment

The demo deployment uses Cloudflare Pages for the SvelteKit admin UI and a
Render Free Web Service for the Express API. It is intended for evaluation and
sample data only, not production use. Deploy the Pages site once first to get
its assigned origin, create the Render service with that origin in CORS, then
set the Pages API URL and redeploy the UI.

### Deploy the admin UI (first pass)

1. In Cloudflare Pages, import this GitHub repository with the SvelteKit preset.
2. Set the root directory to `apps/web` and configure:
   - Build command: `pnpm install --frozen-lockfile && pnpm --filter @mtcp/shared build && pnpm --filter @mtcp/web build`
   - Build output directory: `.svelte-kit/cloudflare`
   - `NODE_VERSION`: `22.22.0`
3. Deploy once to get the assigned Pages origin. The API connection will
   remain unavailable until the API is deployed and the UI is connected below.

### Deploy the API

1. In Render, create a Blueprint from this repository and select `render.yaml`.
2. Set `CORS_ORIGINS` to the exact public Cloudflare Pages origin
   (for example, `https://<project>.pages.dev`).
3. Deploy and wait for `https://<api-service>.onrender.com/health` to return
   `{"status":"ok"}`. The API base URL is
   `https://<api-service>.onrender.com/api`.

### Connect and verify

1. Set `VITE_API_BASE_URL` to
   `https://<api-service>.onrender.com/api` in Cloudflare Pages and redeploy.
2. Open the Pages URL directly and test `/tenants/create` and a tenant detail
   URL to verify deep links are served.

**Live admin UI:** https://multi-tenant-configuration-platform.pages.dev/

**API health:** https://multi-tenant-configuration-api.onrender.com/health

The API uses `/tmp/platform.sqlite`. [Render Free services](https://render.com/docs/free)
have an ephemeral filesystem, spin down after 15 minutes without traffic, and
may take about a minute to wake. Tenant changes and version history can be lost
on spin-down, restart, or redeploy; the API seeds the sample tenants again when
it starts with an empty database. Do not use this deployment for production or
real personal data.

### Demo script

1. Open **Tenants** and select **Add tenant**.
2. Enter the company name and review the generated tenant ID; complete each
   configuration step and create the tenant.
3. Open **Claim preview**, choose the new tenant, enter a sample claim, and run
   the preview. Compare its routing, documents, notifications, and SLA against
   one of the seeded tenants.
4. Open **Compare tenants**, select two tenants, and review the configuration
   differences.

Changes made in the public demo are temporary and may be visible to other
visitors until the free API service restarts or spins down.
