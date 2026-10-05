package brokeradmin

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"os"
	"sync"
	"time"
)

const controlTopic = "$CONTROL/dynamic-security/v1"

type MQTT struct {
	client  mqtt.Client
	mu      sync.Mutex
	pending map[string]chan error
}

func Connect(address, serverName, caFile, username, password string) (*MQTT, error) {
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: serverName}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, errors.New("CA unavailable")
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(pem) {
			return nil, errors.New("invalid CA")
		}
		tlsConfig.RootCAs = roots
	}
	m := &MQTT{pending: map[string]chan error{}}
	opts := mqtt.NewClientOptions().AddBroker(address).SetUsername(username).SetPassword(password).SetClientID("elwids-admin-" + Correlation()).SetTLSConfig(tlsConfig).SetAutoReconnect(false).SetConnectTimeout(5 * time.Second).SetCleanSession(true)
	m.client = mqtt.NewClient(opts)
	if token := m.client.Connect(); !token.WaitTimeout(6*time.Second) || token.Error() != nil {
		return nil, errors.New("broker control connection failed")
	}
	if token := m.client.Subscribe(controlTopic+"/response", 1, m.response); !token.WaitTimeout(5*time.Second) || token.Error() != nil {
		m.client.Disconnect(250)
		return nil, errors.New("broker control subscription failed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := m.Execute(ctx, Command{"command": "setDefaultACLAccess", "acls": []map[string]any{{"acltype": "publishClientSend", "allow": false}, {"acltype": "publishClientReceive", "allow": false}, {"acltype": "subscribe", "allow": false}, {"acltype": "unsubscribe", "allow": true}}})
	if err != nil {
		m.Close()
		return nil, errors.New("broker default ACL configuration failed")
	}
	return m, nil
}
func (m *MQTT) response(_ mqtt.Client, msg mqtt.Message) {
	var body struct {
		Responses []struct {
			Correlation string `json:"correlationData"`
			Error       string `json:"error"`
		} `json:"responses"`
	}
	if json.Unmarshal(msg.Payload(), &body) != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range body.Responses {
		if ch := m.pending[r.Correlation]; ch != nil {
			var err error
			if r.Error != "" {
				err = errors.New(r.Error)
			}
			select {
			case ch <- err:
			default:
			}
		}
	}
}
func (m *MQTT) Execute(ctx context.Context, c Command) error {
	id := Correlation()
	c["correlationData"] = id
	ch := make(chan error, 1)
	m.mu.Lock()
	m.pending[id] = ch
	m.mu.Unlock()
	defer func() { m.mu.Lock(); delete(m.pending, id); m.mu.Unlock() }()
	data, err := json.Marshal(map[string]any{"commands": []Command{c}})
	if err != nil {
		return errors.New("invalid control request")
	}
	t := m.client.Publish(controlTopic, 1, false, data)
	if !t.WaitTimeout(3*time.Second) || t.Error() != nil {
		return errors.New("broker control publish failed")
	}
	select {
	case err := <-ch:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(3 * time.Second):
		return errors.New("broker control response timeout")
	}
}
func (m *MQTT) Connected() bool { return m.client.IsConnectionOpen() }
func (m *MQTT) Close()          { m.client.Disconnect(250) }
