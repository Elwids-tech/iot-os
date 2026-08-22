package health

import (
	"encoding/json"
	"net/http"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/buildinfo"
)

type response struct {
	Status string         `json:"status"`
	Build  buildinfo.Info `json:"build"`
}

func Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", respond("ok"))
	mux.HandleFunc("GET /readyz", respond("ready"))
	return mux
}

func respond(status string) http.HandlerFunc {
	return func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)

		_ = json.NewEncoder(writer).Encode(response{
			Status: status,
			Build:  buildinfo.Current(),
		})
	}
}
