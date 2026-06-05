"""
SSO token management.
Handles MOA (MeiTuan OA) SSO exchange for internal network auth.
"""

from __future__ import annotations

import os

import httpx


async def moa_local_exchange(sso_cookie: str) -> str:
    """
    Exchange SSO cookie for a short-lived API token.
    Calls internal MOA SSO endpoint.
    """
    sso_endpoint = os.environ.get("SSO_EXCHANGE_URL", "")
    if not sso_endpoint:
        return ""

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            sso_endpoint,
            json={"cookie": sso_cookie},
        )
        if resp.status_code == 200:
            return resp.json().get("token", "")
        return ""


def get_sso_from_request_headers(
    cookie_header: str | None = None,
    sso_token_header: str | None = None,
) -> str:
    """Extract SSO token from HTTP request headers."""
    if sso_token_header:
        return sso_token_header
    if cookie_header:
        cookies = dict(
            pair.strip().split("=", 1)
            for pair in cookie_header.split(";")
            if "=" in pair
        )
        return cookies.get("ssoid", "")
    return os.environ.get("SSO_TOKEN", "")
