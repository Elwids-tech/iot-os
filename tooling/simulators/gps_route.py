"""Deterministic GPS route for the local Sparkplug simulator."""

import math


def gps_position(elapsed_seconds: float) -> tuple[float, float, float]:
    """Circle across the demo geofence boundary and return lat, lon, accuracy."""
    angle = elapsed_seconds / 30.0
    return (
        51.0 + 0.015 * math.sin(angle),
        -114.0 + 0.015 * math.cos(angle),
        5.0,
    )
