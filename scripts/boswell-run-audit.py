#!/usr/bin/env python3
"""Mode-aware Boswell audit runner for boswell-saas worker."""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

from openai import OpenAI

from boswell.analyzer import (
    SONNET,
    OPENROUTER_BASE,
    _call,
    _classify_important_files,
    _read_safe,
    _summarize_folders,
)
from boswell.cli import _run_single_repo
from boswell.cost import estimate_cost
from boswell.prompts import (
    AUDIT_SYSTEM,
    HANDOFF_SYSTEM,
    audit_prompt,
    handoff_prompt,
)
from boswell.scanner import scan_repo
from boswell.secret_check import full_leak_scan
from boswell.writer import write_repo_output


def _client(api_key: str) -> OpenAI:
    return OpenAI(api_key=api_key, base_url=OPENROUTER_BASE)


def _plain_header(repo_name: str) -> str:
    return (
        f"# Plain-English summary for {repo_name}\n\n"
        "This is a shorter Boswell summary generated without extra LLM rewrite passes.\n\n"
    )


def _run_quick(repo: Path, api_key: str) -> dict:
    scan = scan_repo(repo)
    est = estimate_cost(scan)
    client = _client(api_key)

    leak_findings = full_leak_scan(scan.repo_path)
    secret_warnings = [f.description for f in leak_findings]

    important_paths = _classify_important_files(client, scan)
    augmented_key_files = dict(scan.key_file_contents)
    for rel_path in important_paths[:15]:
        if rel_path not in augmented_key_files:
            full_path = scan.repo_path / rel_path
            if full_path.exists():
                content = _read_safe(full_path)
                if content:
                    augmented_key_files[rel_path] = content

    limited_scan = copy.copy(scan)
    limited_scan.folder_files = dict(list(scan.folder_files.items())[:12])

    folder_summaries = _summarize_folders(client, limited_scan)

    audit_text = _call(
        client,
        SONNET,
        AUDIT_SYSTEM,
        audit_prompt(
            repo_name=scan.name,
            stack=scan.stack,
            env_vars=scan.env_var_keys,
            key_files=augmented_key_files,
            folder_summaries=folder_summaries,
            npm_audit=scan.npm_audit_json,
            pip_audit=scan.pip_audit_json,
            secret_warnings=secret_warnings,
            git_log=scan.git_log_summary,
        ),
        max_tokens=3000,
    )

    handoff_text = (
        "# Quick-scan handoff\n\n"
        "This quick scan skipped the full handoff document to reduce cost. "
        "Use the audit findings and fix prompt for next steps.\n"
    )

    results = {
        "audit": audit_text,
        "handoff": handoff_text,
        "audit_simple": _plain_header(scan.name) + audit_text[:6000],
        "handoff_simple": handoff_text,
        "lessons": "",
        "secret_warnings": secret_warnings,
        "leak_findings": [
            {
                "severity": f.severity,
                "category": f.category,
                "description": f.description,
                "location": f.location,
                "fix": f.fix,
            }
            for f in leak_findings
        ],
    }

    write_repo_output(repo_path=repo, results=results, scan=scan, cost_usd=est.total_usd * 0.35)
    return {"name": scan.name, "mode": "quick", "cost_usd": round(est.total_usd * 0.35, 4)}


def _run_standard(repo: Path, api_key: str) -> dict:
    scan = scan_repo(repo)
    est = estimate_cost(scan)
    client = _client(api_key)

    leak_findings = full_leak_scan(scan.repo_path)
    secret_warnings = [f.description for f in leak_findings]

    important_paths = _classify_important_files(client, scan)
    augmented_key_files = dict(scan.key_file_contents)
    for rel_path in important_paths:
        if rel_path not in augmented_key_files:
            full_path = scan.repo_path / rel_path
            if full_path.exists():
                content = _read_safe(full_path)
                if content:
                    augmented_key_files[rel_path] = content

    folder_summaries = _summarize_folders(client, scan)

    audit_text = _call(
        client,
        SONNET,
        AUDIT_SYSTEM,
        audit_prompt(
            repo_name=scan.name,
            stack=scan.stack,
            env_vars=scan.env_var_keys,
            key_files=augmented_key_files,
            folder_summaries=folder_summaries,
            npm_audit=scan.npm_audit_json,
            pip_audit=scan.pip_audit_json,
            secret_warnings=secret_warnings,
            git_log=scan.git_log_summary,
        ),
        max_tokens=4096,
    )

    handoff_text = _call(
        client,
        SONNET,
        HANDOFF_SYSTEM,
        handoff_prompt(
            repo_name=scan.name,
            stack=scan.stack,
            env_vars=scan.env_var_keys,
            key_files=augmented_key_files,
            folder_summaries=folder_summaries,
            secret_warnings=secret_warnings,
            git_log=scan.git_log_summary,
            boswell_context=scan.boswell_context,
        ),
        max_tokens=4096,
    )

    results = {
        "audit": audit_text,
        "handoff": handoff_text,
        "audit_simple": _plain_header(scan.name) + audit_text[:8000],
        "handoff_simple": _plain_header(scan.name) + handoff_text[:8000],
        "lessons": "",
        "secret_warnings": secret_warnings,
        "leak_findings": [
            {
                "severity": f.severity,
                "category": f.category,
                "description": f.description,
                "location": f.location,
                "fix": f.fix,
            }
            for f in leak_findings
        ],
    }

    write_repo_output(repo_path=repo, results=results, scan=scan, cost_usd=est.total_usd * 0.65)
    return {"name": scan.name, "mode": "standard", "cost_usd": round(est.total_usd * 0.65, 4)}


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "repo path required"}))
        return 1

    repo = Path(sys.argv[1]).resolve()
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        print(json.dumps({"ok": False, "error": "OPENROUTER_API_KEY is not set"}))
        return 1

    mode = os.environ.get("BOSWELL_AUDIT_MODE", "standard")
    min_chars = int(os.environ.get("BOSWELL_MIN_AUDIT_CHARS", "200"))

    try:
        if mode == "quick":
            result = _run_quick(repo, api_key)
        elif mode == "standard":
            result = _run_standard(repo, api_key)
        else:
            result = _run_single_repo(
                repo_path=repo,
                api_key=api_key,
                skip_confirm=True,
                prompt_context=False,
            )
            result["mode"] = "deep"
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    if result.get("error"):
        print(json.dumps({"ok": False, "error": result["error"], "result": result}))
        return 1

    audit_path = repo / ".boswell" / "audit.md"
    if not audit_path.exists():
        print(json.dumps({"ok": False, "error": "Boswell did not write .boswell/audit.md", "result": result}))
        return 1

    audit_text = audit_path.read_text(encoding="utf-8")
    if len(audit_text.strip()) < min_chars:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"audit.md too short ({len(audit_text)} chars)",
                    "result": result,
                }
            )
        )
        return 1

    print(json.dumps({"ok": True, "result": result}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
