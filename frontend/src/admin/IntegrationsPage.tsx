import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { Card, EmptyState, Field, FormActions, LoadingScreen, PageIntro, StatusBadge } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type { BrokerCallbackUrls, ProviderAppOut, ProviderInstanceOut } from "../types";
import { classNames } from "../utils";
import {
  GRAPH_CLAIM_OPTIONS,
  TEMPLATE_MIRO,
  TEMPLATE_MS_GRAPH,
  TEMPLATE_MS_LOGIN,
  type GraphClaimId,
  findAppByTemplate,
  graphClaimsToScopes,
  scopesToGraphClaims,
  slugKey,
} from "./constants";

type ModalId = "ms-login" | "ms-graph" | "miro" | "custom" | null;
type EditorId = "ms-login" | "ms-graph" | "miro" | "custom";

type CardModel = {
  id: string;
  title: string;
  description: string;
  templateKey: string;
  tone: "microsoft" | "graph" | "miro" | "add";
};

const CARDS: CardModel[] = [
  {
    id: "ms-login",
    title: "Microsoft Login",
    description: "Sign-in for the admin console and users with Microsoft accounts.",
    templateKey: TEMPLATE_MS_LOGIN,
    tone: "microsoft",
  },
  {
    id: "ms-graph",
    title: "Microsoft Graph",
    description: "Mail, calendar, and directory access for connected users.",
    templateKey: TEMPLATE_MS_GRAPH,
    tone: "graph",
  },
  {
    id: "miro",
    title: "Miro",
    description: "Boards and collaboration for connected users.",
    templateKey: TEMPLATE_MIRO,
    tone: "miro",
  },
  {
    id: "add",
    title: "Add OAuth App",
    description: "Connect another provider using OAuth 2.0.",
    templateKey: "",
    tone: "add",
  },
];

function statusLabel(
  app: ProviderAppOut | undefined,
  instance: ProviderInstanceOut | undefined,
  needsTenant: boolean,
): { label: string; tone: "neutral" | "success" | "warn" | "danger" } {
  if (!app || !instance) return { label: "Not configured", tone: "neutral" };
  const tenantOk = !needsTenant || Boolean((instance.settings as { tenant_id?: string }).tenant_id?.toString().trim());
  const configured = Boolean(app.client_id?.trim()) && app.has_client_secret && tenantOk && instance.authorization_endpoint && instance.token_endpoint;
  if (!configured) return { label: "Not configured", tone: "neutral" };
  if (!app.is_enabled || !instance.is_enabled) return { label: "Unavailable", tone: "danger" };
  return { label: "Active", tone: "success" };
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button type="button" className="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="modal-panel">
        <header className="modal-panel-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal-panel-body">{children}</div>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const { notify, session } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<BrokerCallbackUrls | null>(null);
  const [instances, setInstances] = useState<ProviderInstanceOut[]>([]);
  const [apps, setApps] = useState<ProviderAppOut[]>([]);
  const [modal, setModal] = useState<ModalId>(null);
  const [testing, setTesting] = useState<string | null>(null);

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (session.status !== "authenticated") return;
    const [urlData, instData, appData] = await Promise.all([
      api.brokerCallbackUrls(),
      api.providerInstances(session.csrfToken),
      api.providerApps(session.csrfToken),
    ]);
    setUrls(urlData);
    setInstances(instData);
    setApps(appData);
  }, [session]);

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

  const openEditor = (id: EditorId) => {
    if (id === "custom") {
      setCustomName("");
      setCustomProvider("");
      setCustomAuthUrl("");
      setCustomTokenUrl("");
      setCustomScopes("openid profile email");
      setCustomUserinfo("");
      setCustomPkce(false);
      setCustomClientId("");
      setCustomSecret("");
      setAdvancedOpen(false);
      setModal("custom");
      return;
    }
    const templateKey =
      id === "ms-login" ? TEMPLATE_MS_LOGIN : id === "ms-graph" ? TEMPLATE_MS_GRAPH : TEMPLATE_MIRO;
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
      const redirect =
        templateKey === TEMPLATE_MS_LOGIN ? urls.microsoft_login : urls.microsoft_graph;
      const defaultScopes =
        templateKey === TEMPLATE_MS_LOGIN
          ? ["openid", "profile", "email"]
          : graphClaimsToScopes(graphClaims);
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
        is_enabled: app.is_enabled,
      });

      notify({ tone: "success", title: "Saved", description: "Integration settings were updated." });
      setModal(null);
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

  const saveMiro = async (event: FormEvent) => {
    event.preventDefault();
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
        is_enabled: app.is_enabled,
      });
      notify({ tone: "success", title: "Saved", description: "Miro integration was updated." });
      setModal(null);
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

  const saveCustom = async (event: FormEvent) => {
    event.preventDefault();
    if (session.status !== "authenticated" || !urls) return;
    const name = customName.trim();
    const authUrl = customAuthUrl.trim();
    const tokenUrl = customTokenUrl.trim();
    if (!name || !authUrl || !tokenUrl) {
      notify({ tone: "error", title: "Missing fields", description: "Name, authorize URL, and token URL are required." });
      return;
    }
    if (!customPkce && !customSecret.trim()) {
      notify({ tone: "error", title: "Client secret required", description: "Enter a client secret or enable PKCE." });
      return;
    }
    setPending(true);
    try {
      const slug = slugKey(name);
      const instanceKey = `${slug}-oauth`;
      const appKey = `${slug}-app`;
      const scopes = customScopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      let issuer = "";
      try {
        issuer = new URL(authUrl).origin;
      } catch {
        issuer = "";
      }
      await api.createProviderInstance(session.csrfToken, {
        key: instanceKey,
        display_name: customProvider.trim() || name,
        provider_definition_key: "miro",
        role: "downstream_oauth",
        issuer: issuer || null,
        authorization_endpoint: authUrl,
        token_endpoint: tokenUrl,
        userinfo_endpoint: customUserinfo.trim() || null,
        settings: customPkce ? { use_pkce: true } : {},
        is_enabled: true,
      });
      await api.createProviderApp(session.csrfToken, {
        provider_instance_key: instanceKey,
        key: appKey,
        template_key: null,
        display_name: name,
        client_id: customClientId.trim() || null,
        client_secret: customPkce ? null : customSecret.trim(),
        redirect_uris: [urls.custom_oauth],
        default_scopes: scopes,
        scope_ceiling: scopes,
        access_mode: "relay",
        allow_relay: true,
        allow_direct_token_return: false,
        relay_protocol: "mcp_streamable_http",
        is_enabled: true,
      });
      notify({ tone: "success", title: "Integration created", description: "The new app appears in the list for services and access rules." });
      setModal(null);
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
        title: result.ok ? "Connection OK" : "Connection check failed",
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

  if (loading || !urls) {
    return <LoadingScreen label="Loading integrations…" />;
  }

  return (
    <>
      <PageIntro
        eyebrow="Integrations"
        title="Cloud connections"
        description="Configure how users sign in and which external systems this workspace may access."
      />

      <div className="integration-grid">
        {CARDS.map((card) => {
          if (card.tone === "add") {
            return (
              <button
                key={card.id}
                type="button"
                className="integration-card integration-card-add"
                onClick={() => openEditor("custom")}
              >
                <span className="integration-card-title">{card.title}</span>
                <span className="integration-card-desc">{card.description}</span>
                <span className="integration-card-cta">Add</span>
              </button>
            );
          }
          const app = findAppByTemplate(apps, card.templateKey);
          const instance = app ? instanceById[app.provider_instance_id] : undefined;
          const needsTenant = card.templateKey !== TEMPLATE_MIRO;
          const st = statusLabel(app, instance, needsTenant);
          return (
            <article key={card.id} className={classNames("integration-card", `tone-${card.tone}`)}>
              <div className="integration-card-head">
                <span className="integration-card-title">{card.title}</span>
                <StatusBadge tone={st.tone === "success" ? "success" : st.tone === "danger" ? "danger" : "neutral"}>
                  {st.label}
                </StatusBadge>
              </div>
              <p className="integration-card-desc">{card.description}</p>
              <div className="integration-card-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openEditor(card.id as "ms-login" | "ms-graph" | "miro")}
                >
                  Configure
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={testing === card.templateKey}
                  onClick={() => void runTest(card.templateKey)}
                >
                  {testing === card.templateKey ? "Testing…" : "Test connection"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <Card title="Registered integrations" description="All apps available for access rules and user connections.">
        {apps.length ? (
          <ul className="integration-inline-list">
            {apps.map((a) => (
              <li key={a.id}>
                <strong>{a.display_name}</strong>
                <span className="muted">{a.key}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No integrations yet" body="Add a provider above." />
        )}
      </Card>

      {modal === "ms-login" ? (
        <Modal title="Microsoft Login" onClose={() => setModal(null)}>
          <form
            className="compact-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveMicrosoft(TEMPLATE_MS_LOGIN);
            }}
          >
            <Field label="Tenant ID">
              <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="e.g. common or your tenant GUID" autoComplete="off" />
            </Field>
            <Field label="Client ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Client secret" hint="Leave unchanged to keep the current secret.">
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Redirect URI">
              <input readOnly value={urls.microsoft_login} />
            </Field>
            <FormActions pending={pending} submitLabel="Save" />
          </form>
        </Modal>
      ) : null}

      {modal === "ms-graph" ? (
        <Modal title="Microsoft Graph" onClose={() => setModal(null)}>
          <form
            className="compact-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveMicrosoft(TEMPLATE_MS_GRAPH);
            }}
          >
            <Field label="Tenant ID">
              <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="e.g. common or your tenant GUID" autoComplete="off" />
            </Field>
            <Field label="Client ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Client secret" hint="Leave unchanged to keep the current secret.">
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
            </Field>
            <div className="field">
              <span className="field-label">Permissions</span>
              <div className="claim-grid">
                {GRAPH_CLAIM_OPTIONS.map((c) => (
                  <label key={c.id} className="check-option">
                    <input type="checkbox" checked={graphClaims.has(c.id)} onChange={() => toggleClaim(c.id)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Field label="Redirect URI">
              <input readOnly value={urls.microsoft_graph} />
            </Field>
            <FormActions pending={pending} submitLabel="Save" />
          </form>
        </Modal>
      ) : null}

      {modal === "miro" ? (
        <Modal title="Miro" onClose={() => setModal(null)}>
          <form className="compact-form" onSubmit={saveMiro}>
            <Field label="Client ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Client secret" hint="Leave unchanged to keep the current secret.">
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Redirect URI">
              <input readOnly value={urls.miro} />
            </Field>
            <FormActions pending={pending} submitLabel="Save" />
          </form>
        </Modal>
      ) : null}

      {modal === "custom" ? (
        <Modal title="Add OAuth App" onClose={() => setModal(null)}>
          <form className="compact-form" onSubmit={saveCustom}>
            <Field label="Name">
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} required />
            </Field>
            <Field label="Provider name">
              <input value={customProvider} onChange={(e) => setCustomProvider(e.target.value)} placeholder="Shown in lists" />
            </Field>
            <Field label="Client ID">
              <input value={customClientId} onChange={(e) => setCustomClientId(e.target.value)} />
            </Field>
            <div className="field">
              <label className="check-option">
                <input type="checkbox" checked={customPkce} onChange={(e) => setCustomPkce(e.target.checked)} />
                <span>Use PKCE instead of a client secret</span>
              </label>
            </div>
            {!customPkce ? (
              <Field label="Client secret">
                <input type="password" value={customSecret} onChange={(e) => setCustomSecret(e.target.value)} autoComplete="new-password" />
              </Field>
            ) : null}
            <Field label="Authorize URL">
              <input value={customAuthUrl} onChange={(e) => setCustomAuthUrl(e.target.value)} required placeholder="https://…" />
            </Field>
            <Field label="Token URL">
              <input value={customTokenUrl} onChange={(e) => setCustomTokenUrl(e.target.value)} required placeholder="https://…" />
            </Field>
            <Field label="Scopes">
              <input value={customScopes} onChange={(e) => setCustomScopes(e.target.value)} placeholder="space-separated" />
            </Field>
            <button type="button" className="ghost-button advanced-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
              Advanced settings
            </button>
            {advancedOpen ? (
              <Field label="User info endpoint">
                <input value={customUserinfo} onChange={(e) => setCustomUserinfo(e.target.value)} placeholder="Optional" />
              </Field>
            ) : null}
            <Field label="Redirect URI">
              <input readOnly value={urls.custom_oauth} />
            </Field>
            <FormActions pending={pending} submitLabel="Create integration" />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
