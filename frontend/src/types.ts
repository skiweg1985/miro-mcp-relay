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
};

export type IntegrationToolV2Out = {
  id: string;
  name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  visible: boolean;
  allowed: boolean;
};

export type RouteMatch =
  | { name: "login"; path: "/login" }
  | { name: "workspaceIntegrationsV2"; path: "/workspace/integrations-v2" }
  | { name: "notFound"; path: string };

export type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
};
