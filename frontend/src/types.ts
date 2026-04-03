export type ApiError = {
  status: number;
  message: string;
  detail?: unknown;
};

export type AuthFlowStartResponse = {
  ok: boolean;
  auth_url: string;
  state: string;
};

export type LoginOptionsResponse = {
  ok: boolean;
  microsoft_enabled: boolean;
  microsoft_display_name: string | null;
};

export type UserOut = {
  id: string;
  organization_id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

export type SessionResponse = {
  ok: boolean;
  user: UserOut;
  csrf_token: string;
};

export type SessionState =
  | {
      status: "booting";
      user: null;
      csrfToken: "";
    }
  | {
      status: "anonymous";
      user: null;
      csrfToken: "";
    }
  | {
      status: "authenticated";
      user: UserOut;
      csrfToken: string;
    };

export type Health = {
  ok: boolean;
  service: string;
};

export type ProviderDefinitionOut = {
  id: string;
  key: string;
  display_name: string;
  protocol: string;
  supports_broker_auth: boolean;
  supports_downstream_oauth: boolean;
  metadata: {
    templates?: ProviderTemplate[];
  };
};

export type ProviderTemplate = {
  template_key: string;
  provider_definition_key: string;
  route_key: string;
  display_name: string;
  description: string;
  instance: {
    key: string;
    display_name: string;
    role: string;
    issuer: string | null;
    authorization_endpoint: string | null;
    token_endpoint: string | null;
    userinfo_endpoint: string | null;
    settings: Record<string, unknown>;
  };
  app: {
    key: string;
    display_name: string;
    client_id: string | null;
    redirect_uris: string[];
    default_scopes: string[];
    scope_ceiling: string[];
    access_mode: string;
    allow_relay: boolean;
    allow_direct_token_return: boolean;
    relay_protocol: string | null;
  };
};

export type ProviderInstanceOut = {
  id: string;
  key: string;
  display_name: string;
  provider_definition_key: string;
  role: string;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  settings: Record<string, unknown>;
  is_enabled: boolean;
};

export type ProviderAppOut = {
  id: string;
  key: string;
  template_key: string | null;
  display_name: string;
  provider_instance_id: string;
  provider_instance_key: string | null;
  access_mode: string;
  allow_relay: boolean;
  allow_direct_token_return: boolean;
  relay_protocol: string | null;
  client_id: string | null;
  has_client_secret: boolean;
  redirect_uris: string[];
  default_scopes: string[];
  scope_ceiling: string[];
  is_enabled: boolean;
};

export type ServiceClientOut = {
  id: string;
  key: string;
  display_name: string;
  auth_method: string;
  environment: string | null;
  is_enabled: boolean;
  created_at: string;
};

export type ServiceClientCreateResult = {
  ok: boolean;
  service_client: ServiceClientOut;
  client_secret: string;
};

export type ConnectedAccountOut = {
  id: string;
  user_id: string;
  provider_app_id: string;
  external_account_ref: string | null;
  external_email: string | null;
  display_name: string | null;
  status: string;
  last_error: string | null;
  connected_at: string;
};

export type DelegationGrantOut = {
  id: string;
  user_id: string;
  service_client_id: string;
  provider_app_id: string;
  connected_account_id: string | null;
  environment: string | null;
  is_enabled: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type DelegationGrantCreateResult = {
  ok: boolean;
  delegation_grant: DelegationGrantOut;
  delegated_credential: string;
};

export type VisibleServiceClientOut = {
  id: string;
  key: string;
  display_name: string;
  environment: string | null;
  created_at: string;
};

export type SelfServiceDelegationGrantOut = {
  id: string;
  service_client_id: string;
  service_client_key: string;
  service_client_display_name: string;
  provider_app_id: string;
  provider_app_key: string;
  provider_app_display_name: string;
  connected_account_id: string | null;
  connected_account_display_name: string | null;
  allowed_access_modes: string[];
  scope_ceiling: string[];
  capabilities: string[];
  environment: string | null;
  is_enabled: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type SelfServiceDelegationGrantCreateResult = {
  ok: boolean;
  delegation_grant: SelfServiceDelegationGrantOut;
  delegated_credential: string;
};

export type TokenIssueEventOut = {
  id: string;
  service_client_id: string | null;
  service_client_display_name: string | null;
  delegation_grant_id: string | null;
  provider_app_id: string | null;
  provider_app_display_name: string | null;
  connected_account_id: string | null;
  connected_account_display_name: string | null;
  decision: string;
  reason: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ConnectionProbeResult = {
  ok: boolean;
  status: string;
  connected_account_id: string;
  provider_app_key: string;
  checked_at: string;
  refreshed: boolean;
  message: string | null;
  external_user_id: string | null;
  external_user_name: string | null;
};

export type MiroRelayAccess = {
  ok: boolean;
  connected_account_id: string;
  profile_id: string;
  mcp_url: string;
  has_relay_token: boolean;
  relay_token: string | null;
  mcp_config_json: string | null;
  credentials_bundle_json: string | null;
  connection_status: string;
  display_name: string | null;
  external_email: string | null;
};

export type AuditEventOut = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  metadata_json: string;
  created_at: string;
};

export type ProviderInstanceFormValues = {
  id?: string;
  key: string;
  display_name: string;
  provider_definition_key: string;
  role: string;
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  tenant_id: string;
  is_enabled: boolean;
};

export type ProviderAppFormValues = {
  id?: string;
  provider_instance_key: string;
  key: string;
  template_key: string;
  display_name: string;
  client_id: string;
  client_secret: string;
  redirect_uris_text: string;
  default_scopes_text: string;
  scope_ceiling_text: string;
  access_mode: string;
  allow_relay: boolean;
  allow_direct_token_return: boolean;
  relay_protocol: string;
  is_enabled: boolean;
};

export type ConnectedAccountFormValues = {
  user_email: string;
  provider_app_key: string;
  external_account_ref: string;
  external_email: string;
  display_name: string;
  consented_scopes_text: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
  refresh_expires_at: string;
};

export type ServiceClientFormValues = {
  key: string;
  display_name: string;
  environment: string;
  allowed_provider_app_keys: string[];
};

export type DelegationGrantFormValues = {
  user_email: string;
  service_client_key: string;
  provider_app_key: string;
  connected_account_id: string;
  allowed_access_modes: string[];
  scope_ceiling_text: string;
  environment: string;
  expires_in_hours: number;
  capabilities_text: string;
};

export type SelfServiceDelegationGrantFormValues = {
  service_client_key: string;
  provider_app_key: string;
  connected_account_id: string;
  allowed_access_modes: string[];
  scope_ceiling_text: string;
  environment: string;
  expires_in_hours: number;
  capabilities_text: string;
};

export type RouteMatch =
  | { name: "login"; path: "/login" }
  | { name: "dashboard"; path: "/app" }
  | { name: "providers"; path: "/app/providers" }
  | { name: "connections"; path: "/app/connections" }
  | { name: "serviceClients"; path: "/app/service-clients" }
  | { name: "delegation"; path: "/app/delegation" }
  | { name: "audit"; path: "/app/audit" }
  | { name: "workspace"; path: "/workspace" }
  | { name: "grants"; path: "/grants" }
  | { name: "connect"; path: `/connect/${string}`; params: { providerKey: string } }
  | { name: "tokenAccess"; path: "/token-access" }
  | { name: "notFound"; path: string };

export type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
};
