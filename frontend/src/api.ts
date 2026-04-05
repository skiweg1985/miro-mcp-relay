import type {
  ApiError,
  AuditEventOut,
  AuthFlowStartResponse,
  ConnectionProbeResult,
  ConnectedAccountOut,
  DelegationGrantCreateResult,
  DelegationGrantOut,
  BrokerCallbackUrls,
  Health,
  IntegrationTestResult,
  LoginOptionsResponse,
  ConnectionAccessDetails,
  ProviderAppOut,
  ProviderDefinitionOut,
  ProviderInstanceOut,
  AccessCredentialRotateResult,
  SelfServiceDelegationGrantCreateResult,
  SelfServiceDelegationGrantOut,
  ServiceClientCreateResult,
  ServiceClientOut,
  SessionResponse,
  TokenIssueEventOut,
  UserOut,
} from "./types";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

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
  providerDefinitions() {
    return request<ProviderDefinitionOut[]>("/api/v1/provider-definitions");
  },
  providerAppsForUser() {
    return request<ProviderAppOut[]>("/api/v1/provider-apps");
  },
  myConnections() {
    return request<ConnectedAccountOut[]>("/api/v1/connections");
  },
  startMiroConnection(csrfToken: string, body: unknown = {}) {
    return request<{ ok: boolean; auth_url: string; state: string }>("/api/v1/connections/miro/start", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  startProviderConnection(csrfToken: string, providerAppKey: string, connectedAccountId?: string | null) {
    return request<{ ok: boolean; auth_url: string; state: string; provider_app_key: string }>("/api/v1/connections/provider-connect/start", {
      method: "POST",
      csrfToken,
      body: {
        provider_app_key: providerAppKey,
        connected_account_id: connectedAccountId ?? null,
      },
    });
  },
  refreshConnection(csrfToken: string, connectionId: string) {
    return request<ConnectedAccountOut>(`/api/v1/connections/${connectionId}/refresh`, {
      method: "POST",
      csrfToken,
    });
  },
  revokeConnection(csrfToken: string, connectionId: string) {
    return request<ConnectedAccountOut>(`/api/v1/connections/${connectionId}/revoke`, {
      method: "POST",
      csrfToken,
    });
  },
  probeConnection(csrfToken: string, connectionId: string) {
    return request<ConnectionProbeResult>(`/api/v1/connections/${connectionId}/probe`, {
      method: "POST",
      csrfToken,
    });
  },
  connectionAccessDetails(connectionId: string) {
    return request<ConnectionAccessDetails>(`/api/v1/connections/${connectionId}/access-details`);
  },
  myServiceClients() {
    return request<ServiceClientOut[]>("/api/v1/service-clients");
  },
  createMyServiceClient(csrfToken: string, body: unknown) {
    return request<ServiceClientCreateResult>("/api/v1/service-clients", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  updateMyServiceClient(csrfToken: string, serviceClientId: string, body: unknown) {
    return request<ServiceClientOut>(`/api/v1/service-clients/${encodeURIComponent(serviceClientId)}`, {
      method: "PATCH",
      csrfToken,
      body,
    });
  },
  deleteMyServiceClient(csrfToken: string, serviceClientId: string) {
    return request<void>(`/api/v1/service-clients/${encodeURIComponent(serviceClientId)}`, {
      method: "DELETE",
      csrfToken,
    });
  },
  rotateMyServiceClientSecret(csrfToken: string, serviceClientId: string) {
    return request<ServiceClientCreateResult>(
      `/api/v1/service-clients/${encodeURIComponent(serviceClientId)}/rotate-secret`,
      {
        method: "POST",
        csrfToken,
      },
    );
  },
  myDelegationGrants() {
    return request<SelfServiceDelegationGrantOut[]>("/api/v1/delegation-grants");
  },
  getMyDelegationGrantAccessCredential(grantId: string) {
    return request<AccessCredentialRotateResult>(`/api/v1/delegation-grants/${grantId}/access-credential`);
  },
  createMyDelegationGrant(csrfToken: string, body: unknown) {
    return request<SelfServiceDelegationGrantCreateResult>("/api/v1/delegation-grants", {
      method: "POST",
      csrfToken,
      body,
    });
  },
  revokeMyDelegationGrant(csrfToken: string, grantId: string) {
    return request<SelfServiceDelegationGrantOut>(`/api/v1/delegation-grants/${grantId}/revoke`, {
      method: "POST",
      csrfToken,
    });
  },
  rotateMyDelegationGrantCredential(csrfToken: string, grantId: string) {
    return request<AccessCredentialRotateResult>(`/api/v1/delegation-grants/${grantId}/rotate-credential`, {
      method: "POST",
      csrfToken,
    });
  },
  myTokenIssues(
    params: {
      serviceClientId?: string;
      delegationGrantId?: string;
      fromTime?: string;
      toTime?: string;
      limit?: number;
    } = {},
  ) {
    const search = new URLSearchParams();
    if (params.serviceClientId) search.set("service_client_id", params.serviceClientId);
    if (params.delegationGrantId) search.set("delegation_grant_id", params.delegationGrantId);
    if (params.fromTime) search.set("from_time", params.fromTime);
    if (params.toTime) search.set("to_time", params.toTime);
    search.set("limit", String(params.limit ?? 100));
    return request<TokenIssueEventOut[]>(`/api/v1/token-issues?${search.toString()}`);
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
  updateProviderInstance(csrfToken: string, providerInstanceId: string, body: unknown) {
    return request<ProviderInstanceOut>(`/api/v1/admin/provider-instances/${providerInstanceId}`, {
      method: "PATCH",
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
  updateProviderApp(csrfToken: string, providerAppId: string, body: unknown) {
    return request<ProviderAppOut>(`/api/v1/admin/provider-apps/${encodeURIComponent(providerAppId)}`, {
      method: "PATCH",
      csrfToken,
      body,
    });
  },
  deleteProviderApp(csrfToken: string, providerAppId: string) {
    return request<void>(`/api/v1/admin/provider-apps/${encodeURIComponent(providerAppId)}`, {
      method: "DELETE",
      csrfToken,
    });
  },
  connectedAccounts(csrfToken: string) {
    return request<ConnectedAccountOut[]>("/api/v1/admin/connected-accounts", { csrfToken });
  },
  filteredConnectedAccounts(
    csrfToken: string,
    params: {
      userEmail?: string;
      providerAppKey?: string;
      status?: string;
      limit?: number;
    } = {},
  ) {
    const search = new URLSearchParams();
    if (params.userEmail) search.set("user_email", params.userEmail);
    if (params.providerAppKey) search.set("provider_app_key", params.providerAppKey);
    if (params.status) search.set("status", params.status);
    search.set("limit", String(params.limit ?? 200));
    return request<ConnectedAccountOut[]>(`/api/v1/admin/connected-accounts?${search.toString()}`, { csrfToken });
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
  adminServiceClientsForUser(csrfToken: string, userId: string) {
    return request<ServiceClientOut[]>(`/api/v1/admin/users/${encodeURIComponent(userId)}/service-clients`, { csrfToken });
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
  testIntegration(csrfToken: string, templateKey: string) {
    return request<IntegrationTestResult>("/api/v1/admin/integrations/test", {
      method: "POST",
      csrfToken,
      body: { template_key: templateKey },
    });
  },
  adminTokenIssues(
    csrfToken: string,
    params: {
      userId?: string;
      serviceClientId?: string;
      providerAppId?: string;
      decision?: string;
      fromTime?: string;
      toTime?: string;
      limit?: number;
    } = {},
  ) {
    const search = new URLSearchParams();
    if (params.userId) search.set("user_id", params.userId);
    if (params.serviceClientId) search.set("service_client_id", params.serviceClientId);
    if (params.providerAppId) search.set("provider_app_id", params.providerAppId);
    if (params.decision) search.set("decision", params.decision);
    if (params.fromTime) search.set("from_time", params.fromTime);
    if (params.toTime) search.set("to_time", params.toTime);
    search.set("limit", String(params.limit ?? 200));
    return request<TokenIssueEventOut[]>(`/api/v1/admin/token-issues?${search.toString()}`, { csrfToken });
  },
};
