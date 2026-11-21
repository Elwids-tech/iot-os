package app

import (
	"fmt"
	"os"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage/storagetest"
)

func TestMain(m *testing.M) {
	if e := storagetest.StopBackgroundJobs(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	os.Exit(m.Run())
}
