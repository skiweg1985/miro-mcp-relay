import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AppProvider, useAppContext } from "./app-context";
import { ThemeToggle } from "./theme-toggle";
import { api } from "./api";
import { Card, Field, LoadingScreen, PageIntro, ToastViewport } from "./components";
import { BrokerAccessPage } from "./BrokerAccessPage";
import { IntegrationsV2Page } from "./IntegrationsV2Page";
import { MicrosoftOAuthAdminPage } from "./MicrosoftOAuthAdminPage";
import { isApiError } from "./errors";
import type { RouteMatch } from "./types";
import { matchesRoute, replaceLegacyAdminPath } from "./utils";

function usePathname() {
  const [route, setRoute] = useState<RouteMatch>(() => matchesRoute(window.location.pathname));

  useEffect(() => {
    const canonical = replaceLegacyAdminPath(window.location.pathname);
    if (canonical) {
      window.history.replaceState({}, "", canonical);
      startTransition(() => {
        setRoute(matchesRoute(canonical));
      });
    }
  }, []);

  useEffect(() => {
    const handle = () => {
      startTransition(() => {
        setRoute(matchesRoute(window.location.pathname));
      });
    };
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, []);

  const navigate = (path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, "", path);
    startTransition(() => {
      setRoute(matchesRoute(path));
    });
  };

  return { route, navigate };
}

function NavLink({
  currentPath,
  href,
  label,
  onNavigate,
}: {
  currentPath: string;
  href: string;
  label: string;
  onNavigate: (path: string) => void;
}) {
  const active = currentPath === href;
  return (
    <button type="button" className={active ? "nav-link active" : "nav-link"} onClick={() => onNavigate(href)}>
      {label}
    </button>
  );
}

function LoginPage({ onSuccess }: { onSuccess: (path: string) => void }) {
  const { login, notify } = useAppContext();
  const adminUsernameRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [microsoftPending, setMicrosoftPending] = useState(false);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);

  useEffect(() => {
    void api
      .loginOptions()
      .then((result) => {
        setMicrosoftEnabled(result.microsoft_enabled);
      })
      .catch(() => {
        setMicrosoftEnabled(false);
      });
  }, []);

  useEffect(() => {
    if (!adminModalOpen) return;
    const id = window.setTimeout(() => {
      adminUsernameRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [adminModalOpen]);

  useEffect(() => {
    if (!adminModalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAdminModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminModalOpen]);

  const closeAdminModal = () => {
    setPassword("");
    setAdminModalOpen(false);
  };

  const handleAdminSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      await login(email, password);
      closeAdminModal();
      onSuccess("/workspace/integrations-v2");
    } catch (error) {
      notify({
        tone: "error",
        title: "Sign-in failed",
        description: isApiError(error) ? error.message : "Unexpected login error.",
      });
    } finally {
      setPending(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setMicrosoftPending(true);
    try {
      const result = await api.startMicrosoftLogin();
      window.location.assign(result.auth_url);
    } catch (error) {
      setMicrosoftPending(false);
      notify({
        tone: "error",
        title: "Microsoft sign-in unavailable",
        description: isApiError(error) ? error.message : "Unexpected Microsoft login error.",
      });
    }
  };

  return (
    <>
      <main className="landing">
        <div className="landing-inner">
          <h1 className="landing-title">Sign in</h1>
          <p className="landing-sub">Use your work account to continue.</p>
          <div className="landing-cta-wrap">
            <button
              type="button"
              className="primary-button landing-cta"
              disabled={microsoftPending || !microsoftEnabled}
              aria-busy={microsoftPending}
              onClick={() => void handleMicrosoftLogin()}
            >
              {microsoftPending ? "Redirecting…" : "Log in"}
            </button>
          </div>
          {!microsoftEnabled ? <p className="landing-hint">Sign-in is not configured for this deployment.</p> : null}
          <ThemeToggle className="landing-theme-toggle" id="landing-theme" />
          <button type="button" className="landing-admin" onClick={() => setAdminModalOpen(true)}>
            Admin sign-in
          </button>
        </div>
      </main>

      {adminModalOpen ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="landing-admin-login-title">
          <button type="button" className="modal-backdrop" aria-label="Dismiss" onClick={closeAdminModal} />
          <div className="modal-panel landing-admin-modal">
            <div className="modal-panel-header">
              <h2 id="landing-admin-login-title">Admin sign-in</h2>
            </div>
            <div className="modal-panel-body">
              <form className="landing-modal-form" onSubmit={handleAdminSubmit}>
                <Field label="Username">
                  <input
                    ref={adminUsernameRef}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    name="username"
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field label="Password">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <div className="landing-modal-actions">
                  <button type="button" className="ghost-button" onClick={closeAdminModal}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button" disabled={pending}>
                    {pending ? "Signing in…" : "Sign in"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Shell({
  currentPath,
  navItems,
  onNavigate,
  children,
  title,
  subtitle,
}: {
  currentPath: string;
  navItems: Array<{ href: string; label: string }>;
  onNavigate: (path: string) => void;
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  const { logout, session } = useAppContext();

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-kicker">{subtitle}</span>
          <strong>{title}</strong>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink key={item.href} currentPath={currentPath} href={item.href} label={item.label} onNavigate={onNavigate} />
          ))}
        </nav>

        <div className="sidebar-foot">
          <ThemeToggle id="shell-theme" />
          <div className="session-panel">
            <strong>{session.status === "authenticated" ? session.user.display_name : "Guest"}</strong>
            <span>{session.status === "authenticated" ? session.user.email : "—"}</span>
          </div>
          <button type="button" className="ghost-button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="page-shell">{children}</main>
    </div>
  );
}

function AuthenticatedApp() {
  const { route, navigate } = usePathname();
  const { session } = useAppContext();

  const isAdmin = session.status === "authenticated" && session.user.is_admin;
  const workspaceNav = useMemo(() => {
    const base = [
      { href: "/workspace/integrations-v2", label: "Integrations" },
      { href: "/workspace/broker-access", label: "Access" },
    ];
    if (isAdmin) {
      base.push({ href: "/workspace/admin/microsoft-oauth", label: "Microsoft sign-in" });
    }
    return base;
  }, [isAdmin]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const allowed =
      route.name === "workspaceIntegrationsV2" ||
      route.name === "workspaceBrokerAccess" ||
      (route.name === "workspaceAdminMicrosoftOAuth" && session.user.is_admin);
    if (!allowed) {
      navigate("/workspace/integrations-v2");
    }
  }, [navigate, route.name, session]);

  if (session.status === "booting") {
    return <LoadingScreen label="Restoring your session…" />;
  }

  if (session.status === "anonymous") {
    return <LoginPage onSuccess={navigate} />;
  }

  if (route.name === "workspaceAdminMicrosoftOAuth" && !isAdmin) {
    return <LoadingScreen label="Redirecting…" />;
  }

  if (
    route.name !== "workspaceIntegrationsV2" &&
    route.name !== "workspaceBrokerAccess" &&
    !(route.name === "workspaceAdminMicrosoftOAuth" && isAdmin)
  ) {
    return <LoadingScreen label="Redirecting to integrations..." />;
  }

  return (
    <Shell
      currentPath={route.path}
      navItems={workspaceNav}
      onNavigate={navigate}
      title="Workspace"
      subtitle="Integration Platform"
    >
      {route.name === "workspaceBrokerAccess" ? (
        <BrokerAccessPage />
      ) : route.name === "workspaceAdminMicrosoftOAuth" && isAdmin ? (
        <MicrosoftOAuthAdminPage />
      ) : (
        <IntegrationsV2Page />
      )}
    </Shell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AuthenticatedApp />
      <ToastViewport />
    </AppProvider>
  );
}
