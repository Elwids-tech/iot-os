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

	"github.com/Elwids-tech/iot-os/services/runtime/internal/definition"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/health"
)

const defaultHTTPAddress = ":8081"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	httpAddress := os.Getenv("IOT_RUNTIME_HTTP_ADDRESS")
	if httpAddress == "" {
		httpAddress = defaultHTTPAddress
	}
	compiler, err := definition.NewCompiler()
	if err != nil {
		logger.Error("definition compiler initialization failed", "error", err)
		os.Exit(1)
	}
	handler, err := runtimeRoutes(compiler, os.Getenv("IOT_RUNTIME_INTERNAL_TOKEN"))
	if err != nil {
		logger.Error("runtime route initialization failed", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              httpAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownContext.Done()

		contextWithTimeout, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(contextWithTimeout); err != nil {
			logger.Error("runtime shutdown failed", "error", err)
		}
	}()

	logger.Info("runtime server starting", "address", httpAddress)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("runtime server failed", "error", err)
		os.Exit(1)
	}
}

func runtimeRoutes(compiler definition.CompilerService, internalToken string) (http.Handler, error) {
	compileHandler, err := definition.NewHTTPHandler(compiler, internalToken)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.Handle(definition.CompileEndpointPath, compileHandler)
	mux.Handle("/", health.Routes())

	return mux, nil
}
