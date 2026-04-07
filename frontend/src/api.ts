import type {
  ApiError,
  AuthFlowStartResponse,
  BrokerCallbackUrls,
  Health,
  IntegrationInstanceV2Out,
  IntegrationToolV2Out,
  IntegrationV2Out,
  LoginOptionsResponse,
  MicrosoftOAuthAdminOut,
  SessionResponse,
} from "./types";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  csrfToken?: string;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.csrfToken) {
    headers["X-CSRF-Token"] = options.csrfToken;
  }

  const response = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    let detail: unknown;
    let message = `Request failed with status ${response.status}`;
    if (text) {
      try {
        const body = JSON.parse(text) as unknown;
        detail = body;
        if (typeof body === "object" && body !== null && "detail" in body) {
          detail = (body as { detail: unknown }).detail;
        }
        if (typeof detail === "string") {
          message = detail;
        } else if (
          typeof detail === "object" &&
          detail !== null &&
          "message" in detail &&
          typeof (detail as { message?: unknown }).message === "string"
        ) {
          message = (detail as { message: string }).message;
        }
      } catch {
        message = text;
      }
    }
    const error: ApiError = { status: response.status, message, detail };
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  health() {
    return request<Health>("/api/v1/health");
  },
  brokerCallbackUrls() {
    return request<BrokerCallbackUrls>("/api/v1/broker-callback-urls");
  },
  loginOptions() {
    return request<LoginOptionsResponse>("/api/v1/auth/login-options");
  },
  startMicrosoftLogin() {
    return request<AuthFlowStartResponse>("/api/v1/auth/microsoft/start", {
      method: "POST",
    });
  },
  login(email: string, password: string) {
    return request<SessionResponse>("/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
    });
  },
  me() {
    return request<SessionResponse>("/api/v1/sessions/me");
  },
  logout(csrfToken: string) {
    return request<{ ok: boolean }>("/api/v1/auth/logout", {
      method: "POST",
      csrfToken,
    });
  },
  integrationsV2() {
    return request<IntegrationV2Out[]>("/api/v1/integrations");
  },
  createIntegrationV2(csrfToken: string, body: unknown) {
    return request<IntegrationV2Out>("/api/v1/integrations", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  integrationInstancesV2() {
    return request<IntegrationInstanceV2Out[]>("/api/v1/integration-instances");
  },
  createIntegrationInstanceV2(csrfToken: string, body: unknown) {
    return request<IntegrationInstanceV2Out>("/api/v1/integration-instances", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  discoverIntegrationToolsV2(instanceId: string) {
    return request<IntegrationToolV2Out[]>(`/api/v1/integration-instances/${encodeURIComponent(instanceId)}/discover-tools`, {
      method: "POST",
    });
  },
  executeIntegrationV2(instanceId: string, body: unknown) {
    return request<{ ok: boolean; result: Record<string, unknown> }>(
      `/api/v1/integration-instances/${encodeURIComponent(instanceId)}/execute`,
      {
        method: "POST",
        body,
      },
    );
  },
  getMicrosoftOAuthAdmin() {
    return request<MicrosoftOAuthAdminOut>("/api/v1/admin/microsoft-oauth");
  },
  putMicrosoftOAuthAdmin(csrfToken: string, body: Record<string, unknown>) {
    return request<MicrosoftOAuthAdminOut>("/api/v1/admin/microsoft-oauth", {
      method: "PUT",
      csrfToken,
      body,
    });
  },
};
