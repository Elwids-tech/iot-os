package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/committedconsumer"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	path := flag.String("state", "committed-checkpoint.json", "private local projection/checkpoint file")
	durable := flag.String("durable", "committed-demo", "dedicated durable consumer name")
	limit := flag.Int("max-messages", 0, "exit after this many deliveries (0 = continuous)")
	timeout := flag.Duration("timeout", 30*time.Second, "deadline for a bounded max-messages run")
	flag.Parse()
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = nats.DefaultURL
	}
	nc, err := nats.Connect(url, nats.Name("committed-telemetry-example"))
	if err != nil {
		return errors.New("could not connect to NATS; check NATS_URL")
	}
	defer nc.Close()
	js, err := nc.JetStream()
	if err != nil {
		return err
	}
	info, err := js.StreamInfo(devices.CommittedTelemetryStream)
	if err != nil {
		return err
	}
	checkpoint, err := committedconsumer.Open(*path, *durable, info.Created.Format(time.RFC3339Nano))
	if err != nil {
		return err
	}
	defer checkpoint.Close()
	if checkpoint.State.LastStreamSequence > 0 && info.State.FirstSeq > checkpoint.State.LastStreamSequence+1 {
		return errors.New("checkpoint is outside retained stream history; historical reconciliation is required")
	}
	if checkpoint.State.LastStreamSequence == 0 && info.State.FirstSeq > 1 {
		return errors.New("stream history has already expired; this fresh projection needs historical reconciliation before consuming")
	}
	consumerInfo, err := js.ConsumerInfo(devices.CommittedTelemetryStream, *durable)
	var sub *nats.Subscription
	if err == nil {
		if consumerInfo.AckFloor.Stream > checkpoint.State.LastStreamSequence {
			return errors.New("broker checkpoint is ahead of the local projection; restore the checkpoint or use a new durable to replay retained events")
		}
		sub, err = js.PullSubscribe(devices.CommittedTelemetrySubject, *durable, nats.Bind(devices.CommittedTelemetryStream, *durable))
	} else if errors.Is(err, nats.ErrConsumerNotFound) {
		if checkpoint.State.LastStreamSequence > 0 && info.State.FirstSeq > checkpoint.State.LastStreamSequence+1 {
			return errors.New("checkpoint is outside retained stream history; historical reconciliation is required")
		}
		sub, err = js.PullSubscribe(devices.CommittedTelemetrySubject, *durable, nats.BindStream(devices.CommittedTelemetryStream), nats.ManualAck(), nats.AckExplicit(), nats.StartSequence(checkpoint.State.LastStreamSequence+1), nats.MaxAckPending(1))
	} else {
		return err
	}
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *limit > 0 {
		var stop context.CancelFunc
		ctx, stop = context.WithTimeout(ctx, *timeout)
		defer stop()
	}
	for received := 0; *limit == 0 || received < *limit; {
		if ctx.Err() != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return errors.New("bounded consumer timed out waiting for telemetry")
			}
			return nil
		}
		messages, err := sub.Fetch(1, nats.MaxWait(time.Second))
		if errors.Is(err, nats.ErrTimeout) {
			continue
		}
		if err != nil {
			return err
		}
		for _, message := range messages {
			var event devices.CommittedTelemetry
			if err := storage.Decode(message.Data, &event); err != nil {
				return err
			}
			metadata, err := message.Metadata()
			if err != nil {
				return err
			}
			if metadata.Sequence.Stream > checkpoint.State.LastStreamSequence+1 {
				return errors.New("stream sequence gap detected; reconcile missing history before acknowledging")
			}
			fresh, err := checkpoint.Apply(event, metadata.Sequence.Stream)
			if err != nil {
				return err
			}
			if err = message.AckSync(); err != nil {
				return err
			}
			received++
			if err = json.NewEncoder(os.Stdout).Encode(map[string]any{"applied": fresh, "events": len(checkpoint.State.Events), "checkpoint": checkpoint.State.LastStreamSequence}); err != nil {
				return err
			}
		}
	}
	return nil
}
