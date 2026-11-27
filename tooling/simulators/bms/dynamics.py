"""The simulated day: weather, sun, schedules and people, all from a seed.

Everything here is a pure function of the seed and the simulated time, so the same
seed always gives the same day, however the clock is stepped.
"""
from __future__ import annotations

import functools
import hashlib
import math
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

SEASONS = {
    # mean and half-swing of the outdoor temperature (°C), mean humidity (%), the day of
    # the year the sun is placed on, and how often the sky is clear (0 to 1).
    'summer': {'mean': 26.0, 'swing': 6.0, 'humidity': 58.0, 'day_of_year': 196, 'clear': 0.8},
    'winter': {'mean': 3.0, 'swing': 4.0, 'humidity': 78.0, 'day_of_year': 15, 'clear': 0.45},
    'mild': {'mean': 15.0, 'swing': 5.5, 'humidity': 66.0, 'day_of_year': 105, 'clear': 0.6},
}
LATITUDE = 45.0  # degrees north; Example Tower is invented, so is where it stands
FACADES = {'north': 0.0, 'east': 90.0, 'south': 180.0, 'west': 270.0}


@functools.lru_cache(maxsize=1 << 17)
def unit(seed: int, *parts: object) -> float:
    """A stable number in [0, 1) for the seed and the parts (not Python's salted hash)."""
    digest = hashlib.blake2b(repr((seed,) + parts).encode(), digest_size=8).digest()
    return struct.unpack('>Q', digest)[0] / 2**64


def smooth(seed: int, key: object, t: float, period: float) -> float:
    """Smooth noise in [-1, 1] that changes over about `period` seconds."""
    i = math.floor(t / period)
    f = t / period - i
    f = f * f * (3 - 2 * f)
    a = unit(seed, key, i) * 2 - 1
    b = unit(seed, key, i + 1) * 2 - 1
    return a + (b - a) * f


def clamp(value: float, low: float, high: float) -> float:
    return float(low if value < low else high if value > high else value)


@dataclass(frozen=True)
class Weather:
    temperature: float  # °C
    humidity: float  # %
    wet_bulb: float  # °C
    sunlight: float  # global horizontal, W/m²
    wind_speed: float  # m/s
    wind_direction: float  # degrees
    rain: float  # mm/h
    sun_elevation: float  # degrees
    sun_azimuth: float  # degrees
    facade: dict  # façade -> W/m² falling on it (direct and diffuse)

    def on_facade(self, facade: str | None) -> float:
        return self.facade.get(facade, 0.0) if facade else 0.0


class Day:
    """The seeded day: weather, schedules and people."""

    def __init__(self, seed: int = 7, season: str = 'summer'):
        if season not in SEASONS:
            raise ValueError(f'unknown season {season!r}')
        self.seed = seed
        self.season = season
        self.profile = SEASONS[season]
        self._weather_cache: tuple[float, Weather] | None = None

    # The weather -------------------------------------------------------------------

    def weather(self, at: datetime) -> Weather:
        t = at.timestamp()
        if self._weather_cache and self._weather_cache[0] == t:
            return self._weather_cache[1]
        p = self.profile
        hour = _hour(at)
        day = math.floor(t / 86400)
        day_offset = (unit(self.seed, 'day-temperature', day) * 2 - 1) * 2.0
        # Coldest just before sunrise, warmest mid-afternoon.
        temperature = p['mean'] + day_offset + p['swing'] * math.sin(2 * math.pi * (hour - 9.0) / 24) \
            + 0.8 * smooth(self.seed, 'temperature', t, 1800)
        humidity = clamp(p['humidity'] - 1.8 * (temperature - p['mean'] - day_offset) + 6 * smooth(self.seed, 'humidity', t, 3600), 15, 100)
        wet_bulb = temperature - (100 - humidity) / 5.0 * 0.9
        clear = clamp(p['clear'] + 0.35 * smooth(self.seed, 'cloud', t, 5400), 0.05, 1.0)
        elevation, azimuth = sun_position(p['day_of_year'], hour)
        if elevation > 0:
            direct_normal = 900.0 * clear * (1 - math.exp(-elevation / 6.0))
            diffuse = 120.0 * math.sin(math.radians(elevation)) + 60 * (1 - clear) * math.sin(math.radians(elevation))
            sunlight = direct_normal * math.sin(math.radians(elevation)) + diffuse
        else:
            direct_normal = diffuse = sunlight = 0.0
        facade = {}
        for name, bearing in FACADES.items():
            incidence = math.cos(math.radians(elevation)) * math.cos(math.radians(azimuth - bearing))
            facade[name] = max(0.0, direct_normal * incidence) + diffuse * 0.5 if elevation > 0 else 0.0
        rainy = unit(self.seed, 'rain', day) < (0.15 if self.season == 'summer' else 0.35)
        rain = max(0.0, 6.0 * smooth(self.seed, 'rain-rate', t, 2400)) if rainy and clear < 0.4 else 0.0
        wind_speed = clamp(3.5 + 3.0 * smooth(self.seed, 'wind', t, 2700), 0.2, 20)
        wind_direction = (230 + 70 * smooth(self.seed, 'wind-direction', t, 7200)) % 360
        weather = Weather(round(temperature, 3), round(humidity, 3), round(wet_bulb, 3), round(sunlight, 2),
                          round(wind_speed, 2), round(wind_direction, 1), round(rain, 2), elevation, azimuth, facade)
        self._weather_cache = (t, weather)
        return weather

    # Schedules and people ----------------------------------------------------------

    def scheduled(self, use: str, at: datetime) -> bool:
        """Whether a zone of this use is in its occupied hours (what an air handling
        unit's time schedule follows)."""
        days, start, end = SCHEDULES.get(use, SCHEDULES['open_office'])
        return at.weekday() in days and start <= _hour(at) < end

    def starts_in(self, use: str, at: datetime) -> float | None:
        """Hours until a zone of this use next enters its occupied hours (within a day)."""
        days, start, _ = SCHEDULES.get(use, SCHEDULES['open_office'])
        hour = _hour(at)
        if at.weekday() in days and hour < start:
            return start - hour
        tomorrow = (at.weekday() + 1) % 7
        if tomorrow in days and hour >= start:
            return 24 - hour + start
        return None

    def occupancy(self, use: str, zone: str, at: datetime) -> float:
        """The fraction of a zone's people present, 0 to 1."""
        hour = _hour(at)
        weekday = at.weekday() < 5
        t = at.timestamp()
        wobble = 0.08 * smooth(self.seed, ('people', zone), t, 1200)
        if use in ('open_office', 'private_offices', 'meeting_rooms', 'circulation'):
            if not weekday:
                base = 0.04 if 9 <= hour < 16 else 0.0
            else:
                arrive = _ramp(hour, 7.0 + 0.5 * unit(self.seed, 'arrive', zone), 9.3)
                leave = 1 - _ramp(hour, 16.5 + 0.5 * unit(self.seed, 'leave', zone), 19.0)
                lunch = 1 - 0.35 * _bump(hour, 12.0, 13.5)
                base = 0.85 * arrive * leave * lunch
            if use == 'meeting_rooms':
                # Meetings start on the hour and fill the room or leave it empty.
                booked = unit(self.seed, 'meeting', zone, math.floor(t / 3600)) < 0.6
                base = base * (1.1 if booked else 0.1)
            if use == 'circulation':
                base = 0.3 * base + 0.5 * (_bump(hour, 8.0, 9.5) + _bump(hour, 12.0, 13.0) + _bump(hour, 17.0, 18.5)) * (1 if weekday else 0)
        elif use in ('conference', 'hall'):
            booked = weekday and 8 <= hour < 18 and unit(self.seed, 'conference', zone, math.floor(t / 7200)) < 0.55
            base = 0.9 if booked else (0.05 if weekday and 7 <= hour < 19 else 0.0)
        elif use == 'cafe':
            base = (0.25 * _bump(hour, 7.0, 9.5) + 1.0 * _bump(hour, 11.5, 14.0) + 0.15 * _bump(hour, 9.5, 17.0)) if weekday else 0.0
        elif use == 'kitchen':
            base = 0.8 * _bump(hour, 6.0, 15.0) if weekday else 0.0
        elif use == 'lobby':
            base = 0.6 * (_bump(hour, 7.5, 9.5) + _bump(hour, 12.0, 13.5) + _bump(hour, 16.5, 18.5)) + 0.15 * _bump(hour, 7.0, 20.0)
            base *= 1.0 if weekday else 0.25
        elif use == 'shop':
            base = 0.5 * _bump(hour, 9.0, 19.0) + 0.3 * _bump(hour, 12.0, 14.0)
            base *= 1.0 if at.weekday() < 6 else 0.4
        elif use == 'control_room':
            base = 0.3
        elif use == 'back_of_house':
            base = 0.35 * _bump(hour, 6.0, 18.0) if weekday else 0.05 * _bump(hour, 8.0, 14.0)
        else:
            base = 0.0
        return clamp(base + (wobble if base > 0.02 else 0.0), 0.0, 1.0)

    def traffic(self, at: datetime) -> float:
        """Car park movements, 0 to 1: morning arrivals and evening departures."""
        hour = _hour(at)
        if at.weekday() >= 5:
            return 0.1 * _bump(hour, 10.0, 16.0)
        return clamp(1.0 * _bump(hour, 7.3, 9.6) + 0.9 * _bump(hour, 16.4, 18.8) + 0.15 * _bump(hour, 9.6, 16.4)
                     + 0.1 * smooth(self.seed, 'traffic', at.timestamp(), 900), 0, 1)


# use -> (weekdays, start hour, end hour) of the occupied hours a schedule follows.
SCHEDULES = {
    'open_office': (range(0, 5), 7.0, 19.0),
    'private_offices': (range(0, 5), 7.0, 19.0),
    'meeting_rooms': (range(0, 5), 7.0, 19.0),
    'circulation': (range(0, 5), 7.0, 19.0),
    'conference': (range(0, 5), 7.0, 20.0),
    'hall': (range(0, 5), 7.0, 20.0),
    'cafe': (range(0, 5), 6.0, 18.0),
    'kitchen': (range(0, 5), 6.0, 16.0),
    'lobby': (range(0, 7), 6.0, 22.0),
    'shop': (range(0, 6), 8.5, 19.5),
    'control_room': (range(0, 7), 0.0, 24.0),
    'back_of_house': (range(0, 5), 6.0, 18.0),
}


def sun_position(day_of_year: int, hour: float) -> tuple[float, float]:
    """Solar elevation and azimuth (degrees, azimuth from north) at solar time."""
    declination = 23.44 * math.sin(math.radians(360 / 365 * (day_of_year - 81)))
    hour_angle = 15 * (hour - 12)
    lat, dec, ha = map(math.radians, (LATITUDE, declination, hour_angle))
    sin_el = math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(ha)
    elevation = math.degrees(math.asin(clamp(sin_el, -1, 1)))
    cos_az = (math.sin(dec) - math.sin(lat) * sin_el) / (math.cos(lat) * math.cos(math.radians(elevation)) + 1e-9)
    azimuth = math.degrees(math.acos(clamp(cos_az, -1, 1)))
    if hour_angle > 0:
        azimuth = 360 - azimuth
    return elevation, azimuth


class Clock:
    """Simulated time: starts at `start` and runs `speed` simulated seconds a second."""

    def __init__(self, start: datetime | None = None, speed: float = 1.0):
        if speed <= 0:
            raise ValueError('speed must be above zero')
        self.start = (start or datetime.now(timezone.utc)).astimezone(timezone.utc)
        self.speed = speed
        self._wall = time.monotonic()

    def now(self) -> datetime:
        return self.start + timedelta(seconds=(time.monotonic() - self._wall) * self.speed)


def _hour(at: datetime) -> float:
    return at.hour + at.minute / 60 + at.second / 3600


def _ramp(hour: float, start: float, end: float) -> float:
    return clamp((hour - start) / max(end - start, 1e-6), 0.0, 1.0)


def _bump(hour: float, start: float, end: float) -> float:
    """1 between start and end, with half-hour shoulders."""
    return _ramp(hour, start - 0.25, start + 0.25) * (1 - _ramp(hour, end - 0.25, end + 0.25))
