"""The simulated building management system of spec 038: Example Tower over OPC UA.

model     loads the building model file and builds the equipment and points for a size
dynamics  the simulated day from a seed: weather, sun, schedules and occupancy
controls  each controller's own loop, and the rules a command write must pass
physics   the building itself behind a small interface: step, read, apply a command
"""
