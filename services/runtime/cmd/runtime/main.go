package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/app"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/health"
)

const defaultHTTPAddress = ":8081"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "runtime")
	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	migrateOnly := len(os.Args) == 2 && os.Args[1] == "--migrate"
	var handler http.Handler = health.Routes()
	if databaseURL := os.Getenv("DEVICE_DATABASE_URL"); databaseURL != "" {
		store, err := storage.OpenWithSchema(shutdownContext, databaseURL, migrateOnly || os.Getenv("IOT_RUNTIME_AUTO_MIGRATE") != "false")
		if err != nil {
			logger.Error("device storage startup failed", "error", err)
			os.Exit(1)
		}
		defer store.Pool.Close()
		if migrateOnly {
			logger.Info("runtime schema migrated")
			return
		}
		runtime, err := app.New(shutdownContext, store, logger)
		if err != nil {
			logger.Error("device runtime startup failed", "error", err)
			os.Exit(1)
		}
		defer runtime.Close()
		handler = runtime.Handler()
	} else if migrateOnly {
		logger.Error("migration requires DEVICE_DATABASE_URL")
		os.Exit(1)
	}
	httpAddress := os.Getenv("IOT_RUNTIME_HTTP_ADDRESS")
	if httpAddress == "" {
		httpAddress = defaultHTTPAddress
	}

	server := &http.Server{
		Addr:              httpAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-shutdownContext.Done()

		contextWithTimeout, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(contextWithTimeout); err != nil {
			logger.Error("runtime shutdown failed", "error", err)
		}
	}()

	logger.Info("runtime health server starting", "address", httpAddress)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("runtime health server failed", "error", err)
		os.Exit(1)
	}
}
