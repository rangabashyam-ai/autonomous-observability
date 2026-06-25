"""
llm_client.py — LLM inference client for the RCA agent.

Calls a local vLLM/TGI-style endpoint for text generation.
Used by the engine to reason over anomaly evidence and improve
root cause identification accuracy.

Endpoint: POST http://192.168.3.221:8001/generate
Request:  {"prompt": "...", "max_tokens": N, "temperature": T}
Response: {"response": "..."}
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
import urllib.error
from typing import Any

log = logging.getLogger(__name__)

LLM_ENDPOINT = os.environ.get(
    "LLM_ENDPOINT",
    "http://192.168.3.221:8001/generate",
)

LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "30"))


def generate(
    prompt: str,
    max_tokens: int = 512,
    temperature: float = 0.1,
    timeout: int | None = None,
) -> str:
    """
    Call the LLM endpoint and return the generated text.

    Args:
        prompt: The prompt string.
        max_tokens: Maximum tokens to generate.
        temperature: Sampling temperature (lower = more deterministic).
        timeout: Request timeout in seconds (default: LLM_TIMEOUT).

    Returns:
        Generated text string.

    Raises:
        LLMError: If the request fails.
    """
    payload = {
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        LLM_ENDPOINT,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req, timeout=timeout or LLM_TIMEOUT)
        body = json.loads(resp.read().decode("utf-8"))
        return body.get("response", "")
    except urllib.error.URLError as e:
        log.warning(f"LLM request failed: {e}")
        raise LLMError(f"LLM endpoint unreachable: {e}") from e
    except Exception as e:
        log.warning(f"LLM request error: {e}")
        raise LLMError(f"LLM error: {e}") from e


class LLMError(Exception):
    """Raised when LLM inference fails."""
    pass


# ── RCA-specific prompts ────────────────────────────────────────────────────

# KPI name substring → human-readable signal type (used when grouping evidence)
_KPI_SIGNAL_LABEL: list[tuple[str, str]] = [
    ("CPULoad",       "CPU load"),
    ("CpuUtil",       "CPU util"),
    ("SingleCpu",     "CPU core util"),
    ("MemUtil",       "memory util"),
    ("SwapUtil",      "swap util"),
    ("NoCacheMem",    "free memory"),
    ("MEMFreeMem",    "free memory"),
    ("DISKRead",      "disk read I/O"),
    ("DISKWrite",     "disk write I/O"),
    ("DISKIOUtil",    "disk I/O util"),
    ("DISKDisk",      "disk space"),
    ("NETRetrans",    "network retransmit"),
    ("NETRtt",        "network RTT"),
    ("NETPacketsIn",  "network packets in"),
    ("NETPacketsOut", "network packets out"),
    ("jvm_cpu",       "JVM CPU"),
    ("jvm_oom",       "JVM OOM"),
]

def _kpi_signal_label(kpi_name: str) -> str:
    for substr, label in _KPI_SIGNAL_LABEL:
        if substr.lower() in kpi_name.lower():
            return label
    # Fallback: last segment of the KPI name
    parts = kpi_name.replace("-", "_").split("_")
    return parts[-1] if parts else kpi_name


def _group_infra_evidence(infra_evidence: list[str]) -> str:
    """
    Convert raw evidence strings to a compact per-component summary.

    Input:  "IG02 | OSLinux-CPU_CPULoad | z=5.7 | val=92.3 | ts=1614848580 | reason=high CPU usage"
    Output: grouped block per component showing top signals with z-scores.
    """
    from collections import defaultdict

    comp_signals: dict[str, list[tuple[float, int, str, str]]] = defaultdict(list)
    # (abs_z, timestamp, signal_label, reason)

    for ev in infra_evidence:
        parts = [p.strip() for p in ev.split("|")]
        if len(parts) < 6:
            continue
        comp    = parts[0]
        kpi     = parts[1]
        z_str   = parts[2].replace("z=", "").strip()
        ts_str  = parts[4].replace("ts=", "").strip()
        reason  = parts[5].replace("reason=", "").strip()
        try:
            z  = float(z_str)
            ts = int(ts_str)
        except ValueError:
            continue
        label = _kpi_signal_label(kpi) if reason in ("unknown", "") else reason
        comp_signals[comp].append((abs(z), ts, label, z_str))

    lines = []
    for comp, signals in sorted(comp_signals.items(), key=lambda x: -max(s[0] for s in x[1])):
        # Top 4 signals by |z|, deduplicated by label
        seen_labels: set[str] = set()
        top: list[str] = []
        for _, ts, label, z in sorted(signals, key=lambda s: -s[0]):
            if label not in seen_labels:
                seen_labels.add(label)
                top.append(f"{label} (z={z}, t={ts})")
            if len(top) >= 4:
                break
        lines.append(f"  {comp}: {' | '.join(top)}")

    return "\n".join(lines) if lines else "  (no infrastructure anomalies)"


_ALLOWED_REASONS = [
    "high CPU usage",
    "high memory usage",
    "network packet loss",
    "network latency",
    "high disk I/O read usage",
    "high disk space usage",
    "high JVM CPU load",
    "JVM Out of Memory (OOM) Heap",
]

_KNOWN_COMPONENTS = (
    "Tomcat01, Tomcat02, Tomcat03, Tomcat04, Mysql01, Mysql02, Redis01, Redis02, "
    "apache01, apache02, MG01, MG02, IG01, IG02, "
    "dockerA1, dockerA2, dockerB1, dockerB2, dockerB3, dockerB4"
)

_REASON_HINTS = (
    "CPU / CpuUtil / CPULoad → high CPU usage | "
    "Mem / swap / NoCacheMem / MEMFree → high memory usage | "
    "NETPacketsIn / NETPacketsOut / Retrans → network packet loss | "
    "RTT / latency / delay → network latency | "
    "DISKRead / DISKWrite / IOUtil → high disk I/O read usage | "
    "DISKDisk / DISKUtil → high disk space usage | "
    "jvm_cpu / GC CPU → high JVM CPU load | "
    "OOM / OutOfMemory → JVM Out of Memory (OOM) Heap"
)


def build_rca_prompt(
    t_start: int,
    t_end: int,
    num_failures: int,
    infra_evidence: list[str],
    app_evidence: list[str],
    log_evidence: list[str],
    candidate_components: list[str],
) -> str:
    grouped = _group_infra_evidence(infra_evidence)

    app_block = ""
    if app_evidence:
        app_lines = "\n".join(f"  - {e}" for e in app_evidence[:10])
        app_block = f"\nAPPLICATION ANOMALIES (service | MRT ms | SR %):\n{app_lines}\n"

    log_block = ""
    if log_evidence:
        log_lines = "\n".join(f"  - {e}" for e in log_evidence[:5])
        log_block = f"\nLOG EVIDENCE:\n{log_lines}\n"

    candidates_str = ", ".join(candidate_components[:5]) if candidate_components else "unknown"

    prompt = f"""\
You are an expert Site Reliability Engineer performing root cause analysis.

TIME WINDOW: {t_start} to {t_end} (Unix epoch seconds)
EXPECTED NUMBER OF ROOT CAUSES: {num_failures}

STATISTICAL ANALYSIS identified these top candidate components: {candidates_str}

INFRASTRUCTURE ANOMALIES (grouped by component, signals with z-scores):
{grouped}
{app_block}{log_block}
KPI → REASON MAPPING GUIDE (use this to pick the correct REASON):
{_REASON_HINTS}

ALLOWED REASON VALUES — copy one EXACTLY as written:
{chr(10).join(f"  - {r}" for r in _ALLOWED_REASONS)}

KNOWN COMPONENT IDs: {_KNOWN_COMPONENTS}

INSTRUCTIONS:
1. Produce exactly {num_failures} result block(s).
2. Each component must appear at most once.
3. REASON must be copied verbatim from the ALLOWED REASON VALUES list — never use KPI metric names.
4. Use the KPI mapping guide above when reason=unknown appears.
5. EXPLANATION must be one concise sentence stating what failed and why.
6. TIMESTAMP should be the earliest anomaly epoch second for that component.

OUTPUT — repeat this block exactly {num_failures} time(s), separated by ---:
COMPONENT: <component id>
TIMESTAMP: <epoch seconds>
REASON: <exact reason from allowed list>
CONFIDENCE: <0.0 to 1.0>
EXPLANATION: <one sentence: component, what failed, key evidence>
---
"""
    return prompt


def parse_rca_response(response: str) -> list[dict[str, Any]]:
    """
    Parse the LLM's structured RCA response.

    Expected per-block format:
        COMPONENT: <cmdb_id>
        TIMESTAMP: <epoch_seconds>
        REASON: <reason>
        CONFIDENCE: <float>
        EXPLANATION: <text>
        ---
    """
    results: list[dict[str, Any]] = []
    current: dict[str, Any] = {}

    for line in response.strip().split("\n"):
        line = line.strip()
        if not line or line == "---":
            if current.get("component"):
                results.append(current)
                current = {}
            continue

        if line.startswith("COMPONENT:"):
            # Start of a new block — save previous if any
            if current.get("component"):
                results.append(current)
            current = {"component": line.split(":", 1)[1].strip()}
        elif line.startswith("TIMESTAMP:"):
            try:
                current["timestamp"] = int(line.split(":", 1)[1].strip())
            except ValueError:
                current["timestamp"] = 0
        elif line.startswith("REASON:"):
            raw = line.split(":", 1)[1].strip()
            # Validate against allowed list; fall back to closest match
            if raw in _ALLOWED_REASONS:
                current["reason"] = raw
            else:
                # Try to infer from the raw string
                low = raw.lower()
                if "cpu" in low and "jvm" not in low:
                    current["reason"] = "high CPU usage"
                elif "mem" in low or "swap" in low or "oom" in low:
                    current["reason"] = "JVM Out of Memory (OOM) Heap" if "oom" in low else "high memory usage"
                elif "packet" in low or "retrans" in low or "packetsIn" in low.replace("_", "").lower():
                    current["reason"] = "network packet loss"
                elif "latency" in low or "rtt" in low or "delay" in low:
                    current["reason"] = "network latency"
                elif "disk" in low and "space" in low:
                    current["reason"] = "high disk space usage"
                elif "disk" in low or "io" in low:
                    current["reason"] = "high disk I/O read usage"
                elif "jvm" in low:
                    current["reason"] = "high JVM CPU load"
                else:
                    current["reason"] = raw  # keep as-is; frontend will clean it
        elif line.startswith("CONFIDENCE:"):
            try:
                current["confidence"] = float(line.split(":", 1)[1].strip())
            except ValueError:
                current["confidence"] = 0.5
        elif line.startswith("EXPLANATION:"):
            current["explanation"] = line.split(":", 1)[1].strip()

    if current.get("component"):
        results.append(current)

    # Deduplicate by component (keep first occurrence)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for r in results:
        if r["component"] not in seen:
            seen.add(r["component"])
            unique.append(r)

    return unique
