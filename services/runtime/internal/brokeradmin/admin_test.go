package brokeradmin

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeControl struct {
	calls []Command
	fail  string
}

func (f *fakeControl) Connected() bool { return true }
func (f *fakeControl) Execute(_ context.Context, c Command) error {
	f.calls = append(f.calls, c)
	if c["command"] == f.fail {
		return errors.New("failure")
	}
	return nil
}
func fixtureClient() Client {
	return Client{Username: "edge-fixture", Password: "fixture-password-at-least-16", Rules: []Rule{{Permission: "allow", Action: "publish", Topic: "spBv1.0/tenant/NBIRTH/edge"}}}
}
func TestFailClosedDuringUpdate(t *testing.T) {
	f := &fakeControl{fail: "modifyRole"}
	a := New(f, "secret")
	if a.Provision(context.Background(), fixtureClient()) == nil {
		t.Fatal("expected failure")
	}
	if f.calls[0]["command"] != "disableClient" {
		t.Fatal("must disable before modifying ACLs")
	}
	for _, c := range f.calls {
		if c["command"] == "enableClient" {
			t.Fatal("must not enable failed update")
		}
	}
}
func TestRejectsBroadAndControlRules(t *testing.T) {
	for _, topic := range []string{"#", "$CONTROL/dynamic-security/v1", "spBv1.0/+/NBIRTH/+", "spBv1.0/tenant/#", "spBv1.0/STATE/+"} {
		c := fixtureClient()
		c.Rules[0].Topic = topic
		if _, err := ACLs(c); err == nil {
			t.Fatalf("accepted %s", topic)
		}
	}
	c := fixtureClient()
	c.Username = "elwids-admin"
	if _, err := ACLs(c); err == nil {
		t.Fatal("accepted admin identity")
	}
}
func TestPrivateEndpointRequiresBearer(t *testing.T) {
	f := &fakeControl{}
	a := New(f, "private-token")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, httptest.NewRequest("PUT", "/clients", strings.NewReader(`{}`)))
	if w.Code != 401 || len(f.calls) != 0 {
		t.Fatal("unauthenticated request reached broker")
	}
}
