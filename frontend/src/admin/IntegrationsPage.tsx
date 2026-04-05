import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { Card, ConfirmModal, EmptyState, Field, LoadingScreen, PageIntro, StatusBadge } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import { integrationCardStatus, oauthIntegrationConfigured } from "../oauthIntegrationStatus";
import type {
  BrokerCallbackUrls,
  ConnectedAccountOut,
  IntegrationDeleteConflictDetail,
  ProviderAppOut,
  ProviderInstanceOut,
  TokenIssueEventOut,
} from "../types";
import {
  IntegrationOverview,
  buildOverviewHealth,
  buildOverviewStats,
  integrationLastUpdated,
} from "./IntegrationOverview";
import { ReadOnlyCopyField, SetupDrawer, SummaryRow, type WizardStep } from "./SetupDrawer";
import {
  GRAPH_CLAIM_OPTIONS,
  TEMPLATE_MIRO,
  TEMPLATE_MS_GRAPH,
  TEMPLATE_MS_LOGIN,
  PROVIDER_DEFINITION_GENERIC_OAUTH,
  type GraphClaimId,
  findAppByTemplate,
  graphClaimsToScopes,
  scopesToGraphClaims,
  slugKey,
} from "./constants";

type ModalId = "ms-login" | "ms-graph" | "miro" | "custom" | null;
type EditorId = "ms-login" | "ms-graph" | "miro" | "custom";

const STEPS_MS_LOGIN: WizardStep[] = [
  { id: "azure", label: "Azure application" },
  { id: "redirect", label: "Redirect URI" },
  { id: "review", label: "Review" },
];

const STEPS_MS_GRAPH: WizardStep[] = [
  { id: "azure", label: "Azure application" },
  { id: "permissions", label: "Permissions" },
  { id: "redirect", label: "Redirect URI" },
  { id: "review", label: "Review" },
];

const STEPS_MIRO: WizardStep[] = [
  { id: "app", label: "Application" },
  { id: "redirect", label: "Redirect URI" },
  { id: "review", label: "Review" },
];

const STEPS_CUSTOM: WizardStep[] = [
  { id: "names", label: "Integration" },
  { id: "client", label: "Client" },
  { id: "endpoints", label: "Endpoints" },
  { id: "review", label: "Review" },
];

function describeIntegrationDeleteConflict(detail: unknown): string {
  if (typeof detail !== "object" || detail === null) {
    return "Die Integration ist noch in Benutzung.";
  }
  const d = detail as Partial<IntegrationDeleteConflictDetail>;
  const g = d.active_delegation_grants ?? 0;
  const c = d.active_connected_accounts ?? 0;
  const p = d.pending_oauth_flows ?? 0;
  const parts: string[] = [];
  if (g > 0) parts.push(`${g} aktive Zugriffsregel${g === 1 ? "" : "n"}`);
  if (c > 0) parts.push(`${c} aktive Verbindung${c === 1 ? "" : "en"}`);
  if (p > 0) parts.push(`${p} offene OAuth-Anmeldung${p === 1 ? "" : "en"}`);
  if (parts.length) return `Noch aktiv: ${parts.join(", ")}.`;
  return typeof d.message === "string" ? d.message : "Die Integration ist noch in Benutzung.";
}

type CardModel = {
  id: string;
  title: string;
  description: string;
  templateKey: string;
};

const CARDS: CardModel[] = [
  {
    id: "ms-login",
    title: "Microsoft sign-in",
    description: "Work or school accounts for signing in.",
    templateKey: TEMPLATE_MS_LOGIN,
  },
  {
    id: "ms-graph",
    title: "Microsoft Graph",
    description: "Mail, calendar, and directory for linked accounts.",
    templateKey: TEMPLATE_MS_GRAPH,
  },
  {
    id: "miro",
    title: "Miro",
    description: "Boards and collaboration.",
    templateKey: TEMPLATE_MIRO,
  },
  {
    id: "add",
    title: "Custom integration",
    description: "Another sign-in provider with authorize and exchange URLs.",
    templateKey: "",
  },
];

function defaultConnectionTypesForTemplate(templateKey: string): string[] {
  if (templateKey === TEMPLATE_MIRO) return ["relay"];
  if (templateKey === TEMPLATE_MS_GRAPH) return ["direct_token", "relay"];
  return ["direct_token"];
}

function customAccessFields(connectionTypes: string[]) {
  const allowRelay = connectionTypes.includes("relay");
  const allowDirect = connectionTypes.includes("direct_token");
  let accessMode = "relay";
  if (allowRelay && allowDirect) accessMode = "hybrid";
  else if (allowDirect) accessMode = "direct_token";
  else if (allowRelay) accessMode = "relay";
  return { allowRelay, allowDirect, accessMode };
}

function mergeCustomRelayConfig(
  existing: Record<string, unknown>,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const up = draft.upstream_base_url;
  const upstream =
    typeof up === "string" ? (up.trim() || undefined) : existing.upstream_base_url;
  return {
    ...existing,
    relay_type: typeof draft.relay_type === "string" ? draft.relay_type : existing.relay_type,
    token_transport: typeof draft.token_transport === "string" ? draft.token_transport : existing.token_transport,
    upstream_base_url: upstream,
  };
}

function cardMeta(app: ProviderAppOut | undefined, instance: ProviderInstanceOut | undefined, needsTenant: boolean): string {
  if (!app || !instance) return "No application record yet.";
  const st = integrationCardStatus(app, instance, needsTenant);
  if (st.label === "Not configured") {
    const r = oauthIntegrationConfigured(app, instance, { needsTenant });
    return r.reason ?? "Complete setup to enable this integration.";
  }
  const tid = (instance.settings as { tenant_id?: string })?.tenant_id;
  if (needsTenant && tid) {
    if (tid === "common") return "Directory: multi-tenant";
    return "Directory: single tenant";
  }
  if (app.client_id?.trim()) return "App settings saved.";
  return st.label;
}

function appToTemplateEditorKey(app: ProviderAppOut): EditorId | null {
  if (app.template_key === TEMPLATE_MS_LOGIN) return "ms-login";
  if (app.template_key === TEMPLATE_MS_GRAPH) return "ms-graph";
  if (app.template_key === TEMPLATE_MIRO) return "miro";
  return null;
}

export function IntegrationsPage({
  navigate,
  detailAppId,
}: {
  navigate: (path: string) => void;
  detailAppId: string | null;
}) {
  const { notify, session } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<BrokerCallbackUrls | null>(null);
  const [instances, setInstances] = useState<ProviderInstanceOut[]>([]);
  const [apps, setApps] = useState<ProviderAppOut[]>([]);
  const [connections, setConnections] = useState<ConnectedAccountOut[]>([]);
  const [tokenIssues, setTokenIssues] = useState<TokenIssueEventOut[]>([]);
  const [modal, setModal] = useState<ModalId>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [customEditAppId, setCustomEditAppId] = useState<string | null>(null);
  const [removeConfirmApp, setRemoveConfirmApp] = useState<ProviderAppOut | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeRevokeDependencies, setRemoveRevokeDependencies] = useState(false);

  const [tenant, setTenant] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [graphClaims, setGraphClaims] = useState<Set<GraphClaimId>>(() => new Set());

  const [customName, setCustomName] = useState("");
  const [customProvider, setCustomProvider] = useState("");
  const [customAuthUrl, setCustomAuthUrl] = useState("");
  const [customTokenUrl, setCustomTokenUrl] = useState("");
  const [customScopes, setCustomScopes] = useState("");
  const [customUserinfo, setCustomUserinfo] = useState("");
  const [customPkce, setCustomPkce] = useState(false);
  const [customClientId, setCustomClientId] = useState("");
  const [customSecret, setCustomSecret] = useState("");
  const [customIssuer, setCustomIssuer] = useState("");
  const [customScopeCeiling, setCustomScopeCeiling] = useState("");
  const [customIntegrationEnabled, setCustomIntegrationEnabled] = useState(true);
  const [customRelayProtocol, setCustomRelayProtocol] = useState("mcp_streamable_http");
  const [connectionTypes, setConnectionTypes] = useState<string[]>(["relay"]);
  const [relayDraft, setRelayDraft] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (session.status !== "authenticated") return;
    const [urlData, instData, appData, connData, issuesData] = await Promise.all([
      api.brokerCallbackUrls(),
      api.providerInstances(session.csrfToken),
      api.providerApps(session.csrfToken),
      api.connectedAccounts(session.csrfToken),
      api.adminTokenIssues(session.csrfToken, { limit: 400 }),
    ]);
    setUrls(urlData);
    setInstances(instData);
    setApps(appData);
    setConnections(connData);
    setTokenIssues(issuesData);
  }, [session]);

  const confirmRemoveCustomIntegration = useCallback(async () => {
    if (session.status !== "authenticated" || !removeConfirmApp) return;
    const removedId = removeConfirmApp.id;
    const fromDetail = detailAppId === removedId;
    setRemoveBusy(true);
    try {
      await api.deleteProviderApp(session.csrfToken, removedId, { force: removeRevokeDependencies });
      notify({ tone: "success", title: "Integration entfernt" });
      setRemoveConfirmApp(null);
      setRemoveRevokeDependencies(false);
      if (fromDetail) {
        navigate("/app/integrations");
      }
      await load();
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        notify({ tone: "error", title: "Entfernen nicht möglich", description: describeIntegrationDeleteConflict(e.detail) });
      } else if (isApiError(e)) {
        notify({ tone: "error", title: "Entfernen fehlgeschlagen", description: e.message });
      } else {
        notify({ tone: "error", title: "Entfernen fehlgeschlagen", description: "Unerwarteter Fehler." });
      }
    } finally {
      setRemoveBusy(false);
    }
  }, [session, removeConfirmApp, removeRevokeDependencies, detailAppId, navigate, load, notify]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((error) => {
        notify({
          tone: "error",
          title: "Could not load integrations",
          description: isApiError(error) ? error.message : "Unexpected error.",
        });
      })
      .finally(() => setLoading(false));
  }, [load, notify]);

  const instanceById = useMemo(() => Object.fromEntries(instances.map((i) => [i.id, i])), [instances]);

  const closeDrawer = () => {
    setModal(null);
    setWizardStep(0);
    setCustomEditAppId(null);
  };

  const toggleConnectionType = (mode: string) => {
    setConnectionTypes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  };

  const openCustomEdit = (app: ProviderAppOut) => {
    const instance = instanceById[app.provider_instance_id];
    if (!instance) return;
    setWizardStep(0);
    setCustomEditAppId(app.id);
    setCustomName(app.display_name);
    setCustomProvider(instance.display_name);
    setCustomAuthUrl(instance.authorization_endpoint ?? "");
    setCustomTokenUrl(instance.token_endpoint ?? "");
    setCustomScopes((app.default_scopes ?? []).join(" "));
    setCustomScopeCeiling((app.scope_ceiling ?? []).join(" "));
    setCustomUserinfo(instance.userinfo_endpoint ?? "");
    setCustomIssuer(instance.issuer ?? "");
    setCustomPkce(Boolean((instance.settings as { use_pkce?: boolean }).use_pkce));
    setCustomClientId(app.client_id ?? "");
    setCustomSecret("");
    setCustomIntegrationEnabled(Boolean(app.is_enabled && instance.is_enabled));
    setCustomRelayProtocol(app.relay_protocol ?? "mcp_streamable_http");
    const rc = (app.relay_config as Record<string, unknown>) || {};
    setRelayDraft({
      upstream_base_url: typeof rc.upstream_base_url === "string" ? rc.upstream_base_url : "",
      relay_type: typeof rc.relay_type === "string" ? rc.relay_type : "generic_http",
      token_transport: typeof rc.token_transport === "string" ? rc.token_transport : "authorization_bearer",
    });
    setConnectionTypes(app.allowed_connection_types?.length ? [...app.allowed_connection_types] : ["relay"]);
    setModal("custom");
  };

  const openEditor = (id: EditorId) => {
    setWizardStep(0);
    if (id === "custom") {
      setCustomEditAppId(null);
      setCustomName("");
      setCustomProvider("");
      setCustomAuthUrl("");
      setCustomTokenUrl("");
      setCustomScopes("openid profile email");
      setCustomScopeCeiling("");
      setCustomIssuer("");
      setCustomUserinfo("");
      setCustomPkce(false);
      setCustomClientId("");
      setCustomSecret("");
      setCustomIntegrationEnabled(true);
      setCustomRelayProtocol("mcp_streamable_http");
      setRelayDraft({
        upstream_base_url: "",
        relay_type: "generic_http",
        token_transport: "authorization_bearer",
      });
      setConnectionTypes(["relay"]);
      setModal("custom");
      return;
    }
    const templateKey = id === "ms-login" ? TEMPLATE_MS_LOGIN : id === "ms-graph" ? TEMPLATE_MS_GRAPH : TEMPLATE_MIRO;
    const app = findAppByTemplate(apps, templateKey);
    const instance = app ? instanceById[app.provider_instance_id] : undefined;
    const tid = (instance?.settings as { tenant_id?: string })?.tenant_id ?? "";
    setTenant(typeof tid === "string" ? tid : "");
    setClientId(app?.client_id ?? "");
    setClientSecret("");
    if (app && templateKey === TEMPLATE_MS_GRAPH) {
      setGraphClaims(scopesToGraphClaims(app.default_scopes));
    } else {
      setGraphClaims(new Set());
    }
    const rc = (app?.relay_config as Record<string, unknown>) || {};
    setRelayDraft({
      upstream_base_url: typeof rc.upstream_base_url === "string" ? rc.upstream_base_url : "",
      relay_type:
        typeof rc.relay_type === "string"
          ? rc.relay_type
          : templateKey === TEMPLATE_MIRO
            ? "streamable_http"
            : "rest_proxy",
      token_transport: typeof rc.token_transport === "string" ? rc.token_transport : "authorization_bearer",
    });
    setConnectionTypes(
      app?.allowed_connection_types?.length ? app.allowed_connection_types : defaultConnectionTypesForTemplate(templateKey),
    );
    setModal(id);
  };

  const saveMicrosoft = async (templateKey: typeof TEMPLATE_MS_LOGIN | typeof TEMPLATE_MS_GRAPH) => {
    if (session.status !== "authenticated" || !urls) return;
    const app = findAppByTemplate(apps, templateKey);
    if (!app) {
      notify({ tone: "error", title: "Integration not found", description: "Reload the page or contact support." });
      return;
    }
    const instance = instanceById[app.provider_instance_id];
    if (!instance) return;
    setPending(true);
    try {
      const redirect = templateKey === TEMPLATE_MS_LOGIN ? urls.microsoft_login : urls.microsoft_graph;
      const defaultScopes =
        templateKey === TEMPLATE_MS_LOGIN ? ["openid", "profile", "email"] : graphClaimsToScopes(graphClaims);
      const ceiling =
        templateKey === TEMPLATE_MS_LOGIN
          ? ["openid", "profile", "email"]
          : [...defaultScopes, "Mail.Read", "Calendars.Read", "Files.Read"];

      await api.updateProviderInstance(session.csrfToken, instance.id, {
        display_name: instance.display_name,
        role: instance.role,
        issuer: instance.issuer,
        authorization_endpoint: instance.authorization_endpoint,
        token_endpoint: instance.token_endpoint,
        userinfo_endpoint: instance.userinfo_endpoint,
        settings: { tenant_id: tenant.trim() || "common" },
        is_enabled: instance.is_enabled,
      });

      await api.updateProviderApp(session.csrfToken, app.id, {
        display_name: app.display_name,
        template_key: app.template_key,
        client_id: clientId.trim() || null,
        client_secret: clientSecret.trim() || null,
        redirect_uris: [redirect],
        default_scopes: defaultScopes,
        scope_ceiling: ceiling,
        access_mode: app.access_mode,
        allow_relay: app.allow_relay,
        allow_direct_token_return: app.allow_direct_token_return,
        relay_protocol: app.relay_protocol,
        allowed_connection_types: connectionTypes,
        relay_config: {
          relay_type: relayDraft.relay_type,
          upstream_base_url: relayDraft.upstream_base_url || undefined,
          token_transport: relayDraft.token_transport,
        },
        is_enabled: app.is_enabled,
      });

      notify({ tone: "success", title: "Settings saved", description: "The integration was updated." });
      closeDrawer();
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Save failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const saveMiro = async () => {
    if (session.status !== "authenticated" || !urls) return;
    const app = findAppByTemplate(apps, TEMPLATE_MIRO);
    if (!app) return;
    const instance = instanceById[app.provider_instance_id];
    if (!instance) return;
    setPending(true);
    try {
      await api.updateProviderApp(session.csrfToken, app.id, {
        display_name: app.display_name,
        template_key: app.template_key,
        client_id: clientId.trim() || null,
        client_secret: clientSecret.trim() || null,
        redirect_uris: [urls.miro],
        default_scopes: app.default_scopes,
        scope_ceiling: app.scope_ceiling,
        access_mode: app.access_mode,
        allow_relay: app.allow_relay,
        allow_direct_token_return: app.allow_direct_token_return,
        relay_protocol: app.relay_protocol,
        allowed_connection_types: connectionTypes,
        relay_config: {
          relay_type: relayDraft.relay_type,
          upstream_base_url: relayDraft.upstream_base_url || undefined,
          token_transport: relayDraft.token_transport,
        },
        is_enabled: app.is_enabled,
      });
      notify({ tone: "success", title: "Settings saved", description: "Miro was updated." });
      closeDrawer();
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Save failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const toggleIntegrationEnabled = async (app: ProviderAppOut, instance: ProviderInstanceOut) => {
    if (session.status !== "authenticated") return;
    const next = !(app.is_enabled && instance.is_enabled);
    setToggling(true);
    try {
      await api.updateProviderInstance(session.csrfToken, instance.id, {
        display_name: instance.display_name,
        role: instance.role,
        issuer: instance.issuer,
        authorization_endpoint: instance.authorization_endpoint,
        token_endpoint: instance.token_endpoint,
        userinfo_endpoint: instance.userinfo_endpoint,
        settings: instance.settings,
        is_enabled: next,
      });
      await api.updateProviderApp(session.csrfToken, app.id, {
        display_name: app.display_name,
        template_key: app.template_key,
        client_id: app.client_id,
        client_secret: null,
        redirect_uris: app.redirect_uris,
        default_scopes: app.default_scopes,
        scope_ceiling: app.scope_ceiling,
        access_mode: app.access_mode,
        allow_relay: app.allow_relay,
        allow_direct_token_return: app.allow_direct_token_return,
        relay_protocol: app.relay_protocol,
        allowed_connection_types: app.allowed_connection_types,
        relay_config: app.relay_config,
        is_enabled: next,
      });
      notify({
        tone: "success",
        title: next ? "Integration enabled" : "Integration disabled",
        description: next ? "Users can connect using this integration." : "New connections are blocked for this integration.",
      });
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Update failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setToggling(false);
    }
  };

  const saveCustom = async () => {
    if (session.status !== "authenticated" || !urls) return;
    const name = customName.trim();
    const authUrl = customAuthUrl.trim();
    const tokenUrl = customTokenUrl.trim();
    const clientIdVal = customClientId.trim();
    if (!name) {
      notify({ tone: "error", title: "Display name required", description: "Enter a name for this integration." });
      return;
    }
    if (!clientIdVal) {
      notify({ tone: "error", title: "Client ID required", description: "Enter the OAuth client ID." });
      return;
    }
    if (!authUrl) {
      notify({ tone: "error", title: "Authorize URL required", description: "Enter the authorization endpoint URL." });
      return;
    }
    if (!tokenUrl) {
      notify({ tone: "error", title: "Token URL required", description: "Enter the token endpoint URL." });
      return;
    }
    if (!connectionTypes.length) {
      notify({
        tone: "error",
        title: "Connection type required",
        description: "Select at least one of: Direct connection, Relay through broker.",
      });
      return;
    }
    const editingId = customEditAppId;
    const existingApp = editingId ? apps.find((a) => a.id === editingId) : undefined;
    if (!customPkce && !customSecret.trim() && !(editingId && existingApp?.has_client_secret)) {
      notify({
        tone: "error",
        title: "Client secret required",
        description: "Enter a new client secret or enable PKCE. PKCE allows saving without a stored secret.",
      });
      return;
    }
    const scopes = customScopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const ceilingRaw = customScopeCeiling.trim();
    const ceiling = ceilingRaw ? ceilingRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : scopes;
    const { allowRelay, allowDirect, accessMode } = customAccessFields(connectionTypes);
    let issuerResolved = customIssuer.trim();
    if (!issuerResolved) {
      try {
        issuerResolved = new URL(authUrl).origin;
      } catch {
        issuerResolved = "";
      }
    }
    const baseRelay = (existingApp?.relay_config ?? {}) as Record<string, unknown>;
    const mergedRelay = mergeCustomRelayConfig(baseRelay, relayDraft as Record<string, unknown>);

    if (editingId && existingApp) {
      const inst = instanceById[existingApp.provider_instance_id];
      if (!inst) return;
      setPending(true);
      try {
        const prevSettings = { ...(inst.settings as Record<string, unknown>) };
        const nextSettings = { ...prevSettings, use_pkce: customPkce };
        await api.updateProviderInstance(session.csrfToken, inst.id, {
          display_name: customProvider.trim() || name,
          role: inst.role,
          issuer: issuerResolved || null,
          authorization_endpoint: authUrl,
          token_endpoint: tokenUrl,
          userinfo_endpoint: customUserinfo.trim() || null,
          settings: nextSettings,
          is_enabled: customIntegrationEnabled,
        });
        await api.updateProviderApp(session.csrfToken, existingApp.id, {
          display_name: name,
          template_key: null,
          client_id: clientIdVal || null,
          client_secret: customPkce ? null : customSecret.trim() || null,
          clear_client_secret: customPkce,
          redirect_uris: existingApp.redirect_uris,
          default_scopes: scopes,
          scope_ceiling: ceiling,
          access_mode: accessMode,
          allow_relay: allowRelay,
          allow_direct_token_return: allowDirect,
          relay_protocol: customRelayProtocol || null,
          allowed_connection_types: connectionTypes,
          relay_config: mergedRelay,
          is_enabled: customIntegrationEnabled,
        });
        notify({ tone: "success", title: "Integration updated", description: "Changes were saved." });
        closeDrawer();
        await load();
      } catch (error) {
        notify({
          tone: "error",
          title: "Could not save integration",
          description: isApiError(error) ? error.message : "Unexpected error.",
        });
      } finally {
        setPending(false);
      }
      return;
    }
    setPending(true);
    try {
      const slug = slugKey(name);
      const instanceKey = `${slug}-oauth`;
      const appKey = `${slug}-app`;
      let issuer = issuerResolved;
      if (!issuer) {
        try {
          issuer = new URL(authUrl).origin;
        } catch {
          issuer = "";
        }
      }
      await api.createProviderInstance(session.csrfToken, {
        key: instanceKey,
        display_name: customProvider.trim() || name,
        provider_definition_key: PROVIDER_DEFINITION_GENERIC_OAUTH,
        role: "downstream_oauth",
        issuer: issuer || null,
        authorization_endpoint: authUrl,
        token_endpoint: tokenUrl,
        userinfo_endpoint: customUserinfo.trim() || null,
        settings: { use_pkce: customPkce },
        is_enabled: customIntegrationEnabled,
      });
      await api.createProviderApp(session.csrfToken, {
        provider_instance_key: instanceKey,
        key: appKey,
        template_key: null,
        display_name: name,
        client_id: clientIdVal || null,
        client_secret: customPkce ? null : customSecret.trim(),
        redirect_uris: [urls.custom_oauth],
        default_scopes: scopes,
        scope_ceiling: ceiling,
        access_mode: accessMode,
        allow_relay: allowRelay,
        allow_direct_token_return: allowDirect,
        relay_protocol: customRelayProtocol || null,
        allowed_connection_types: connectionTypes,
        relay_config: mergeCustomRelayConfig({}, relayDraft as Record<string, unknown>),
        is_enabled: customIntegrationEnabled,
      });
      notify({
        tone: "success",
        title: "Integration created",
        description: "It is available for access rules and user connections.",
      });
      closeDrawer();
      await load();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create integration",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setPending(false);
    }
  };

  const runTest = async (templateKey: string) => {
    if (session.status !== "authenticated") return;
    setTesting(templateKey);
    try {
      const result = await api.testIntegration(session.csrfToken, templateKey);
      notify({
        tone: result.ok ? "success" : "error",
        title: result.ok ? "Connection check succeeded" : "Connection check failed",
        description: result.message,
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Connection check failed",
        description: isApiError(error) ? error.message : "Unexpected error.",
      });
    } finally {
      setTesting(null);
    }
  };

  const toggleClaim = (id: GraphClaimId) => {
    setGraphClaims((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const goNextMsLogin = () => {
    if (wizardStep >= STEPS_MS_LOGIN.length - 1) return;
    setWizardStep((s) => s + 1);
  };

  const goNextMsGraph = () => {
    if (wizardStep >= STEPS_MS_GRAPH.length - 1) return;
    setWizardStep((s) => s + 1);
  };

  const goNextMiro = () => {
    if (wizardStep >= STEPS_MIRO.length - 1) return;
    setWizardStep((s) => s + 1);
  };

  const goNextCustom = () => {
    if (wizardStep === 0 && !customName.trim()) {
      notify({ tone: "error", title: "Name required", description: "Enter a display name." });
      return;
    }
    if (wizardStep === 1) {
      if (!customClientId.trim()) {
        notify({ tone: "error", title: "Client ID required", description: "Enter the OAuth client ID." });
        return;
      }
      if (!connectionTypes.length) {
        notify({
          tone: "error",
          title: "Connection type required",
          description: "Select Direct connection and/or Relay through broker.",
        });
        return;
      }
    }
    if (wizardStep === 2) {
      if (!customAuthUrl.trim() || !customTokenUrl.trim()) {
        notify({ tone: "error", title: "URLs required", description: "Authorize URL and token URL are required." });
        return;
      }
    }
    if (wizardStep >= STEPS_CUSTOM.length - 1) return;
    setWizardStep((s) => s + 1);
  };

  const lastMsLogin = wizardStep === STEPS_MS_LOGIN.length - 1;
  const lastMsGraph = wizardStep === STEPS_MS_GRAPH.length - 1;
  const lastMiro = wizardStep === STEPS_MIRO.length - 1;
  const lastCustom = wizardStep === STEPS_CUSTOM.length - 1;

  const customApps = useMemo(() => apps.filter((a) => a.template_key === null), [apps]);

  const detailApp = detailAppId ? apps.find((a) => a.id === detailAppId) : undefined;
  const detailInstance = detailApp ? instanceById[detailApp.provider_instance_id] : undefined;

  if (loading || !urls) {
    return <LoadingScreen label="Loading integrations…" />;
  }

  const detailTestKey =
    detailApp?.template_key === TEMPLATE_MS_LOGIN ||
    detailApp?.template_key === TEMPLATE_MS_GRAPH ||
    detailApp?.template_key === TEMPLATE_MIRO
      ? detailApp.template_key
      : null;

  return (
    <>
      {detailAppId ? (
        detailApp && detailInstance ? (
          <IntegrationOverview
            app={detailApp}
            instance={detailInstance}
            urls={urls}
            statusLabel={integrationCardStatus(detailApp, detailInstance, detailApp.template_key !== TEMPLATE_MIRO).label}
            needsTenant={detailApp.template_key !== TEMPLATE_MIRO}
            stats={buildOverviewStats(detailApp.id, connections, tokenIssues)}
            health={buildOverviewHealth(connections.filter((c) => c.provider_app_id === detailApp.id))}
            lastUpdated={integrationLastUpdated(detailApp, connections, tokenIssues)}
            onBack={() => navigate("/app/integrations")}
            onEdit={() => {
              const ed = appToTemplateEditorKey(detailApp);
              if (ed) openEditor(ed);
              else openCustomEdit(detailApp);
            }}
            onTest={() => {
              if (detailTestKey) void runTest(detailTestKey);
            }}
            onToggleEnabled={() => void toggleIntegrationEnabled(detailApp, detailInstance)}
            onRemove={
              detailApp.template_key === null
                ? () => {
                    setRemoveRevokeDependencies(false);
                    setRemoveConfirmApp(detailApp);
                  }
                : undefined
            }
            removing={removeBusy && removeConfirmApp?.id === detailApp.id}
            testing={Boolean(detailTestKey && testing === detailTestKey)}
            toggling={toggling}
            testAvailable={Boolean(detailTestKey)}
          />
        ) : (
          <>
            <PageIntro title="Integrations" description="Sign-in and third-party services for this deployment." />
            <Card title="Integration">
              <EmptyState title="Not found" body="This integration does not exist or was removed." />
              <div className="integration-detail-toolbar integration-detail-toolbar--after-empty">
                <button type="button" className="primary-button" onClick={() => navigate("/app/integrations")}>
                  Back to list
                </button>
              </div>
            </Card>
          </>
        )
      ) : (
        <>
          <PageIntro title="Integrations" description="Sign-in and third-party services for this deployment." />

          <div className="integration-grid">
            {CARDS.map((card) => {
              if (card.id === "add") {
                return (
                  <button
                    key={card.id}
                    type="button"
                    className="integration-card integration-card-add"
                    onClick={() => openEditor("custom")}
                  >
                    <span className="integration-card-head">
                      <span className="integration-card-title">{card.title}</span>
                    </span>
                    <span className="integration-card-body">
                      <span className="integration-card-desc">{card.description}</span>
                    </span>
                    <div className="integration-card-actions">
                      <span className="secondary-button">Add</span>
                    </div>
                  </button>
                );
              }
              const app = findAppByTemplate(apps, card.templateKey);
              const instance = app ? instanceById[app.provider_instance_id] : undefined;
              const needsTenant = card.templateKey !== TEMPLATE_MIRO;
              const st =
                app && instance
                  ? integrationCardStatus(app, instance, needsTenant)
                  : { label: "Not configured", tone: "neutral" as const };
              const hasRecord = Boolean(app);
              return (
                <article key={card.id} className="integration-card">
                  <div className="integration-card-head">
                    <span className="integration-card-title">{card.title}</span>
                    <StatusBadge tone={st.tone === "success" ? "success" : st.tone === "danger" ? "danger" : "neutral"}>
                      {st.label}
                    </StatusBadge>
                  </div>
                  <div className="integration-card-body">
                    <p className="integration-card-desc">{card.description}</p>
                    <p className="integration-card-meta">{cardMeta(app, instance, needsTenant)}</p>
                  </div>
                  <div className="integration-card-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        hasRecord && app ? navigate(`/app/integrations/${app.id}`) : openEditor(card.id as "ms-login" | "ms-graph" | "miro")
                      }
                    >
                      {hasRecord ? "Open" : "Set up"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={testing === card.templateKey}
                      onClick={() => void runTest(card.templateKey)}
                    >
                      {testing === card.templateKey ? "Testing…" : "Test connection"}
                    </button>
                  </div>
                </article>
              );
            })}
            {customApps.map((app) => {
              const instance = instanceById[app.provider_instance_id];
              const st = integrationCardStatus(app, instance, false);
              return (
                <article key={app.id} className="integration-card">
                  <div className="integration-card-head">
                    <span className="integration-card-title">{app.display_name}</span>
                    <StatusBadge tone={st.tone === "success" ? "success" : st.tone === "danger" ? "danger" : "neutral"}>
                      {st.label}
                    </StatusBadge>
                  </div>
                  <div className="integration-card-body">
                    <p className="integration-card-desc">Custom OAuth integration.</p>
                    <p className="integration-card-meta">{instance ? "OAuth endpoints configured." : "Instance missing."}</p>
                  </div>
                  <div className="integration-card-actions">
                    <button type="button" className="primary-button" onClick={() => navigate(`/app/integrations/${app.id}`)}>
                      Open
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={removeBusy && removeConfirmApp?.id === app.id}
                      onClick={() => {
                        setRemoveRevokeDependencies(false);
                        setRemoveConfirmApp(app);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {modal === "ms-login" && urls ? (
        <SetupDrawer
          title="Microsoft sign-in"
          subtitle="Registers the Entra ID application used for sign-in to this console."
          steps={STEPS_MS_LOGIN}
          activeStepIndex={wizardStep}
          onClose={closeDrawer}
          wide
          footer={
            <div className="drawer-footer-inner">
              <div>
                {wizardStep > 0 ? (
                  <button type="button" className="secondary-button" onClick={() => setWizardStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
              </div>
              <div className="drawer-footer-actions">
                {!lastMsLogin ? (
                  <button type="button" className="primary-button" onClick={goNextMsLogin}>
                    Next
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={testing === TEMPLATE_MS_LOGIN}
                      onClick={() => void runTest(TEMPLATE_MS_LOGIN)}
                    >
                      {testing === TEMPLATE_MS_LOGIN ? "Testing…" : "Test connection"}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={pending}
                      onClick={() => void saveMicrosoft(TEMPLATE_MS_LOGIN)}
                    >
                      {pending ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
              </div>
            </div>
          }
        >
          <div className="wizard-step-body">
            {wizardStep === 0 ? (
              <>
                <Field label="Directory (tenant) ID">
                  <input
                    value={tenant}
                    onChange={(e) => setTenant(e.target.value)}
                    placeholder="common or tenant GUID"
                    autoComplete="off"
                  />
                </Field>
                <p className="field-hint">Use “common” for multi-tenant apps, or your tenant ID for a single tenant.</p>
                <Field label="Application (client) ID">
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Client secret" hint="Leave blank to keep the current secret.">
                  <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
                </Field>
                <div className="field">
                  <span className="field-label">Available connection types</span>
                  <label className="check-option">
                    <input
                      type="checkbox"
                      checked={connectionTypes.includes("direct_token")}
                      onChange={() => toggleConnectionType("direct_token")}
                    />
                    <span>Direct connection</span>
                  </label>
                  <label className="check-option">
                    <input type="checkbox" checked={connectionTypes.includes("relay")} onChange={() => toggleConnectionType("relay")} />
                    <span>Relay through broker</span>
                  </label>
                </div>
              </>
            ) : null}
            {wizardStep === 1 ? <ReadOnlyCopyField label="Redirect URI" value={urls.microsoft_login} /> : null}
            {wizardStep === 2 ? (
              <>
                <p className="field-hint field-hint--flush">
                  Confirm values before saving. Run a connection test if you changed credentials or endpoints in Entra ID.
                </p>
                <div className="summary-panel">
                  <SummaryRow label="Tenant" value={tenant.trim() || "common"} />
                  <SummaryRow label="Client ID" value={clientId.trim() || "—"} />
                  <SummaryRow label="Client secret" value={clientSecret.trim() ? "New value entered" : "Unchanged"} />
                </div>
              </>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}

      {modal === "ms-graph" && urls ? (
        <SetupDrawer
          title="Microsoft Graph"
          subtitle="Defines the app used when users connect their Microsoft 365 data."
          steps={STEPS_MS_GRAPH}
          activeStepIndex={wizardStep}
          onClose={closeDrawer}
          wide
          footer={
            <div className="drawer-footer-inner">
              <div>
                {wizardStep > 0 ? (
                  <button type="button" className="secondary-button" onClick={() => setWizardStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
              </div>
              <div className="drawer-footer-actions">
                {!lastMsGraph ? (
                  <button type="button" className="primary-button" onClick={goNextMsGraph}>
                    Next
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={testing === TEMPLATE_MS_GRAPH}
                      onClick={() => void runTest(TEMPLATE_MS_GRAPH)}
                    >
                      {testing === TEMPLATE_MS_GRAPH ? "Testing…" : "Test connection"}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={pending}
                      onClick={() => void saveMicrosoft(TEMPLATE_MS_GRAPH)}
                    >
                      {pending ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
              </div>
            </div>
          }
        >
          <div className="wizard-step-body">
            {wizardStep === 0 ? (
              <>
                <Field label="Directory (tenant) ID">
                  <input
                    value={tenant}
                    onChange={(e) => setTenant(e.target.value)}
                    placeholder="common or tenant GUID"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Application (client) ID">
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Client secret" hint="Leave blank to keep the current secret.">
                  <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
                </Field>
                <div className="field">
                  <span className="field-label">Available connection types</span>
                  <label className="check-option">
                    <input
                      type="checkbox"
                      checked={connectionTypes.includes("direct_token")}
                      onChange={() => toggleConnectionType("direct_token")}
                    />
                    <span>Direct connection</span>
                  </label>
                  <label className="check-option">
                    <input type="checkbox" checked={connectionTypes.includes("relay")} onChange={() => toggleConnectionType("relay")} />
                    <span>Relay through broker</span>
                  </label>
                </div>
                {connectionTypes.includes("relay") ? (
                  <>
                    <Field label="Relay type">
                      <select
                        value={String(relayDraft.relay_type ?? "rest_proxy")}
                        onChange={(e) => setRelayDraft((d) => ({ ...d, relay_type: e.target.value }))}
                      >
                        <option value="rest_proxy">REST proxy</option>
                        <option value="streamable_http">Streamable HTTP</option>
                        <option value="generic_http">Generic HTTP</option>
                      </select>
                    </Field>
                    <Field label="Upstream URL">
                      <input
                        value={String(relayDraft.upstream_base_url ?? "")}
                        onChange={(e) => setRelayDraft((d) => ({ ...d, upstream_base_url: e.target.value }))}
                        placeholder="https://graph.microsoft.com"
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Authorization">
                      <select
                        value={String(relayDraft.token_transport ?? "authorization_bearer")}
                        onChange={(e) => setRelayDraft((d) => ({ ...d, token_transport: e.target.value }))}
                      >
                        <option value="authorization_bearer">Bearer</option>
                        <option value="header">Header</option>
                        <option value="query">Query</option>
                      </select>
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
            {wizardStep === 1 ? (
              <div className="field">
                <span className="field-label">Claims and API access</span>
                <span className="field-hint">Select the profile and directory data this integration may request.</span>
                <div className="claim-grid">
                  {GRAPH_CLAIM_OPTIONS.map((c) => (
                    <label key={c.id} className="check-option">
                      <input type="checkbox" checked={graphClaims.has(c.id)} onChange={() => toggleClaim(c.id)} />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {wizardStep === 2 ? <ReadOnlyCopyField label="Redirect URI" value={urls.microsoft_graph} /> : null}
            {wizardStep === 3 ? (
              <>
                <p className="field-hint field-hint--flush">
                  Review scopes derived from your selection, then save or test the connection.
                </p>
                <div className="summary-panel">
                  <SummaryRow label="Tenant" value={tenant.trim() || "common"} />
                  <SummaryRow label="Client ID" value={clientId.trim() || "—"} />
                  <SummaryRow label="Scopes" value={graphClaimsToScopes(graphClaims).join(", ")} />
                </div>
              </>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}

      {modal === "miro" && urls ? (
        <SetupDrawer
          title="Miro"
          subtitle="Connects user accounts to Miro using your OAuth client."
          steps={STEPS_MIRO}
          activeStepIndex={wizardStep}
          onClose={closeDrawer}
          footer={
            <div className="drawer-footer-inner">
              <div>
                {wizardStep > 0 ? (
                  <button type="button" className="secondary-button" onClick={() => setWizardStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
              </div>
              <div className="drawer-footer-actions">
                {!lastMiro ? (
                  <button type="button" className="primary-button" onClick={goNextMiro}>
                    Next
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={testing === TEMPLATE_MIRO}
                      onClick={() => void runTest(TEMPLATE_MIRO)}
                    >
                      {testing === TEMPLATE_MIRO ? "Testing…" : "Test connection"}
                    </button>
                    <button type="button" className="primary-button" disabled={pending} onClick={() => void saveMiro()}>
                      {pending ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
              </div>
            </div>
          }
        >
          <div className="wizard-step-body">
            {wizardStep === 0 ? (
              <>
                <Field label="Client ID">
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Client secret" hint="Leave blank to keep the current secret.">
                  <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
                </Field>
                <Field label="Relay type">
                  <select
                    value={String(relayDraft.relay_type ?? "streamable_http")}
                    onChange={(e) => setRelayDraft((d) => ({ ...d, relay_type: e.target.value }))}
                  >
                    <option value="streamable_http">Streamable HTTP</option>
                    <option value="rest_proxy">REST proxy</option>
                    <option value="generic_http">Generic HTTP</option>
                  </select>
                </Field>
                <Field label="Upstream URL">
                  <input
                    value={String(relayDraft.upstream_base_url ?? "")}
                    onChange={(e) => setRelayDraft((d) => ({ ...d, upstream_base_url: e.target.value }))}
                    placeholder="https://mcp.miro.com"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Authorization">
                  <select
                    value={String(relayDraft.token_transport ?? "authorization_bearer")}
                    onChange={(e) => setRelayDraft((d) => ({ ...d, token_transport: e.target.value }))}
                  >
                    <option value="authorization_bearer">Bearer</option>
                    <option value="header">Header</option>
                    <option value="query">Query</option>
                  </select>
                </Field>
              </>
            ) : null}
            {wizardStep === 1 ? <ReadOnlyCopyField label="Redirect URI" value={urls.miro} /> : null}
            {wizardStep === 2 ? (
              <div className="summary-panel">
                <SummaryRow label="Client ID" value={clientId.trim() || "—"} />
                <SummaryRow label="Client secret" value={clientSecret.trim() ? "New value entered" : "Unchanged"} />
              </div>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}

      {modal === "custom" && urls ? (
        <SetupDrawer
          title={customEditAppId ? "Edit custom integration" : "Custom OAuth app"}
          subtitle={
            customEditAppId
              ? "Update OAuth endpoints and client settings."
              : "Register a generic OAuth 2.0 provider for relayed access."
          }
          steps={STEPS_CUSTOM}
          activeStepIndex={wizardStep}
          onClose={closeDrawer}
          wide
          footer={
            <div className="drawer-footer-inner">
              <div>
                {wizardStep > 0 ? (
                  <button type="button" className="secondary-button" onClick={() => setWizardStep((s) => s - 1)}>
                    Back
                  </button>
                ) : null}
              </div>
              <div className="drawer-footer-actions">
                {!lastCustom ? (
                  <button type="button" className="primary-button" onClick={goNextCustom}>
                    Next
                  </button>
                ) : (
                  <button type="button" className="primary-button" disabled={pending} onClick={() => void saveCustom()}>
                    {pending
                      ? customEditAppId
                        ? "Saving…"
                        : "Creating…"
                      : customEditAppId
                        ? "Save changes"
                        : "Create integration"}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="wizard-step-body">
            {wizardStep === 0 ? (
              <>
                <Field label="Display name">
                  <input value={customName} onChange={(e) => setCustomName(e.target.value)} required />
                </Field>
                <Field label="Provider name" hint="Shown in lists; optional.">
                  <input value={customProvider} onChange={(e) => setCustomProvider(e.target.value)} placeholder="Same as display name if empty" />
                </Field>
                <div className="field">
                  <label className="check-option">
                    <input
                      type="checkbox"
                      checked={customIntegrationEnabled}
                      onChange={(e) => setCustomIntegrationEnabled(e.target.checked)}
                    />
                    <span>Integration enabled</span>
                  </label>
                </div>
              </>
            ) : null}
            {wizardStep === 1 ? (
              <>
                <Field label="Client ID">
                  <input value={customClientId} onChange={(e) => setCustomClientId(e.target.value)} autoComplete="off" />
                </Field>
                <div className="field">
                  <label className="check-option">
                    <input type="checkbox" checked={customPkce} onChange={(e) => setCustomPkce(e.target.checked)} />
                    <span>Use PKCE (no client secret)</span>
                  </label>
                </div>
                {!customPkce ? (
                  <Field label="Client secret" hint="Required when PKCE is off. Leave blank when editing to keep the stored secret.">
                    <input type="password" value={customSecret} onChange={(e) => setCustomSecret(e.target.value)} autoComplete="new-password" />
                  </Field>
                ) : null}
                <div className="field">
                  <span className="field-label">Connection types</span>
                  <label className="check-option">
                    <input
                      type="checkbox"
                      checked={connectionTypes.includes("direct_token")}
                      onChange={() => toggleConnectionType("direct_token")}
                    />
                    <span>Direct connection</span>
                  </label>
                  <label className="check-option">
                    <input type="checkbox" checked={connectionTypes.includes("relay")} onChange={() => toggleConnectionType("relay")} />
                    <span>Relay through broker</span>
                  </label>
                </div>
                <Field label="Relay protocol">
                  <select value={customRelayProtocol} onChange={(e) => setCustomRelayProtocol(e.target.value)}>
                    <option value="mcp_streamable_http">MCP streamable HTTP</option>
                    <option value="rest_proxy">REST proxy</option>
                    <option value="generic_http">Generic HTTP</option>
                  </select>
                </Field>
                {connectionTypes.includes("relay") ? (
                  <>
                    <Field label="Relay type">
                      <select
                        value={String(relayDraft.relay_type ?? "generic_http")}
                        onChange={(e) => setRelayDraft((d) => ({ ...d, relay_type: e.target.value }))}
                      >
                        <option value="streamable_http">Streamable HTTP</option>
                        <option value="rest_proxy">REST proxy</option>
                        <option value="generic_http">Generic HTTP</option>
                      </select>
                    </Field>
                    <Field label="Upstream URL">
                      <input
                        value={String(relayDraft.upstream_base_url ?? "")}
                        onChange={(e) => setRelayDraft((d) => ({ ...d, upstream_base_url: e.target.value }))}
                        placeholder="https://…"
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Authorization">
                      <select
                        value={String(relayDraft.token_transport ?? "authorization_bearer")}
                        onChange={(e) => setRelayDraft((d) => ({ ...d, token_transport: e.target.value }))}
                      >
                        <option value="authorization_bearer">Bearer</option>
                        <option value="header">Header</option>
                        <option value="query">Query</option>
                      </select>
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
            {wizardStep === 2 ? (
              <>
                <Field label="Authorize URL">
                  <input value={customAuthUrl} onChange={(e) => setCustomAuthUrl(e.target.value)} required placeholder="https://…" />
                </Field>
                <Field label="Token URL">
                  <input value={customTokenUrl} onChange={(e) => setCustomTokenUrl(e.target.value)} required placeholder="https://…" />
                </Field>
                <Field label="Issuer" hint="Uses the authorize URL origin when empty.">
                  <input value={customIssuer} onChange={(e) => setCustomIssuer(e.target.value)} placeholder="https://…" autoComplete="off" />
                </Field>
                <Field label="User info URL">
                  <input value={customUserinfo} onChange={(e) => setCustomUserinfo(e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Default scopes">
                  <input value={customScopes} onChange={(e) => setCustomScopes(e.target.value)} placeholder="space-separated" />
                </Field>
                <Field label="Scope ceiling" hint="When empty, default scopes apply.">
                  <input value={customScopeCeiling} onChange={(e) => setCustomScopeCeiling(e.target.value)} placeholder="space-separated" />
                </Field>
              </>
            ) : null}
            {wizardStep === 3 ? (
              <>
                <ReadOnlyCopyField label="Redirect URI" value={urls.custom_oauth} />
                <div className="summary-panel">
                  <SummaryRow label="Name" value={customName.trim() || "—"} />
                  <SummaryRow label="Provider" value={customProvider.trim() || customName.trim() || "—"} />
                  <SummaryRow label="Enabled" value={customIntegrationEnabled ? "Yes" : "No"} />
                  <SummaryRow label="PKCE" value={customPkce ? "Yes" : "No"} />
                  <SummaryRow label="Client ID" value={customClientId.trim() || "—"} />
                  <SummaryRow
                    label="Connections"
                    value={
                      [
                        connectionTypes.includes("direct_token") ? "Direct" : null,
                        connectionTypes.includes("relay") ? "Relay" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    }
                  />
                  <SummaryRow label="Authorize URL" value={customAuthUrl.trim() || "—"} />
                  <SummaryRow label="Token URL" value={customTokenUrl.trim() || "—"} />
                  <SummaryRow label="Issuer" value={customIssuer.trim() || "(from authorize URL)"} />
                </div>
              </>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}

      {removeConfirmApp ? (
        <ConfirmModal
          title="Integration entfernen"
          confirmLabel="Entfernen"
          cancelLabel="Abbrechen"
          confirmBusy={removeBusy}
          onCancel={() => {
            if (!removeBusy) {
              setRemoveConfirmApp(null);
              setRemoveRevokeDependencies(false);
            }
          }}
          onConfirm={() => void confirmRemoveCustomIntegration()}
        >
          <p>
            Ohne die Option unten schlägt das Entfernen fehl, solange noch Zugriffsregeln, Verbindungen oder eine laufende OAuth-Anmeldung
            bestehen.
          </p>
          <label className="check-option" style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginTop: "0.75rem" }}>
            <input
              type="checkbox"
              checked={removeRevokeDependencies}
              disabled={removeBusy}
              onChange={(e) => setRemoveRevokeDependencies(e.target.checked)}
            />
            <span>Zugriffsregeln und Verbindungen automatisch widerrufen.</span>
          </label>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            <strong>{removeConfirmApp.display_name}</strong>
          </p>
        </ConfirmModal>
      ) : null}
    </>
  );
}
