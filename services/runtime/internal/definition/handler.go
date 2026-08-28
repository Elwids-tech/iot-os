package definition

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
)

const (
	CompileEndpointPath         = "/internal/v1/definitions/compile"
	minimumInternalTokenBytes   = 32
	maximumCompileRequestBytes  = 2 * 1024 * 1024
	compileResponseContentType  = "application/json"
	compileAuthenticationScheme = "Bearer"
)

type CompilerService interface {
	Compile(context.Context, CompileRequest) (CompileResult, error)
}

type errorResponse struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func NewHTTPHandler(compiler CompilerService, internalToken string) (http.Handler, error) {
	if compiler == nil {
		return nil, errors.New("definition compiler is required")
	}
	if len(internalToken) < minimumInternalTokenBytes || strings.TrimSpace(internalToken) != internalToken {
		return nil, fmt.Errorf("IOT_RUNTIME_INTERNAL_TOKEN must contain at least %d bytes and no surrounding whitespace", minimumInternalTokenBytes)
	}

	mux := http.NewServeMux()
	mux.Handle("POST "+CompileEndpointPath, authenticateInternalToken(internalToken, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		handleCompile(writer, request, compiler)
	})))

	return mux, nil
}

func authenticateInternalToken(expectedToken string, next http.Handler) http.Handler {
	expectedDigest := sha256.Sum256([]byte(expectedToken))

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		providedToken, ok := bearerToken(request.Header.Get("Authorization"))
		providedDigest := sha256.Sum256([]byte(providedToken))
		if !ok || subtle.ConstantTimeCompare(providedDigest[:], expectedDigest[:]) != 1 {
			writer.Header().Set("WWW-Authenticate", `Bearer realm="iot-runtime-internal"`)
			writeError(writer, http.StatusUnauthorized, "unauthorized", "A valid internal bearer token is required.")

			return
		}

		next.ServeHTTP(writer, request)
	})
}

func bearerToken(authorization string) (string, bool) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], compileAuthenticationScheme) || parts[1] == "" {
		return "", false
	}

	return parts[1], true
}

func handleCompile(writer http.ResponseWriter, request *http.Request, compiler CompilerService) {
	if contentType := request.Header.Get("Content-Type"); contentType != "" {
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != compileResponseContentType {
			writeError(writer, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.")

			return
		}
	}

	request.Body = http.MaxBytesReader(writer, request.Body, maximumCompileRequestBytes)
	var compileRequest CompileRequest
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(&compileRequest); err != nil {
		var maximumBytesError *http.MaxBytesError
		if errors.As(err, &maximumBytesError) {
			writeError(writer, http.StatusRequestEntityTooLarge, "request_too_large", "The compile request exceeds the 2 MiB limit.")

			return
		}

		writeError(writer, http.StatusBadRequest, "malformed_request", "The compile request must be a valid JSON object with known fields.")

		return
	}
	if err := requireJSONEnd(decoder); err != nil {
		writeError(writer, http.StatusBadRequest, "malformed_request", "The request body must contain exactly one JSON object.")

		return
	}

	result, err := compiler.Compile(request.Context(), compileRequest)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "compiler_unavailable", "The definition compiler could not process the request.")

		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func requireJSONEnd(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("request contains more than one JSON value")
	}

	return err
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, errorResponse{Error: errorDetail{Code: code, Message: message}})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", compileResponseContentType)
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
