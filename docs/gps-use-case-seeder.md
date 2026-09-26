# GPS simulator use case

The opt-in `GpsUseCaseSeeder` creates a local/testing fixture for the generic GPS path:

- a published latitude, longitude, and accuracy device profile;
- a dedicated Sparkplug gateway, discovery source, configured device, and applied configuration;
- a draft geofence workflow around the Calgary demo coordinates;
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

The route circles the seeded polygon and crosses its boundary. The device starts deactivated so its source can first present a fresh birth certificate; activate it from the device page after the simulator is online. The workflow remains a draft so a developer can review and explicitly deploy it after that first device activation. Missing, stale, or invalid fixes remain `unknown` under the existing location contract.
