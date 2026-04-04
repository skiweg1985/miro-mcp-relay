import type { ConnectionAccessDetails, MiroRelayAccess } from "./types";

function keySectionFromMiro(m: MiroRelayAccess): ConnectionAccessDetails["key_section"] {
  if (m.relay_token) {
    return { status: "ready", label: "Connection key", masked_hint: null, plaintext: m.relay_token };
  }
  if (m.has_relay_token) {
    return { status: "stored", label: "Connection key", masked_hint: "••••••••", plaintext: null };
  }
  return { status: "none", label: "Connection key", masked_hint: null, plaintext: null };
}

/** Maps a legacy Miro access payload to the generic connection access shape (e.g. after setup exchange). */
export function connectionAccessDetailsFromMiroLegacy(m: MiroRelayAccess): ConnectionAccessDetails {
  const accountLabel = m.display_name || m.external_email || m.connected_account_id;
  const extra: ConnectionAccessDetails["extra_blocks"] = [];
  if (m.mcp_config_json?.trim()) {
    extra.push({
      title: "App configuration (JSON)",
      body: "Paste this into your app settings to use this connection from your tool.",
      value: m.mcp_config_json,
    });
  }
  if (m.credentials_bundle_json?.trim()) {
    extra.push({
      title: "Combined setup (JSON)",
      body: "Workspace ID, endpoint, and key in one block for apps that accept a single paste.",
      value: m.credentials_bundle_json,
    });
  }
  const summaryBits = [m.display_name, m.external_email].filter(Boolean) as string[];
  const st = m.connection_status;
  const connection_status_label =
    st === "connected" ? "Connected" : st === "revoked" ? "Disconnected" : st || null;
  return {
    ok: true,
    supported: true,
    connected_account_id: m.connected_account_id,
    provider_app_key: "",
    provider_display_name: null,
    connection_type_label: "App connection",
    section_title: "Connection details",
    connection_summary: summaryBits.length ? summaryBits.join(" · ") : null,
    connection_status_label,
    rows: [
      { label: "Account", value: accountLabel },
      { label: "Workspace", value: m.profile_id, monospace: true },
      { label: "Endpoint", value: m.mcp_url, monospace: true, copyable: true },
    ],
    key_section: keySectionFromMiro(m),
    extra_blocks: extra,
    can_rotate: true,
    manage_path: "/workspace/integrations",
  };
}
