package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

func (a *Application) startRuleConsumer(ctx context.Context) error {
	info, err := a.JS.StreamInfo(devices.CommittedTelemetryStream)
	if err != nil {
		return err
	}
	sequence, err := a.Store.PrepareRuleConsumer(ctx, info.Created, info.State.FirstSeq, info.State.LastSeq)
	if err != nil {
		return err
	}
	const durable = "workflow-evaluator-v1"
	consumer, err := a.JS.ConsumerInfo(devices.CommittedTelemetryStream, durable)
	if errors.Is(err, nats.ErrConsumerNotFound) {
		consumer, err = a.JS.AddConsumer(devices.CommittedTelemetryStream, &nats.ConsumerConfig{Durable: durable, DeliverPolicy: nats.DeliverByStartSequencePolicy, OptStartSeq: sequence + 1, AckPolicy: nats.AckExplicitPolicy, AckWait: 30 * time.Second, MaxAckPending: 1, FilterSubject: devices.CommittedTelemetrySubject, ReplayPolicy: nats.ReplayInstantPolicy})
	}
	if err != nil {
		return err
	}
	if consumer.Config.AckPolicy != nats.AckExplicitPolicy || consumer.Config.MaxAckPending != 1 || consumer.Config.FilterSubject != devices.CommittedTelemetrySubject || consumer.AckFloor.Stream > sequence {
		return fmt.Errorf("incompatible workflow consumer or checkpoint behind broker acknowledgement")
	}
	sub, err := a.JS.PullSubscribe(devices.CommittedTelemetrySubject, durable, nats.Bind(devices.CommittedTelemetryStream, durable))
	if err != nil {
		return err
	}
	a.subscriptions = append(a.subscriptions, sub)
	a.rulesHealthy.Store(true)
	go func() {
		for ctx.Err() == nil {
			messages, err := sub.Fetch(1, nats.MaxWait(time.Second))
			if errors.Is(err, nats.ErrTimeout) {
				// No pending input is overtaken by a timer activation. Re-check
				// continuity so a retention gap cannot silently become "safe".
				stream, e := a.JS.StreamInfo(devices.CommittedTelemetryStream)
				if e == nil {
					_, e = a.Store.PrepareRuleConsumer(ctx, stream.Created, stream.State.FirstSeq, stream.State.LastSeq)
				}
				pending, e2 := a.JS.ConsumerInfo(devices.CommittedTelemetryStream, durable)
				if e == nil && e2 != nil {
					e = e2
				}
				if e == nil && pending.NumAckPending == 0 && pending.NumPending == 0 {
					e = a.Store.TickRules(ctx, time.Now().UTC())
				}
				if e != nil {
					a.rulesHealthy.Store(false)
					a.Logger.Warn("workflow timers deferred", "error", e)
				} else if pending.NumAckPending == 0 && pending.NumPending == 0 {
					a.rulesHealthy.Store(true)
				}
				continue
			}
			if err != nil {
				a.rulesHealthy.Store(false)
				a.Logger.Warn("workflow consumer deferred", "error", err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
				continue
			}
			for _, message := range messages {
				metadata, e := message.Metadata()
				if e == nil {
					stream, inspectErr := a.JS.StreamInfo(devices.CommittedTelemetryStream)
					e = inspectErr
					if e == nil {
						_, e = a.Store.PrepareRuleConsumer(ctx, stream.Created, stream.State.FirstSeq, stream.State.LastSeq)
					}
				}
				var input devices.CommittedTelemetry
				if e == nil {
					e = storage.Decode(message.Data, &input)
				}
				if e == nil {
					e = a.Store.ConsumeRuleTelemetry(ctx, metadata.Sequence.Stream, input, time.Now().UTC())
				}
				if e == nil {
					e = message.AckSync(nats.Context(ctx))
				} else {
					_ = message.NakWithDelay(3 * time.Second)
				}
				a.rulesHealthy.Store(e == nil)
				if e != nil {
					a.Logger.Warn("workflow telemetry deferred", "error", e)
				}
			}
		}
	}()
	return nil
}
