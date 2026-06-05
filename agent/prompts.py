"""
Prompt builder — assembles system prompt + skill prompt for Agent context injection.
"""

from __future__ import annotations


def build_agent_prompt(
    run_id: str,
    input_paths: list[str],
    skill_name: str = "analysis",
    extra_context: str = "",
) -> str:
    parts = [f"Current run_id: {run_id}"]

    if input_paths:
        parts.append(f"Allowed input files: {', '.join(input_paths)}")

    parts.append(f"Active skill: {skill_name}")

    parts.append(
        "Business data paths:\n"
        f"  state/run_{run_id}__data_analysis.json\n"
        f"  state/run_{run_id}__data_cards.json\n"
        f"Artifact output prefix: artifacts/run_{run_id}__\n\n"
        "Rules:\n"
        "- Read input files from input manifest paths only\n"
        "- Do not write uploads/\n"
        "- Write business state to run data paths only\n"
        "- Write user-visible outputs to current run artifact prefix\n"
        "- Emit [[STRATEGY id=\"...\" name=\"...\" ...]] markers for strategy cards\n"
        "- Do not send full data tables in chat text"
    )

    if extra_context:
        parts.append(f"\n{extra_context}")

    return "\n".join(parts)
