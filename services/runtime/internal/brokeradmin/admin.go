// Package brokeradmin exposes a private, authenticated credential provisioning
// boundary. MQTT control credentials never reach devices or the public API.
package brokeradmin

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Rule struct {
	Permission string `json:"permission"`
	Action     string `json:"action"`
	Topic      string `json:"topic"`
}
type Client struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Rules    []Rule `json:"rules"`
}
type Command map[string]any
type Control interface {
	Execute(context.Context, Command) error
	Connected() bool
}
type Admin struct {
	control Control
	token   string
	gate    chan struct{}
}

func New(control Control, token string) *Admin {
	return &Admin{control: control, token: token, gate: make(chan struct{}, 1)}
}

var usernamePattern = regexp.MustCompile(`^(host|edge|sim-host|sim-edge|sim-gps-edge|sim-rgb-edge)-[a-zA-Z0-9-]{1,100}$`)
var levelPattern = regexp.MustCompile(`^[a-zA-Z0-9_.:-]+$`)

// Literal SUBSCRIBE ACLs authorize exactly the requested filter. Receive ACLs
// then authorize delivery per concrete topic, including retained messages.
func ACLs(c Client) ([]map[string]any, error) {
	if !usernamePattern.MatchString(c.Username) || len(c.Password) < 16 || len(c.Password) > 256 || len(c.Rules) == 0 || len(c.Rules) > 32 {
		return nil, errors.New("invalid client")
	}
	acls := []map[string]any{}
	seen := map[string]bool{}
	for _, r := range c.Rules {
		levels := strings.Split(r.Topic, "/")
		if r.Permission != "allow" || len(levels) < 3 || len(levels) > 5 || levels[0] != "spBv1.0" || !levelPattern.MatchString(levels[1]) {
			return nil, errors.New("invalid rule")
		}
		for _, level := range levels[2:] {
			if level != "+" && !levelPattern.MatchString(level) {
				return nil, errors.New("invalid topic")
			}
		}
		if levels[1] == "STATE" && (len(levels) != 3 || !levelPattern.MatchString(levels[2])) {
			return nil, errors.New("invalid STATE rule")
		}
		var kinds []string
		switch r.Action {
		case "publish":
			kinds = []string{"publishClientSend"}
		case "subscribe":
			kinds = []string{"subscribeLiteral", "publishClientReceive"}
		case "all":
			kinds = []string{"publishClientSend", "subscribeLiteral", "publishClientReceive"}
		default:
			return nil, errors.New("invalid action")
		}
		for _, kind := range kinds {
			key := kind + "\x00" + r.Topic
			if !seen[key] {
				acls = append(acls, map[string]any{"acltype": kind, "topic": r.Topic, "allow": true, "priority": 0})
				seen[key] = true
			}
		}
	}
	return acls, nil
}

func (a *Admin) Provision(ctx context.Context, c Client) error {
	acls, err := ACLs(c)
	if err != nil {
		return err
	}
	select {
	case a.gate <- struct{}{}:
		defer func() { <-a.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}
	role := "elwids-" + c.Username
	// Disable before changing authorization. A failed update leaves an existing
	// identity disabled; a new identity has no password until all ACLs exist.
	steps := []struct {
		command Command
		ignore  string
	}{
		{Command{"command": "disableClient", "username": c.Username}, "Client not found"},
		{Command{"command": "createRole", "rolename": role}, "Role already exists"},
		{Command{"command": "modifyRole", "rolename": role, "acls": acls}, ""},
		{Command{"command": "createClient", "username": c.Username}, "Client already exists"},
		{Command{"command": "disableClient", "username": c.Username}, ""},
		{Command{"command": "modifyClient", "username": c.Username, "password": c.Password, "roles": []map[string]any{{"rolename": role}}, "groups": []any{}}, ""},
		{Command{"command": "enableClient", "username": c.Username}, ""},
	}
	for _, step := range steps {
		if err := a.control.Execute(ctx, step.command); err != nil && (step.ignore == "" || err.Error() != step.ignore) {
			return errors.New("broker provisioning failed")
		}
	}
	return nil
}

func (a *Admin) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health/ready" && r.Method == "GET" {
		if !a.control.Connected() {
			http.Error(w, "broker unavailable", 503)
			return
		}
		w.WriteHeader(200)
		return
	}
	if a.token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.token)) != 1 {
		http.Error(w, "unauthorized", 401)
		return
	}
	if r.URL.Path != "/clients" || r.Method != "PUT" {
		http.NotFound(w, r)
		return
	}
	var c Client
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	if _, err := ACLs(c); err != nil {
		http.Error(w, "invalid client or rules", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	if err := a.Provision(ctx, c); err != nil {
		http.Error(w, "broker provisioning unavailable", 503)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func Correlation() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
