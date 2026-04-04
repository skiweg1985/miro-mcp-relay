from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import ConnectedAccount, ProviderApp, TokenMaterial
from app.provider_templates import MIRO_RELAY_TEMPLATE, MICROSOFT_GRAPH_DIRECT_TEMPLATE, provider_app_matches_template
from app.relay_config import effective_allowed_connection_types, effective_relay_config
from app.schemas import AccessCredentialKeyOut, AccessDetailRowOut, ConnectionAccessDetailsOut


def connection_supports_access_credentials(provider_app: ProviderApp) -> bool:
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        return True
    if provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE):
        types = set(effective_allowed_connection_types(provider_app))
        return bool(types & {"direct_token", "relay"})
    return False


def build_connection_access_details(
    *,
    db: Session,
    provider_app: ProviderApp,
    connection: ConnectedAccount,
) -> ConnectionAccessDetailsOut:
    if not connection_supports_access_credentials(provider_app):
        return ConnectionAccessDetailsOut(
            supported=False,
            connected_account_id=connection.id,
            provider_app_key=provider_app.key,
            provider_display_name=provider_app.display_name,
        )
    if provider_app_matches_template(provider_app, MIRO_RELAY_TEMPLATE):
        return _miro_broker_connection_access_details(provider_app, connection)
    if provider_app_matches_template(provider_app, MICROSOFT_GRAPH_DIRECT_TEMPLATE):
        return _microsoft_graph_payload_to_connection_access_details(db, provider_app, connection)
    return ConnectionAccessDetailsOut(
        supported=False,
        connected_account_id=connection.id,
        provider_app_key=provider_app.key,
        provider_display_name=provider_app.display_name,
    )


def _miro_broker_connection_access_details(
    provider_app: ProviderApp,
    connection: ConnectedAccount,
) -> ConnectionAccessDetailsOut:
    settings = get_settings()
    broker_base = settings.broker_public_base_url.rstrip("/")
    api_prefix = settings.api_v1_prefix.strip()
    if not api_prefix.startswith("/"):
        api_prefix = "/" + api_prefix
    relay_url = f"{broker_base}{api_prefix}/broker-proxy/miro/{connection.id}"

    account_label = connection.display_name or connection.external_email or connection.id
    rows: list[AccessDetailRowOut] = [
        AccessDetailRowOut(label="Account", value=str(account_label) if account_label else None),
        AccessDetailRowOut(label="Relay endpoint", value=relay_url, monospace=True, copyable=True),
        AccessDetailRowOut(
            label="Authentication",
            value="Delegation grant access key (Access section on this page).",
        ),
    ]

    summary_bits = [str(x) for x in (connection.display_name, connection.external_email) if x]
    connection_summary = " · ".join(summary_bits) if summary_bits else None

    status_raw = str(connection.status or "")
    if status_raw == "connected":
        status_label = "Connected"
    elif status_raw == "revoked":
        status_label = "Disconnected"
    else:
        status_label = status_raw or None

    return ConnectionAccessDetailsOut(
        supported=True,
        connected_account_id=connection.id,
        provider_app_key=provider_app.key,
        provider_display_name=provider_app.display_name,
        connection_type_label="App connection",
        section_title="Connection details",
        connection_summary=connection_summary,
        connection_status_label=status_label,
        rows=rows,
        key_section=None,
        extra_blocks=[],
        can_rotate=False,
        manage_path="/workspace/integrations",
    )


def _microsoft_graph_payload_to_connection_access_details(
    db: Session,
    provider_app: ProviderApp,
    connection: ConnectedAccount,
) -> ConnectionAccessDetailsOut:
    types = effective_allowed_connection_types(provider_app)
    allowed = set(types) & {"direct_token", "relay"}
    if not allowed:
        return ConnectionAccessDetailsOut(
            supported=False,
            connected_account_id=connection.id,
            provider_app_key=provider_app.key,
            provider_display_name=provider_app.display_name,
        )

    cfg = effective_relay_config(provider_app)
    settings = get_settings()
    broker_base = settings.broker_public_base_url.rstrip("/")
    api_prefix = settings.api_v1_prefix.strip()
    if not api_prefix.startswith("/"):
        api_prefix = "/" + api_prefix

    token_material = db.scalar(select(TokenMaterial).where(TokenMaterial.connected_account_id == connection.id))
    has_access = bool(token_material and token_material.encrypted_access_token)

    type_labels: list[str] = []
    if "direct_token" in allowed:
        type_labels.append("Direct")
    if "relay" in allowed:
        type_labels.append("Relay")
    access_type_line = ", ".join(type_labels)

    account_label = connection.display_name or connection.external_email or connection.id
    rows: list[AccessDetailRowOut] = [
        AccessDetailRowOut(label="Account", value=str(account_label) if account_label else None),
        AccessDetailRowOut(label="Access type", value=access_type_line),
    ]

    upstream = (cfg.upstream_base_url or "").strip() or "https://graph.microsoft.com"
    upstream = upstream.rstrip("/")

    if "direct_token" in allowed:
        rows.append(AccessDetailRowOut(label="Endpoint", value=upstream, monospace=True, copyable=True))
        rows.append(
            AccessDetailRowOut(
                label="Access request",
                value=f"{broker_base}{api_prefix}/token-issues/provider-access",
                monospace=True,
                copyable=True,
            )
        )
    elif "relay" in allowed:
        rows.append(AccessDetailRowOut(label="Endpoint", value=upstream, monospace=True, copyable=True))

    if has_access:
        key_status = "stored"
        masked = "••••••••"
        plaintext = None
    else:
        key_status = "none"
        masked = None
        plaintext = None

    key_section = AccessCredentialKeyOut(
        status=key_status,
        label="OAuth token",
        masked_hint=masked,
        plaintext=plaintext,
    )

    summary_bits = [str(x) for x in (connection.display_name, connection.external_email) if x]
    connection_summary = " · ".join(summary_bits) if summary_bits else None

    status_raw = str(connection.status or "")
    if status_raw == "connected":
        status_label = "Connected"
    elif status_raw == "revoked":
        status_label = "Disconnected"
    else:
        status_label = status_raw or None

    return ConnectionAccessDetailsOut(
        supported=True,
        connected_account_id=connection.id,
        provider_app_key=provider_app.key,
        provider_display_name=provider_app.display_name,
        connection_type_label="App connection",
        section_title="Connection details",
        connection_summary=connection_summary,
        connection_status_label=status_label,
        rows=rows,
        key_section=key_section,
        extra_blocks=[],
        can_rotate=False,
        manage_path="/workspace/integrations",
    )
