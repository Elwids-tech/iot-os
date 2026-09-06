FROM golang:1.27.0-bookworm AS build
WORKDIR /src
COPY services/runtime/go.mod services/runtime/go.sum ./
RUN go mod download
COPY services/runtime/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /runtime ./cmd/runtime
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /runtime /runtime
ENTRYPOINT ["/runtime"]
