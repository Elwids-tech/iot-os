"""Deterministic GPS route for the local Sparkplug simulator."""

import math


def gps_position(elapsed_seconds: float, tracker: int = 0) -> tuple[float, float, float]:
    """Circle across the demo geofence boundary and return lat, lon, accuracy."""
    # A full lap takes about six minutes. Each outside arc lasts long enough to
    # exercise the seeded 60-second sustained-outside wandering policy.
    angle = elapsed_seconds / 60.0 + tracker * (2 * math.pi / 3)
    return (
        51.0 + 0.012 * math.sin(angle),
        -114.0 + 0.012 * math.cos(angle),
        5.0,
    )
