"""
BA project files CRUD.
Upload, read, delete files from BA workspace via gateway API.
"""

from __future__ import annotations

import base64

import httpx

BA_GATEWAY_URL = "https://ba-ai.sankuai.com"


async def upload_file(
    project_id: str,
    filename: str,
    content: bytes,
    sso_token: str,
) -> dict:
    """
    Upload a file to BA workspace.
    Excel files are base64-encoded; CSV files use UTF-8.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "csv"
    encoding = "base64" if ext in ("xlsx", "xls") else "utf-8"
    encoded = base64.b64encode(content).decode("utf-8") if encoding == "base64" else content.decode("utf-8")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{BA_GATEWAY_URL}/fde/api/gateway/projects/{project_id}/files",
            json={
                "filename": filename,
                "content": encoded,
                "encoding": encoding,
            },
            headers={"X-SSO-Token": sso_token},
        )
        resp.raise_for_status()
        return resp.json()


async def read_file(
    project_id: str,
    filename: str,
    sso_token: str,
) -> bytes:
    """Read a file from BA workspace. Returns raw bytes."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BA_GATEWAY_URL}/fde/api/gateway/projects/{project_id}/files",
            params={"path": filename},
            headers={"X-SSO-Token": sso_token},
        )
        resp.raise_for_status()
        data = resp.json()
        content = data.get("content", "")
        encoding = data.get("encoding", "utf-8")
        if encoding == "base64":
            return base64.b64decode(content)
        return content.encode("utf-8")


async def delete_file(
    project_id: str,
    filename: str,
    sso_token: str,
) -> bool:
    """Delete a file from BA workspace. Idempotent."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.delete(
            f"{BA_GATEWAY_URL}/fde/api/gateway/projects/{project_id}/files",
            params={"filename": filename},
            headers={"X-SSO-Token": sso_token},
        )
        return resp.status_code in (200, 204, 404)
