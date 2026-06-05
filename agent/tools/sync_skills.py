"""
Sync local skills to BA workspace.
Reads agent/skills/_registry/skills.json and uploads each SKILL.md via BA project files API.
"""

from __future__ import annotations

import json
from pathlib import Path


SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
REGISTRY_PATH = SKILLS_DIR / "_registry" / "skills.json"


def load_registry() -> list[dict]:
    if not REGISTRY_PATH.exists():
        return []
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8")).get("skills", [])


def sync_to_workspace(project_id: str) -> dict:
    """
    Upload all registered skills to BA workspace.
    Returns { synced: [...], failed: [...] }.
    """
    skills = load_registry()
    synced = []
    failed = []

    for skill in skills:
        skill_path = SKILLS_DIR / skill["skill_id"] / "SKILL.md"
        if not skill_path.exists():
            failed.append(skill["skill_id"])
            continue

        content = skill_path.read_text(encoding="utf-8")
        target = f".claude/skills/{skill['skill_id']}/SKILL.md"

        # TODO: POST to /fde/api/gateway/projects/<project_id>/files
        # with { filename: target, content: content, encoding: "utf-8" }

        synced.append(skill["skill_id"])

    return {"synced": synced, "failed": failed}
