"""
SLO Burn Rate Calculator — Google SRE Book Chapter 5 Implementation

Implements multi-window burn rate alerting as described in
"Implementing SLOs" (Google SRE Workbook, Chapter 5).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


ALERT_WINDOWS: Final[dict[str, int]] = {
    "1h": 60,
    "6h": 360,
    "24h": 1440,
    "72h": 4320,
}

# (primary_window, confirmation_window, burn_rate_threshold, budget_consumed_pct, severity)
MULTIWINDOW_ALERT_TIERS: Final[list[tuple[str, str, float, float, str]]] = [
    ("1h",  "5m",  14.4, 2.0,  "P0"),
    ("6h",  "30m",  6.0, 5.0,  "P1"),
    ("24h", "2h",   3.0, 10.0, "P2"),
    ("72h", "6h",   1.0, 10.0, "P3"),
]


@dataclass(frozen=True)
class SLOConfig:
    target: float          # e.g. 0.999 for 99.9%
    window_days: int = 30

    def __post_init__(self) -> None:
        if not (0.0 < self.target < 1.0):
            raise ValueError(f"SLO target must be between 0 and 1, got {self.target}")

    @classmethod
    def from_percent(cls, percent: float, window_days: int = 30) -> "SLOConfig":
        return cls(target=percent / 100.0, window_days=window_days)

    @property
    def error_budget(self) -> float:
        return 1.0 - self.target

    @property
    def error_budget_minutes(self) -> float:
        return self.error_budget * self.window_days * 24 * 60


@dataclass(frozen=True)
class AlertWindow:
    label: str
    minutes: int
    burn_rate: float
    threshold: float
    firing: bool

    @property
    def budget_consumed_percent(self) -> float:
        window_hours = self.minutes / 60.0
        total_hours = 30 * 24.0
        return (self.burn_rate * window_hours / total_hours) * 100.0


@dataclass(frozen=True)
class MultiWindowAlert:
    slo: SLOConfig
    tier: str
    primary_window: AlertWindow
    confirmation_window: AlertWindow
    firing: bool

    @property
    def description(self) -> str:
        if not self.firing:
            return f"[{self.tier}] NOT firing"
        return (
            f"[{self.tier}] FIRING — {self.primary_window.label} burn rate "
            f"{self.primary_window.burn_rate:.2f}× (threshold {self.primary_window.threshold}×), "
            f"consuming {self.primary_window.budget_consumed_percent:.1f}% budget/window"
        )


def label_to_minutes(label: str) -> int:
    if label.endswith("h"):
        return int(label[:-1]) * 60
    if label.endswith("m"):
        return int(label[:-1])
    if label.endswith("d"):
        return int(label[:-1]) * 1440
    raise ValueError(f"Unknown window label: {label!r}")


def evaluate_multiwindow_alerts(
    slo: SLOConfig,
    burn_rates_by_window: dict[str, float],
) -> list[MultiWindowAlert]:
    alerts: list[MultiWindowAlert] = []
    for primary_label, confirm_label, threshold, _budget_pct, severity in MULTIWINDOW_ALERT_TIERS:
        primary_burn = burn_rates_by_window.get(primary_label, 0.0)
        confirm_burn = burn_rates_by_window.get(confirm_label, 0.0)

        primary_win = AlertWindow(
            label=primary_label,
            minutes=label_to_minutes(primary_label),
            burn_rate=primary_burn,
            threshold=threshold,
            firing=primary_burn >= threshold,
        )
        confirm_win = AlertWindow(
            label=confirm_label,
            minutes=label_to_minutes(confirm_label),
            burn_rate=confirm_burn,
            threshold=threshold,
            firing=confirm_burn >= threshold,
        )
        alerts.append(MultiWindowAlert(
            slo=slo,
            tier=severity,
            primary_window=primary_win,
            confirmation_window=confirm_win,
            firing=primary_win.firing and confirm_win.firing,
        ))
    return alerts
