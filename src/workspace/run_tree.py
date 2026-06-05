"""
Build the file tree (logical view) for a given run.
Returns a list of { section, label, nodes } dicts for frontend consumption.
"""

from __future__ import annotations

from .contracts import (
    FileTreeNode,
    FileTreeResponse,
    InputFileEntry,
    LiveArtifactManifest,
    SkillEntry,
    StaticArtifactEntry,
)


def build_run_tree(
    run_id: str,
    inputs: list[InputFileEntry],
    data_files: list[str],
    live_artifacts: list[LiveArtifactManifest],
    static_artifacts: list[StaticArtifactEntry],
    skills: list[SkillEntry],
) -> FileTreeResponse:
    sections: list[dict] = []

    # Input files
    if inputs:
        nodes = []
        for f in inputs:
            nodes.append(
                FileTreeNode(
                    name=f.filename,
                    section="input",
                    kind=f.kind,
                    logical_path=f"runs/{run_id}/input/{f.filename}",
                    physical_path=f.physical_path,
                    run_id=run_id,
                    synced=True,
                    open_behavior="preview",
                ).model_dump()
            )
        sections.append({"section": "input", "label": "输入文件", "nodes": nodes})

    # Data files
    if data_files:
        nodes = []
        for name in data_files:
            nodes.append(
                FileTreeNode(
                    name=name,
                    section="data",
                    kind="json",
                    logical_path=f"runs/{run_id}/data/{name}",
                    physical_path=f"state/run_{run_id}__data_{name}",
                    run_id=run_id,
                    synced=True,
                    open_behavior="preview",
                ).model_dump()
            )
        sections.append({"section": "data", "label": "工作数据", "nodes": nodes})

    # Live artifacts
    if live_artifacts:
        nodes = []
        for a in live_artifacts:
            nodes.append(
                FileTreeNode(
                    name=a.title,
                    section="artifact",
                    kind=a.renderer,
                    logical_path=f"runs/{run_id}/artifact/live/{a.artifact_id}",
                    physical_path="",
                    run_id=run_id,
                    synced=True,
                    open_behavior="open_in_canvas",
                ).model_dump()
            )
        sections.append({"section": "artifact", "label": "工作产物", "nodes": nodes})

    # Static artifacts
    if static_artifacts:
        static_nodes = []
        for a in static_artifacts:
            static_nodes.append(
                FileTreeNode(
                    name=a.name,
                    section="artifact",
                    kind="static",
                    logical_path=f"runs/{run_id}/artifact/static/{a.name}",
                    physical_path=a.path,
                    run_id=run_id,
                    synced=True,
                    open_behavior="download_or_preview",
                ).model_dump()
            )
        sections.append({"section": "static", "label": "静态产物", "nodes": static_nodes})

    # Skills
    if skills:
        skill_nodes = []
        for s in skills:
            skill_nodes.append(
                FileTreeNode(
                    name=s.name or s.skill_id,
                    section="skills",
                    kind="skill",
                    logical_path="",
                    physical_path="",
                    run_id=run_id,
                    synced=(s.sync_status == "synced"),
                    open_behavior="manage_skill",
                ).model_dump()
            )
        sections.append({"section": "skills", "label": "技能", "nodes": skill_nodes})

    return FileTreeResponse(run_id=run_id, sections=sections)
