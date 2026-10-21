import express, {
  type ErrorRequestHandler,
  type Response
} from "express";
import cors from "cors";
import {
  diffConfigs,
  SAMPLE_TENANTS,
  TenantSchema,
} from "@mtcp/shared";
import { z } from "zod";
import { processClaim } from "./claim-processing.js";
import { ApiError } from "./errors.js";
import { TenantStore } from "./tenant-store.js";

const CreateTenantRequestSchema = TenantSchema.extend({
  createdBy: z.string().trim().min(1).optional()
});

const UpdateTenantRequestSchema = z.object({
  name: z.string().trim().min(1),
  segment: TenantSchema.shape.segment,
  config: TenantSchema.shape.config,
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().min(1).nullable().optional(),
  createdBy: z.string().trim().min(1).optional()
});

const ActorRequestSchema = z.object({
  createdBy: z.string().trim().min(1).optional()
});

const CompareRequestSchema = z.object({
  leftTenantId: TenantSchema.shape.id,
  rightTenantId: TenantSchema.shape.id
}).refine((input) => input.leftTenantId !== input.rightTenantId, {
  message: "Choose two different tenants"
});

function sendValidationError(response: Response, message: string, details: unknown): void {
  response.status(400).json({
    error: {
      code: "validation_error",
      message,
      details
    }
  });
}

function parseVersion(value: string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError(400, "invalid_version", "Version must be a positive integer");
  }
  return version;
}

export function seedSampleTenants(store: TenantStore): void {
  if (store.list().length > 0) {
    return;
  }

  for (const tenant of SAMPLE_TENANTS) {
    store.create(tenant, "system");
  }
}

export function createApp(store: TenantStore): express.Express {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGINS
    ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const api = express.Router();

  api.get("/tenants", (_request, response) => {
    response.json({ tenants: store.list() });
  });

  api.post("/tenants/compare", (request, response) => {
    const parsed = CompareRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, "Tenant comparison request is invalid", parsed.error.issues);
      return;
    }

    const left = store.get(parsed.data.leftTenantId);
    const right = store.get(parsed.data.rightTenantId);
    response.json({
      left: { id: left.id, name: left.name },
      right: { id: right.id, name: right.name },
      differences: diffConfigs(left.config, right.config)
    });
  });

  api.post("/tenants", (request, response) => {
    const parsed = CreateTenantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, "Tenant configuration is invalid", parsed.error.issues);
      return;
    }

    const { createdBy = "system", ...tenant } = parsed.data;
    response.status(201).json({ tenant: store.create(tenant, createdBy) });
  });

  api.get("/tenants/:tenantId", (request, response) => {
    response.json({ tenant: store.get(request.params.tenantId) });
  });

  api.put("/tenants/:tenantId", (request, response) => {
    const parsed = UpdateTenantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, "Tenant update is invalid", parsed.error.issues);
      return;
    }

    const {
      createdBy = "system",
      note = null,
      ...input
    } = parsed.data;
    response.json({
      tenant: store.update(request.params.tenantId, {
        ...input,
        createdBy,
        note
      })
    });
  });

  api.delete("/tenants/:tenantId", (request, response) => {
    store.delete(request.params.tenantId);
    response.status(204).end();
  });

  api.get("/tenants/:tenantId/versions", (request, response) => {
    response.json({ versions: store.listVersions(request.params.tenantId) });
  });

  api.get("/tenants/:tenantId/versions/:version", (request, response) => {
    const version = store.getVersion(request.params.tenantId, parseVersion(request.params.version));
    response.json({ version });
  });

  api.post("/tenants/:tenantId/versions/:version/rollback", (request, response) => {
    const body = ActorRequestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      sendValidationError(response, "Rollback request is invalid", body.error.issues);
      return;
    }

    const tenant = store.rollback(
      request.params.tenantId,
      parseVersion(request.params.version),
      body.data.createdBy ?? "system"
    );
    response.json({ tenant });
  });

  api.post("/tenants/:tenantId/preview", (request, response) => {
    const tenant = store.get(request.params.tenantId);
    response.json({ result: processClaim(tenant, request.body) });
  });

  api.post("/claims/process", (request, response) => {
    const envelopeSchema = z.object({
      tenantId: TenantSchema.shape.id,
      claimData: z.unknown()
    });
    const parsed = envelopeSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, "Claim processing request is invalid", parsed.error.issues);
      return;
    }

    const tenant = store.get(parsed.data.tenantId);
    response.json({ result: processClaim(tenant, parsed.data.claimData) });
  });

  app.use("/api", api);
  app.use((_request, _response, next) => {
    next(new ApiError(404, "route_not_found", "Route was not found"));
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
      return;
    }

    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json({
        error: { code: "malformed_json", message: "Request body must contain valid JSON" }
      });
      return;
    }

    if (error instanceof Error && "status" in error && typeof error.status === "number"
      && error.status >= 400 && error.status < 500) {
      response.status(error.status).json({
        error: {
          code: error.status === 413 ? "payload_too_large" : "invalid_request",
          message: error.status === 413
            ? "Request body exceeds the 1 MB limit"
            : "The request could not be processed"
        }
      });
      return;
    }

    console.error("Unhandled API error", error);
    response.status(500).json({
      error: { code: "internal_error", message: "An unexpected server error occurred" }
    });
  };
  app.use(errorHandler);

  return app;
}
