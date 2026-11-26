CREATE EXTENSION IF NOT EXISTS timescaledb;
-- Name and path search of the entity hierarchy (spec 009); the application role cannot create extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE iot_api LOGIN PASSWORD '__API_DB_PASSWORD__';
CREATE ROLE iot_runtime LOGIN PASSWORD '__RUNTIME_DB_PASSWORD__';
GRANT CONNECT ON DATABASE iot TO iot_api, iot_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO iot_api;
CREATE SCHEMA device_runtime AUTHORIZATION iot_runtime;
GRANT USAGE ON SCHEMA device_runtime TO iot_api;
ALTER DEFAULT PRIVILEGES FOR ROLE iot_runtime IN SCHEMA device_runtime GRANT SELECT ON TABLES TO iot_api;
