# GPS simulator use case

The opt-in `GpsUseCaseSeeder` creates a local/testing fixture for the generic GPS path:

- a published latitude, longitude, and accuracy device profile;
- one dedicated Sparkplug gateway and three configured trackers (`gps-tracker`, `gps-tracker-2`, `gps-tracker-3`);
- one shared fence around the Calgary demo coordinates, with an independent draft workflow for each tracker;
- a dashboard with current coordinates, accuracy, history, location, and alert panels.

It is intentionally excluded from `DatabaseSeeder`, restricted to local/testing environments, and idempotent. Re-running it fills missing fixture records without replacing an existing fixture dashboard or workflow.

Prepare broker credentials and the fixture together from the API container:

```bash
php artisan devices:prepare-simulator \
  --gps \
  --output=/absolute/private/path/gps-simulator.json \
  --broker=ssl://localhost:8883 \
  --ca=/absolute/private/path/ca.crt
```

Then run the GPS simulator:

```bash
python tooling/simulators/sparkplug_simulator.py \
  --gps \
  --config=/absolute/private/path/gps-simulator.json \
  --state-file=/absolute/private/path/gps-simulator-state
```

The three trackers follow phase-offset routes across the seeded boundary and publish a paired GPS fix every second. Devices start deactivated so their sources can first present fresh birth certificates; activate each from its device page after the simulator is online, then use Save and activate in the shared geofence editor. Rerunning the seeder adds all three trackers to the fixture map and preserves existing fence geometry, policies, deployments, names, and layout. The map has a highlighted boundary, green inside markers, red outside markers, and grey unknown/stale markers. Dashed trails have panel-specific 1h, 6h, 24h, or 7d limits; the map toolbar changes the current view and panel editing saves the default. Missing, stale, or invalid fixes remain `unknown` under the existing location contract.
