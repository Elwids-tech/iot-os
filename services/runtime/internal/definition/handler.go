package definition

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
)

const (
	CompileEndpointPath        = "/internal/v1/definitions/compile"
	minimumInternalTokenBytes  = 32
	maximumCompileRequestBytes = 2 * 1024 * 1024
	responseContentType        = "application/json"
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
	if len(internalToken) < minimumInternalTokenBytes {
		return nil, fmt.Errorf("internal compiler token must contain at least %d bytes", minimumInternalTokenBytes)
	}

	return authenticateInternalToken(internalToken, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writer.Header().Set("Allow", http.MethodPost)
			writeError(writer, http.StatusMethodNotAllowed, "method_not_allowed", "Only POST is allowed.")

			return
		}
		handleCompile(writer, request, compiler)
	})), nil
}

func authenticateInternalToken(expectedToken string, next http.Handler) http.Handler {
	expectedDigest := sha256.Sum256([]byte(expectedToken))

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		token, ok := bearerToken(request.Header.Get("Authorization"))
		actualDigest := sha256.Sum256([]byte(token))
		if !ok || subtle.ConstantTimeCompare(expectedDigest[:], actualDigest[:]) != 1 {
			writer.Header().Set("WWW-Authenticate", `Bearer realm="iot-runtime"`)
			writeError(writer, http.StatusUnauthorized, "unauthorized", "A valid internal Bearer token is required.")

			return
		}

		next.ServeHTTP(writer, request)
	})
}

func bearerToken(authorization string) (string, bool) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}

	return parts[1], true
}

func handleCompile(writer http.ResponseWriter, request *http.Request, compiler CompilerService) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != responseContentType {
		writeError(writer, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.")

		return
	}
	if request.ContentLength > maximumCompileRequestBytes {
		writeError(writer, http.StatusRequestEntityTooLarge, "request_too_large", "Compile request exceeds 2 MiB.")

		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, maximumCompileRequestBytes)
	payload, err := io.ReadAll(request.Body)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(writer, http.StatusRequestEntityTooLarge, "request_too_large", "Compile request exceeds 2 MiB.")

			return
		}
		writeError(writer, http.StatusBadRequest, "invalid_request", "Compile request body could not be read.")

		return
	}

	compileRequest, err := DecodeCompileRequest(payload)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", "Compile request must be one strict JSON document matching the internal contract.")

		return
	}
	result, err := compiler.Compile(request.Context(), compileRequest)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "compiler_unavailable", "Definition compiler could not complete the request.")

		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, errorResponse{Error: errorDetail{Code: code, Message: message}})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	payload, err := canonicalBytes(value)
	if err != nil {
		http.Error(writer, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)

		return
	}
	writer.Header().Set("Content-Type", responseContentType)
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_, _ = writer.Write(payload)
}
