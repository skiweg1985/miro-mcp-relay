import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { Card, EmptyState, Field, LoadingScreen, PageIntro, StatusBadge } from "../components";
import { useAppContext } from "../app-context";
import { isApiError } from "../errors";
import type { BrokerCallbackUrls, ProviderAppOut, ProviderInstanceOut } from "../types";
import { ReadOnlyCopyField, SetupDrawer, SummaryRow, type WizardStep } from "./SetupDrawer";
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
    title: "Custom provider",
    description: "Another OAuth 2.0 provider.",
    templateKey: "",
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
  if (!app.is_enabled || !instance.is_enabled) return { label: "Disabled", tone: "danger" };
  return { label: "Active", tone: "success" };
}

function cardMeta(app: ProviderAppOut | undefined, instance: ProviderInstanceOut | undefined, needsTenant: boolean): string {
  if (!app || !instance) return "No application record yet.";
  const st = statusLabel(app, instance, needsTenant);
  if (st.label === "Not configured") return "Complete setup to enable this integration.";
  const tid = (instance.settings as { tenant_id?: string })?.tenant_id;
  if (needsTenant && tid) return `Directory: ${tid === "common" ? "Multi-tenant" : tid}`;
  if (app.client_id?.trim()) return "Client ID on file.";
  return st.label;
}

export function IntegrationsPage() {
  const { notify, session } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<BrokerCallbackUrls | null>(null);
  const [instances, setInstances] = useState<ProviderInstanceOut[]>([]);
  const [apps, setApps] = useState<ProviderAppOut[]>([]);
  const [modal, setModal] = useState<ModalId>(null);
  const [wizardStep, setWizardStep] = useState(0);
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

  const closeDrawer = () => {
    setModal(null);
    setWizardStep(0);
  };

  const openEditor = (id: EditorId) => {
    setWizardStep(0);
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

  const saveCustom = async () => {
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
      notify({ tone: "success", title: "Integration created", description: "It is available for access rules and user connections." });
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
      notify({ tone: "error", title: "Name required", description: "Enter an integration name." });
      return;
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

  if (loading || !urls) {
    return <LoadingScreen label="Loading integrations…" />;
  }

  return (
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
                <span className="integration-card-cta">Add</span>
              </button>
            );
          }
          const app = findAppByTemplate(apps, card.templateKey);
          const instance = app ? instanceById[app.provider_instance_id] : undefined;
          const needsTenant = card.templateKey !== TEMPLATE_MIRO;
          const st = statusLabel(app, instance, needsTenant);
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
                  onClick={() => openEditor(card.id as "ms-login" | "ms-graph" | "miro")}
                >
                  Configure
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
      </div>

      <Card title="Registered apps">
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
          <EmptyState title="No integrations" body="Add a provider from the cards above." />
        )}
      </Card>

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
          title="Custom OAuth app"
          subtitle="Register a generic OAuth 2.0 provider for relayed access."
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
                    {pending ? "Creating…" : "Create integration"}
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
              </>
            ) : null}
            {wizardStep === 1 ? (
              <>
                <Field label="Client ID">
                  <input value={customClientId} onChange={(e) => setCustomClientId(e.target.value)} />
                </Field>
                <div className="field">
                  <label className="check-option">
                    <input type="checkbox" checked={customPkce} onChange={(e) => setCustomPkce(e.target.checked)} />
                    <span>Use PKCE (no client secret)</span>
                  </label>
                </div>
                {!customPkce ? (
                  <Field label="Client secret">
                    <input type="password" value={customSecret} onChange={(e) => setCustomSecret(e.target.value)} autoComplete="new-password" />
                  </Field>
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
                <Field label="Scopes">
                  <input value={customScopes} onChange={(e) => setCustomScopes(e.target.value)} placeholder="space-separated" />
                </Field>
                <button type="button" className="ghost-button advanced-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
                  User info endpoint
                </button>
                {advancedOpen ? (
                  <Field label="User info URL" hint="Optional.">
                    <input value={customUserinfo} onChange={(e) => setCustomUserinfo(e.target.value)} />
                  </Field>
                ) : null}
              </>
            ) : null}
            {wizardStep === 3 ? (
              <>
                <ReadOnlyCopyField label="Redirect URI" value={urls.custom_oauth} />
                <div className="summary-panel">
                  <SummaryRow label="Name" value={customName.trim() || "—"} />
                  <SummaryRow label="Provider" value={customProvider.trim() || customName.trim() || "—"} />
                  <SummaryRow label="PKCE" value={customPkce ? "Yes" : "No"} />
                  <SummaryRow label="Authorize URL" value={customAuthUrl.trim() || "—"} />
                  <SummaryRow label="Token URL" value={customTokenUrl.trim() || "—"} />
                </div>
              </>
            ) : null}
          </div>
        </SetupDrawer>
      ) : null}
    </>
  );
}
