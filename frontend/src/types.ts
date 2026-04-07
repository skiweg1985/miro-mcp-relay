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

export type BrokerCallbackUrls = {
  ok: boolean;
  microsoft_login: string;
  integration_oauth: string;
  microsoft_graph: string;
  miro: string;
  custom_oauth: string;
};

export type IntegrationV2Out = {
  id: string;
  name: string;
  type: "mcp_server" | "oauth_provider" | "api";
  config: Record<string, unknown>;
  mcp_enabled: boolean;
  created_at: string;
  updated_at: string;
  oauth_client_secret_configured?: boolean;
  integration_oauth_callback_url?: string;
};

export type IntegrationInstanceV2Out = {
  id: string;
  name: string;
  integration_id: string;
  auth_mode: "none" | "oauth" | "api_key" | "shared_credentials";
  auth_config: Record<string, unknown>;
  access_mode: "relay" | "direct";
  access_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  oauth_connected: boolean;
};

export type UserConnectionSummaryOut = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  profile: Record<string, unknown>;
};

export type IntegrationInstanceInspectOut = {
  instance: IntegrationInstanceV2Out;
  integration: IntegrationV2Out;
  user_connection: UserConnectionSummaryOut | null;
};

export type IntegrationToolV2Out = {
  id: string;
  name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  visible: boolean;
  allowed: boolean;
};

export type AccessGrantOut = {
  id: string;
  user_id: string;
  integration_instance_id: string;
  integration_instance_name: string;
  user_connection_id: string | null;
  name: string;
  key_prefix: string;
  status: string;
  allowed_tools: string[];
  policy_ref: string | null;
  notes: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
};

export type AccessGrantCreatedResponse = {
  ok: boolean;
  grant: AccessGrantOut;
  access_key: string;
};

export type MicrosoftOAuthAdminOut = {
  ok: boolean;
  authority_base: string;
  tenant_id: string;
  client_id: string;
  scope: string;
  has_client_secret: boolean;
  effective_source: "database" | "environment" | "none";
  microsoft_login_enabled: boolean;
  redirect_uri: string;
};

export type RouteMatch =
  | { name: "login"; path: "/login" }
  | { name: "workspaceIntegrationsV2"; path: "/workspace/integrations-v2" }
  | { name: "workspaceConnections"; path: "/workspace/connections" }
  | { name: "workspaceBrokerAccess"; path: "/workspace/broker-access" }
  | { name: "workspaceAdminMicrosoftOAuth"; path: "/workspace/admin/microsoft-oauth" }
  | { name: "notFound"; path: string };

export type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
};
