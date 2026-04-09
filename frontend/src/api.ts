import type {
  AccessGrantCreatedResponse,
  AccessGrantOut,
  AdminUserActionResult,
  AdminUserDetailResponse,
  AdminConnectionRefreshResult,
  AdminUserHardDeleteResult,
  AdminUserListResponse,
  ApiError,
  AuthFlowStartResponse,
  BrokerCallbackUrls,
  Health,
  IntegrationDeleteResult,
  IntegrationInstanceDeleteResult,
  IntegrationInstanceInspectOut,
  IntegrationInstanceV2Out,
  IntegrationToolV2Out,
  IntegrationV2Out,
  LoginOptionsResponse,
  MicrosoftOAuthAdminOut,
  BrokerLoginProviderOut,
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
  startBrokerLogin(providerId: string) {
    return request<AuthFlowStartResponse>(`/api/v1/auth/${encodeURIComponent(providerId)}/start`, {
      method: "POST",
    });
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
  patchIntegrationV2(csrfToken: string, integrationId: string, body: Record<string, unknown>) {
    return request<IntegrationV2Out>(`/api/v1/integrations/${encodeURIComponent(integrationId)}`, {
      method: "PATCH",
      csrfToken,
      body,
    });
  },
  integrationInstancesV2() {
    return request<IntegrationInstanceV2Out[]>("/api/v1/integration-instances");
  },
  integrationInstanceInspect(instanceId: string) {
    return request<IntegrationInstanceInspectOut>(
      `/api/v1/integration-instances/${encodeURIComponent(instanceId)}/inspect`,
    );
  },
  createIntegrationInstanceV2(csrfToken: string, body: unknown) {
    return request<IntegrationInstanceV2Out>("/api/v1/integration-instances", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  patchIntegrationInstanceV2(csrfToken: string, instanceId: string, body: Record<string, unknown>) {
    return request<IntegrationInstanceV2Out>(`/api/v1/integration-instances/${encodeURIComponent(instanceId)}`, {
      method: "PATCH",
      csrfToken,
      body,
    });
  },
  deleteIntegrationInstanceV2(csrfToken: string, instanceId: string) {
    return request<IntegrationInstanceDeleteResult>(`/api/v1/integration-instances/${encodeURIComponent(instanceId)}`, {
      method: "DELETE",
      csrfToken,
    });
  },
  deleteIntegrationV2(csrfToken: string, integrationId: string) {
    return request<IntegrationDeleteResult>(`/api/v1/integrations/${encodeURIComponent(integrationId)}`, {
      method: "DELETE",
      csrfToken,
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
  startIntegrationOAuth(instanceId: string) {
    return request<AuthFlowStartResponse>(`/api/v1/integration-instances/${encodeURIComponent(instanceId)}/oauth/start`, {
      method: "POST",
    });
  },
  disconnectIntegrationOAuth(csrfToken: string, instanceId: string) {
    return request<{ ok: boolean }>(`/api/v1/integration-instances/${encodeURIComponent(instanceId)}/oauth/disconnect`, {
      method: "POST",
      csrfToken,
    });
  },
  accessGrants() {
    return request<AccessGrantOut[]>("/api/v1/access-grants");
  },
  createAccessGrant(csrfToken: string, body: Record<string, unknown>) {
    return request<AccessGrantCreatedResponse>("/api/v1/access-grants", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  revokeAccessGrant(csrfToken: string, grantId: string) {
    return request<AccessGrantOut>(`/api/v1/access-grants/${encodeURIComponent(grantId)}/revoke`, {
      method: "POST",
      csrfToken,
    });
  },
  deleteAccessGrant(csrfToken: string, grantId: string) {
    return request<{ ok: boolean; id: string }>(`/api/v1/access-grants/${encodeURIComponent(grantId)}`, {
      method: "DELETE",
      csrfToken,
    });
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
  listBrokerLoginProviders() {
    return request<BrokerLoginProviderOut[]>("/api/v1/admin/broker-login-providers");
  },
  createBrokerLoginProvider(csrfToken: string, body: Record<string, unknown>) {
    return request<BrokerLoginProviderOut>("/api/v1/admin/broker-login-providers", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  patchBrokerLoginProvider(csrfToken: string, providerKey: string, body: Record<string, unknown>) {
    return request<BrokerLoginProviderOut>(`/api/v1/admin/broker-login-providers/${encodeURIComponent(providerKey)}`, {
      method: "PATCH",
      csrfToken,
      body,
    });
  },
  deleteBrokerLoginProvider(csrfToken: string, providerKey: string) {
    return request<{ ok: boolean }>(`/api/v1/admin/broker-login-providers/${encodeURIComponent(providerKey)}`, {
      method: "DELETE",
      csrfToken,
    });
  },
  listAdminUsers(params: { status?: string; q?: string; provider_key?: string; limit?: number; offset?: number }) {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.q?.trim()) sp.set("q", params.q.trim());
    if (params.provider_key?.trim()) sp.set("provider_key", params.provider_key.trim());
    if (params.limit != null) sp.set("limit", String(params.limit));
    if (params.offset != null) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    return request<AdminUserListResponse>(`/api/v1/admin/users${qs ? `?${qs}` : ""}`);
  },
  getAdminUserDetail(userId: string) {
    return request<AdminUserDetailResponse>(`/api/v1/admin/users/${encodeURIComponent(userId)}`);
  },
  adminDeprovisionUser(csrfToken: string, userId: string) {
    return request<AdminUserActionResult>(`/api/v1/admin/users/${encodeURIComponent(userId)}/deprovision`, {
      method: "POST",
      csrfToken,
      body: {},
    });
  },
  adminSoftDeleteUser(csrfToken: string, userId: string) {
    return request<AdminUserActionResult>(`/api/v1/admin/users/${encodeURIComponent(userId)}/soft-delete`, {
      method: "POST",
      csrfToken,
      body: {},
    });
  },
  adminReactivateUser(csrfToken: string, userId: string) {
    return request<AdminUserActionResult>(`/api/v1/admin/users/${encodeURIComponent(userId)}/reactivate`, {
      method: "POST",
      csrfToken,
      body: {},
    });
  },
  adminRevokeAllUserSessions(csrfToken: string, userId: string) {
    return request<AdminUserActionResult>(`/api/v1/admin/users/${encodeURIComponent(userId)}/sessions/revoke-all`, {
      method: "POST",
      csrfToken,
      body: {},
    });
  },
  adminRevokeUserSession(csrfToken: string, userId: string, sessionId: string) {
    return request<AdminUserActionResult>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
      {
        method: "POST",
        csrfToken,
        body: {},
      },
    );
  },
  adminRevokeAllUserAccessKeys(csrfToken: string, userId: string) {
    return request<AdminUserActionResult>(`/api/v1/admin/users/${encodeURIComponent(userId)}/access-keys/revoke-all`, {
      method: "POST",
      csrfToken,
      body: {},
    });
  },
  adminHardDeleteUser(csrfToken: string, userId: string, confirmEmail: string) {
    return request<AdminUserHardDeleteResult>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      csrfToken,
      body: { confirm_email: confirmEmail.trim() },
    });
  },
  adminRefreshUserConnection(csrfToken: string, connectionId: string) {
    return request<AdminConnectionRefreshResult>(`/api/v1/admin/connections/${encodeURIComponent(connectionId)}/refresh`, {
      method: "POST",
      csrfToken,
      body: {},
    });
  },
};
