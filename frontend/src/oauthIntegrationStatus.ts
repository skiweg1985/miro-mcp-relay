import { TEMPLATE_MIRO } from "./admin/constants";
import type { ProviderAppOut, ProviderInstanceOut } from "./types";

export type OAuthInstanceLike = {
  authorization_endpoint?: string | null;
  token_endpoint?: string | null;
  settings?: Record<string, unknown>;
};

export function oauthInstanceFieldsFromApp(app: ProviderAppOut): OAuthInstanceLike {
  return {
    authorization_endpoint: app.oauth_authorization_endpoint,
    token_endpoint: app.oauth_token_endpoint,
    settings: app.oauth_instance_settings ?? {},
  };
}

export function integrationNeedsTenantForStatus(templateKey: string | null): boolean {
  if (templateKey === TEMPLATE_MIRO || templateKey === null) return false;
  return true;
}

export function oauthIntegrationConfigured(
  app: ProviderAppOut,
  instance: OAuthInstanceLike | ProviderInstanceOut | undefined,
  options?: { needsTenant?: boolean },
): { ok: boolean; reason: string | null } {
  const needsTenant = options?.needsTenant ?? integrationNeedsTenantForStatus(app.template_key);
  const inst = instance ?? oauthInstanceFieldsFromApp(app);
  const settings = (inst.settings ?? app.oauth_instance_settings ?? {}) as Record<string, unknown>;
  const tenantOk =
    !needsTenant || Boolean((settings.tenant_id as string | undefined)?.toString().trim());
  const authz = String(inst.authorization_endpoint ?? app.oauth_authorization_endpoint ?? "").trim();
  const tok = String(inst.token_endpoint ?? app.oauth_token_endpoint ?? "").trim();
  const pkce = Boolean((settings as { use_pkce?: boolean }).use_pkce);
  if (!tenantOk) {
    return { ok: false, reason: "Directory (tenant) not set" };
  }
  if (!String(app.client_id ?? "").trim()) {
    return { ok: false, reason: "Client ID missing" };
  }
  if (!authz) {
    return { ok: false, reason: "Authorize URL missing" };
  }
  if (!tok) {
    return { ok: false, reason: "Token URL missing" };
  }
  if (!app.has_client_secret && !pkce) {
    return { ok: false, reason: "Client secret or PKCE required" };
  }
  return { ok: true, reason: null };
}

export function integrationCardStatus(
  app: ProviderAppOut,
  instance: OAuthInstanceLike | ProviderInstanceOut | undefined,
  needsTenant: boolean,
): { label: string; tone: "neutral" | "success" | "warn" | "danger" } {
  if (!app) return { label: "Not configured", tone: "neutral" };
  const cfg = oauthIntegrationConfigured(app, instance, { needsTenant });
  if (!cfg.ok) return { label: "Not configured", tone: "neutral" };
  const instanceEnabled =
    instance && typeof (instance as ProviderInstanceOut).is_enabled === "boolean"
      ? (instance as ProviderInstanceOut).is_enabled
      : true;
  if (!app.is_enabled || !instanceEnabled) {
    return { label: "Disabled", tone: "danger" };
  }
  return { label: "Active", tone: "success" };
}
