package main

import (
	"github.com/Elwids-tech/iot-os/services/runtime/internal/brokeradmin"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	address := os.Getenv("BROKER_ADMIN_HTTP_ADDRESS")
	if address == "" {
		address = ":8082"
	}
	// `broker-admin health` is the container healthcheck: the image has no shell or curl.
	if len(os.Args) > 1 && os.Args[1] == "health" {
		os.Exit(health(address))
	}
	token := os.Getenv("DEVICE_BROKER_ADMIN_TOKEN")
	broker := os.Getenv("BROKER_ADDRESS")
	username := os.Getenv("BROKER_ADMIN_USERNAME")
	password := os.Getenv("BROKER_ADMIN_PASSWORD")
	if len(token) < 32 || username == "" || password == "" || !strings.HasPrefix(broker, "ssl://") {
		log.Fatal("broker admin private configuration missing")
	}
	control, err := brokeradmin.Connect(broker, os.Getenv("BROKER_TLS_SERVER_NAME"), os.Getenv("BROKER_CA_FILE"), username, password)
	if err != nil {
		log.Fatal("broker admin startup failed; verify private broker configuration")
	}
	defer control.Close()
	server := &http.Server{Addr: address, Handler: brokeradmin.New(control, token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second}
	// Exit after a lost control connection so the supervisor reconnects and
	// reapplies deny defaults before reporting ready.
	go func() {
		for range time.NewTicker(time.Second).C {
			if !control.Connected() {
				log.Fatal("broker control disconnected")
			}
		}
	}()
	log.Fatal(server.ListenAndServe())
}

func health(address string) int {
	if strings.HasPrefix(address, ":") {
		address = "127.0.0.1" + address
	}
	client := http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + address + "/health/ready")
	if err != nil {
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
