FROM golang:1.27.3-bookworm AS build
WORKDIR /src
COPY services/runtime/go.mod services/runtime/go.sum ./
RUN go mod download
COPY services/runtime/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /runtime ./cmd/runtime
RUN CGO_ENABLED=0 go build -trimpath -o /committed-consumer ./cmd/committed-consumer
RUN CGO_ENABLED=0 go build -trimpath -o /broker-admin ./cmd/broker-admin
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /runtime /runtime
COPY --from=build /committed-consumer /committed-consumer
COPY --from=build /broker-admin /broker-admin
# Message contracts for the runtime's contract registry (spec 002, ADR-015).
COPY contracts /contracts
ENV IOT_CONTRACTS_PATH=/contracts
ENTRYPOINT ["/runtime"]
