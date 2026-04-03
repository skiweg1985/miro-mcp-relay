import type {
  ApiError,
  AuditEventOut,
  ConnectedAccountOut,
  DelegationGrantCreateResult,
  DelegationGrantOut,
  Health,
  ProviderAppOut,
  ProviderDefinitionOut,
  ProviderInstanceOut,
  ServiceClientCreateResult,
  ServiceClientOut,
  SessionResponse,
  UserOut,
} from "./types";

type HttpMethod = "GET" | "POST";

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
    let detail: unknown;
    let message = `Request failed with status ${response.status}`;
    try {
      detail = await response.json();
      if (typeof detail === "object" && detail !== null && "detail" in detail) {
        const detailMessage = (detail as { detail?: unknown }).detail;
        if (typeof detailMessage === "string") {
          message = detailMessage;
        }
      }
    } catch {
      const text = await response.text();
      if (text) message = text;
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
  providerDefinitions() {
    return request<ProviderDefinitionOut[]>("/api/v1/provider-definitions");
  },
  adminUsers(csrfToken: string) {
    return request<UserOut[]>("/api/v1/admin/users", { csrfToken });
  },
  providerInstances(csrfToken: string) {
    return request<ProviderInstanceOut[]>("/api/v1/admin/provider-instances", { csrfToken });
  },
  createProviderInstance(csrfToken: string, body: unknown) {
    return request<ProviderInstanceOut>("/api/v1/admin/provider-instances", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  providerApps(csrfToken: string) {
    return request<ProviderAppOut[]>("/api/v1/admin/provider-apps", { csrfToken });
  },
  createProviderApp(csrfToken: string, body: unknown) {
    return request<ProviderAppOut>("/api/v1/admin/provider-apps", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  connectedAccounts(csrfToken: string) {
    return request<ConnectedAccountOut[]>("/api/v1/admin/connected-accounts", { csrfToken });
  },
  createConnectedAccount(csrfToken: string, body: unknown) {
    return request<ConnectedAccountOut>("/api/v1/admin/connected-accounts/manual", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  serviceClients(csrfToken: string) {
    return request<ServiceClientOut[]>("/api/v1/admin/service-clients", { csrfToken });
  },
  createServiceClient(csrfToken: string, body: unknown) {
    return request<ServiceClientCreateResult>("/api/v1/admin/service-clients", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  delegationGrants(csrfToken: string) {
    return request<DelegationGrantOut[]>("/api/v1/admin/delegation-grants", { csrfToken });
  },
  createDelegationGrant(csrfToken: string, body: unknown) {
    return request<DelegationGrantCreateResult>("/api/v1/admin/delegation-grants", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  revokeDelegationGrant(csrfToken: string, grantId: string) {
    return request<DelegationGrantOut>(`/api/v1/admin/delegation-grants/${grantId}/revoke`, {
      method: "POST",
      csrfToken,
    });
  },
  auditEvents(csrfToken: string, limit = 200) {
    return request<AuditEventOut[]>(`/api/v1/admin/audit?limit=${limit}`, { csrfToken });
  },
};
