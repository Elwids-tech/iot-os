package brokeradmin

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

const testPassword = "isolated-fixture-password-48-characters-long"

func fixtureControl(t *testing.T) *MQTT {
	t.Helper()
	address := os.Getenv("BROKER_TEST_ADDRESS")
	if address == "" {
		t.Skip("isolated Docker MQTT fixture required")
	}
	m, err := Connect(address, "mqtt.test", os.Getenv("BROKER_TEST_CA"), "elwids-admin", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}
func testClient(t *testing.T, username, password, id string, will bool, transports ...*net.Conn) (mqtt.Client, error) {
	t.Helper()
	pem, _ := os.ReadFile(os.Getenv("BROKER_TEST_CA"))
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(pem)
	opts := mqtt.NewClientOptions().AddBroker(os.Getenv("BROKER_TEST_ADDRESS")).SetClientID(id).SetUsername(username).SetPassword(password).SetConnectTimeout(2 * time.Second).SetKeepAlive(2 * time.Second).SetCleanSession(true).SetTLSConfig(&tls.Config{RootCAs: roots, ServerName: "mqtt.test", MinVersion: tls.VersionTLS12})
	if will {
		opts.SetWill("spBv1.0/STATE/host-a", `{"online":false}`, 1, true)
	}
	if len(transports) > 0 {
		opts.SetCustomOpenConnectionFn(func(uri *url.URL, options mqtt.ClientOptions) (net.Conn, error) {
			conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 2 * time.Second}, "tcp", uri.Host, options.TLSConfig)
			if err == nil {
				*transports[0] = conn
			}
			return conn, err
		})
	}
	c := mqtt.NewClient(opts)
	token := c.Connect()
	if !token.WaitTimeout(3 * time.Second) {
		return c, context.DeadlineExceeded
	}
	return c, token.Error()
}
func waitToken(t *testing.T, token mqtt.Token) {
	t.Helper()
	if !token.WaitTimeout(4*time.Second) || token.Error() != nil {
		t.Fatal("MQTT request failed", token.Error())
	}
}
func provisionHTTP(t *testing.T, a *Admin, c Client) {
	t.Helper()
	body, _ := json.Marshal(c)
	if base := os.Getenv("BROKER_TEST_ADMIN_URL"); base != "" {
		request, _ := http.NewRequest("PUT", base+"/clients", strings.NewReader(string(body)))
		request.Header.Set("Authorization", "Bearer fixture-private-token-32-characters-long")
		response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
		if err != nil {
			t.Fatal("private adapter unavailable", err)
		}
		defer response.Body.Close()
		if response.StatusCode != 204 {
			t.Fatalf("private adapter returned %d", response.StatusCode)
		}
		return
	}
	r := httptest.NewRequest("PUT", "/clients", strings.NewReader(string(body)))
	r.Header.Set("Authorization", "Bearer "+"fixture-private-token")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("provision failed %d: %s", w.Code, w.Body.String())
	}
}
func rules(group, edge, host string, isHost bool) []Rule {
	r := []Rule{}
	if isHost {
		for _, kind := range []string{"NBIRTH", "NDATA", "NDEATH"} {
			r = append(r, Rule{"allow", "subscribe", "spBv1.0/" + group + "/" + kind + "/+"})
		}
		for _, kind := range []string{"DBIRTH", "DDATA", "DDEATH"} {
			r = append(r, Rule{"allow", "subscribe", "spBv1.0/" + group + "/" + kind + "/+/+"})
		}
		r = append(r, Rule{"allow", "publish", "spBv1.0/" + group + "/NCMD/+"}, Rule{"allow", "publish", "spBv1.0/" + group + "/DCMD/+/+"}, Rule{"allow", "all", "spBv1.0/STATE/" + host})
	} else {
		for _, kind := range []string{"NBIRTH", "NDATA", "NDEATH"} {
			r = append(r, Rule{"allow", "publish", "spBv1.0/" + group + "/" + kind + "/" + edge})
		}
		for _, kind := range []string{"DBIRTH", "DDATA", "DDEATH"} {
			r = append(r, Rule{"allow", "publish", "spBv1.0/" + group + "/" + kind + "/" + edge + "/+"})
		}
		r = append(r, Rule{"allow", "subscribe", "spBv1.0/" + group + "/NCMD/" + edge}, Rule{"allow", "subscribe", "spBv1.0/" + group + "/DCMD/" + edge + "/+"}, Rule{"allow", "subscribe", "spBv1.0/STATE/" + host})
	}
	return r
}
func TestMosquittoAcceptance(t *testing.T) {
	m := fixtureControl(t)
	a := New(m, "fixture-private-token")
	if base := os.Getenv("BROKER_TEST_ADMIN_URL"); base != "" {
		response, err := http.Get(base + "/health/ready")
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal("adapter not ready")
		}
		request, _ := http.NewRequest("PUT", base+"/clients", strings.NewReader(`{}`))
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 401 {
			t.Fatal("private adapter accepted unauthenticated provisioning")
		}
	}
	for _, c := range []Client{{"host-a", testPassword, rules("tenant-a", "edge-a", "host-a", true)}, {"edge-a", testPassword, rules("tenant-a", "edge-a", "host-a", false)}, {"host-b", testPassword, rules("tenant-b", "edge-b", "host-b", true)}, {"edge-b", testPassword, rules("tenant-b", "edge-b", "host-b", false)}} {
		provisionHTTP(t, a, c)
		provisionHTTP(t, a, c)
	}
	if bad, err := testClient(t, "edge-a", "wrong-password", "bad", false); err == nil {
		bad.Disconnect(100)
		t.Fatal("wrong password accepted")
	}
	if bad, err := testClient(t, "", "", "anonymous", false); err == nil {
		bad.Disconnect(100)
		t.Fatal("anonymous accepted")
	}
	if wrong, err := Connect(os.Getenv("BROKER_TEST_ADDRESS"), "wrong.test", os.Getenv("BROKER_TEST_CA"), "elwids-admin", testPassword); err == nil {
		wrong.Close()
		t.Fatal("wrong TLS hostname accepted")
	}
	var hostTransport net.Conn
	host, err := testClient(t, "host-a", testPassword, "host-a", true, &hostTransport)
	if err != nil {
		t.Fatal(err)
	}
	defer host.Disconnect(100)
	edge, err := testClient(t, "edge-a", testPassword, "edge-a", false)
	if err != nil {
		t.Fatal(err)
	}
	defer edge.Disconnect(100)
	hostB, err := testClient(t, "host-b", testPassword, "host-b", false)
	if err != nil {
		t.Fatal(err)
	}
	defer hostB.Disconnect(100)
	for _, topic := range []string{"#", "spBv1.0/#", "spBv1.0/tenant-b/NBIRTH/+", "$CONTROL/dynamic-security/v1/response"} {
		token := host.Subscribe(topic, 1, nil)
		if !token.WaitTimeout(3*time.Second) || token.(*mqtt.SubscribeToken).Result()[topic] != 0x80 {
			t.Fatalf("forbidden subscription accepted: %s", topic)
		}
	}
	messages := make(chan string, 8)
	waitToken(t, host.Subscribe("spBv1.0/tenant-a/NBIRTH/+", 1, func(_ mqtt.Client, msg mqtt.Message) { messages <- string(msg.Payload()) }))
	cross := make(chan string, 8)
	waitToken(t, hostB.Subscribe("spBv1.0/tenant-b/NBIRTH/+", 1, func(_ mqtt.Client, msg mqtt.Message) { cross <- string(msg.Payload()) }))
	waitToken(t, edge.Publish("spBv1.0/tenant-a/NBIRTH/edge-a", 1, false, "birth"))
	select {
	case v := <-messages:
		if v != "birth" {
			t.Fatal(v)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("NBIRTH missing")
	}
	waitToken(t, edge.Publish("spBv1.0/tenant-a/NBIRTH/edge-a", 2, false, "qos2"))
	select {
	case v := <-messages:
		if v != "qos2" {
			t.Fatal(v)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("QoS2 delivery missing")
	}
	waitToken(t, edge.Publish("spBv1.0/tenant-b/NBIRTH/edge-b", 1, false, "intrusion"))
	select {
	case <-cross:
		t.Fatal("cross tenant publish delivered")
	case <-time.After(250 * time.Millisecond):
	}
	waitToken(t, edge.Publish("spBv1.0/tenant-a/NBIRTH/other-edge", 1, false, "intrusion"))
	select {
	case <-messages:
		t.Fatal("cross gateway publish delivered")
	case <-time.After(250 * time.Millisecond):
	}
	commands := make(chan string, 4)
	waitToken(t, edge.Subscribe("spBv1.0/tenant-a/DCMD/edge-a/+", 1, func(_ mqtt.Client, msg mqtt.Message) { commands <- string(msg.Payload()) }))
	waitToken(t, host.Publish("spBv1.0/tenant-a/DCMD/edge-a/device", 1, false, "command"))
	select {
	case <-commands:
	case <-time.After(3 * time.Second):
		t.Fatal("DCMD missing")
	}
	waitToken(t, host.Publish("spBv1.0/STATE/host-a", 1, true, `{"online":true}`))
	state := make(chan string, 4)
	waitToken(t, edge.Subscribe("spBv1.0/STATE/host-a", 1, func(_ mqtt.Client, msg mqtt.Message) { state <- string(msg.Payload()) }))
	select {
	case v := <-state:
		if !strings.Contains(v, "true") {
			t.Fatal(v)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("retained STATE missing")
	}
	// Dropping transport without DISCONNECT must deliver the retained LWT.
	hostTransport.Close()
	select {
	case v := <-state:
		if !strings.Contains(v, "false") {
			t.Fatal("LWT missing offline state", v)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("LWT not delivered")
	}
	rotated := Client{"edge-a", testPassword + "-rotated", rules("tenant-a", "edge-a", "host-a", false)}
	provisionHTTP(t, a, rotated)
	deadline := time.Now().Add(2 * time.Second)
	for edge.IsConnectionOpen() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if edge.IsConnectionOpen() {
		t.Fatal("credential update did not disconnect existing session")
	}
	if bad, err := testClient(t, "edge-a", testPassword, "old", false); err == nil {
		bad.Disconnect(100)
		t.Fatal("old password accepted")
	}
	newClient, err := testClient(t, "edge-a", rotated.Password, "new", false)
	if err != nil {
		t.Fatal("rotated password rejected")
	}
	newClient.Disconnect(100)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := m.Execute(ctx, Command{"command": "disableClient", "username": "edge-a"}); err != nil {
		t.Fatal(err)
	}
	if bad, err := testClient(t, "edge-a", rotated.Password, "disabled", false); err == nil {
		bad.Disconnect(100)
		t.Fatal("revoked identity accepted")
	}
	// Fixture persistence marker is inspected after the broker is killed/recreated.
	t.Log("TLS, credentials, deny defaults, literal subscriptions, tenant/gateway isolation, QoS1, Sparkplug topic directions, retained STATE/LWT, rotation and revocation passed")
}
func TestMosquittoRecovery(t *testing.T) {
	m := fixtureControl(t)
	_ = m
	c, err := testClient(t, "host-a", testPassword, "recovery-host", false)
	if err != nil {
		t.Fatal("credentials lost after restart")
	}
	defer c.Disconnect(100)
	state := make(chan string, 1)
	waitToken(t, c.Subscribe("spBv1.0/STATE/host-a", 1, func(_ mqtt.Client, msg mqtt.Message) { state <- string(msg.Payload()) }))
	select {
	case v := <-state:
		if !strings.Contains(v, "online") {
			t.Fatal(v)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("retained state lost")
	}
	if bad, err := testClient(t, "edge-a", testPassword+"-rotated", "still-disabled", false); err == nil {
		bad.Disconnect(100)
		t.Fatal("revocation lost after restart")
	}
}
