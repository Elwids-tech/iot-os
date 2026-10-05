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
	token := os.Getenv("DEVICE_BROKER_ADMIN_TOKEN")
	address := os.Getenv("BROKER_ADDRESS")
	username := os.Getenv("BROKER_ADMIN_USERNAME")
	password := os.Getenv("BROKER_ADMIN_PASSWORD")
	if len(token) < 32 || username == "" || password == "" || !strings.HasPrefix(address, "ssl://") {
		log.Fatal("broker admin private configuration missing")
	}
	control, err := brokeradmin.Connect(address, os.Getenv("BROKER_TLS_SERVER_NAME"), os.Getenv("BROKER_CA_FILE"), username, password)
	if err != nil {
		log.Fatal("broker admin startup failed; verify private broker configuration")
	}
	defer control.Close()
	server := &http.Server{Addr: ":8082", Handler: brokeradmin.New(control, token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second}
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
