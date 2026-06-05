"""
State file I/O wrapper.
Read/write JSON/text files in BA workspace state/ and artifacts/ directories.
Uses project_files API under the hood.
"""

from __future__ import annotations

import json
from typing import Any

from .project_files import read_file, upload_file


async def read_state_json(
    project_id: str,
    path: str,
    sso_token: str,
) -> dict | list:
    """Read a state JSON file and return parsed JSON."""
    raw = await read_file(project_id, path, sso_token)
    return json.loads(raw.decode("utf-8"))


async def write_state_json(
    project_id: str,
    path: str,
    data: dict | list,
    sso_token: str,
) -> dict:
    """Write JSON data to a state file."""
    content = json.dumps(data, ensure_ascii=False, indent=2)
    return await upload_file(project_id, path, content.encode("utf-8"), sso_token)


async def read_text_file(
    project_id: str,
    path: str,
    sso_token: str,
) -> str:
    """Read a text file (non-JSON) from workspace."""
    raw = await read_file(project_id, path, sso_token)
    return raw.decode("utf-8")


async def write_text_file(
    project_id: str,
    path: str,
    content: str,
    sso_token: str,
) -> dict:
    """Write text content to a file."""
    return await upload_file(project_id, path, content.encode("utf-8"), sso_token)
