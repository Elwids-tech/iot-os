package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
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

	httpAddress := os.Getenv("IOT_RUNTIME_HTTP_ADDRESS")
	if httpAddress == "" {
		httpAddress = defaultHTTPAddress
	}
	// The handler changes as the process does: health only, then a standby's, then the
	// runtime's.
	var handler atomic.Pointer[http.Handler]
	use := func(h http.Handler) { handler.Store(&h) }
	use(health.Routes())
	server := &http.Server{
		Addr:              httpAddress,
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { (*handler.Load()).ServeHTTP(w, r) }),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		// Every request context ends with the signal context, so an open telemetry
		// stream (spec 030) ends when the process is asked to stop.
		BaseContext: func(net.Listener) context.Context { return shutdownContext },
	}
	serve := sync.OnceFunc(func() {
		logger.Info("runtime health server starting", "address", httpAddress)
		go func() {
			if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				logger.Error("runtime health server failed", "error", err)
				os.Exit(1)
			}
		}()
	})

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
		// One runtime is active (ADR-046). A standby answers health checks while it
		// waits for the lock; otherwise a held lock ends this process, as before.
		standby := os.Getenv("IOT_RUNTIME_STANDBY") == "true"
		if standby {
			use(app.StandbyHandler())
			serve()
			logger.Info("runtime waiting for the runtime lock as a standby")
		}
		leadership, err := store.LeadRuntime(shutdownContext, instanceName(), standby)
		if err != nil {
			if shutdownContext.Err() != nil {
				logger.Info("runtime stopped while waiting for the runtime lock")
				return
			}
			logger.Error("device runtime startup failed", "error", err)
			os.Exit(1)
		}
		defer leadership.Release()
		logger.Info("runtime lock held", "epoch", leadership.Epoch, "instance", leadership.Instance)
		go func() {
			select {
			case <-shutdownContext.Done():
			case <-leadership.Lost():
				// Another runtime may hold the lock already and connect with the same
				// host ID. Exit like a crash, without the offline STATE or a clean MQTT
				// disconnect: the broker then publishes this session's will only if the
				// session is still this process's.
				logger.Error("runtime lock lost; exiting so that only its holder acts", "epoch", leadership.Epoch)
				os.Exit(1)
			}
		}()
		runtime, err := app.New(shutdownContext, store, logger, leadership)
		if err != nil {
			if shutdownContext.Err() != nil {
				// Stopped while waiting for the control plane; not a failure.
				logger.Info("runtime stopped during startup", "error", err)
				return
			}
			logger.Error("device runtime startup failed", "error", err)
			leadership.Release()
			os.Exit(1)
		}
		defer runtime.Close()
		use(runtime.Handler())
	} else if migrateOnly {
		logger.Error("migration requires DEVICE_DATABASE_URL")
		os.Exit(1)
	}

	serve()
	<-shutdownContext.Done()
	contextWithTimeout, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Streams drain before the deferred runtime.Close() releases the store and NATS.
	if err := server.Shutdown(contextWithTimeout); err != nil {
		logger.Error("runtime shutdown failed", "error", err)
	}
}

// instanceName tells runtimes apart in the lock's record and the logs.
func instanceName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "runtime"
	}
	return fmt.Sprintf("%s:%d", host, os.Getpid())
}
