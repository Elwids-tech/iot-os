package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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
	a.mu.Lock()
	a.subscriptions = append(a.subscriptions, sub)
	a.mu.Unlock()
	a.noteRules(nil)
	go func() {
		for ctx.Err() == nil {
			cutoffAt := time.Now().UTC()
			if stream, e := a.JS.StreamInfo(devices.CommittedTelemetryStream); e == nil {
				if _, e = a.Store.PrepareRuleConsumer(ctx, stream.Created, stream.State.FirstSeq, stream.State.LastSeq); e == nil {
					e = a.Store.TickDAGs(ctx, cutoffAt, stream.State.LastSeq)
				}
				if e != nil {
					a.noteRules(e)
					a.Logger.Warn("DAG timers deferred", "error", e)
				}
			}
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
					a.noteRules(e)
					a.Logger.Warn("workflow timers deferred", "error", e)
				} else if pending.NumAckPending == 0 && pending.NumPending == 0 {
					a.noteRules(nil)
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
				a.noteRules(e)
				if e != nil {
					a.Logger.Warn("workflow telemetry deferred", "error", e)
				}
			}
		}
	}()
	return nil
}

// ruleFault explains why workflow evaluation is paused. Only faults that need an
// operator are recorded; transient broker errors just mark evaluation unhealthy.
type ruleFault struct {
	Code    string    `json:"code"`
	Message string    `json:"message"`
	Since   time.Time `json:"since"`
}

func (a *Application) noteRules(err error) {
	a.rulesHealthy.Store(err == nil)
	if err == nil {
		a.rulesFault.Store(nil)
		return
	}
	if errors.Is(err, storage.ErrRuleCheckpointContinuity) && a.rulesFault.Load() == nil {
		a.rulesFault.Store(&ruleFault{Code: "checkpoint_continuity", Message: err.Error(), Since: time.Now().UTC()})
	}
}

// pauseRules keeps the rest of the runtime available when the workflow consumer
// cannot start, then retries until it starts or an operator recovers it.
func (a *Application) pauseRules(ctx context.Context, err error) {
	a.rulesHealthy.Store(false)
	code := "start_failed"
	if errors.Is(err, storage.ErrRuleCheckpointContinuity) {
		code = "checkpoint_continuity"
	}
	a.rulesFault.Store(&ruleFault{Code: code, Message: err.Error(), Since: time.Now().UTC()})
	a.Logger.Error("workflow evaluation paused; devices, history and commands remain available", "error", err)
	go func() {
		delay := 5 * time.Second
		for {
			select {
			case <-ctx.Done():
				return
			case <-a.rulesRetry:
			case <-time.After(delay):
			}
			if e := a.startRuleConsumer(ctx); e != nil {
				if fault := a.rulesFault.Load(); fault == nil || fault.Message != e.Error() {
					a.Logger.Warn("workflow evaluation still paused", "error", e)
					a.rulesFault.Store(&ruleFault{Code: code, Message: e.Error(), Since: time.Now().UTC()})
				}
				delay = min(delay*2, time.Minute)
				continue
			}
			a.Logger.Info("workflow evaluation resumed")
			return
		}
	}()
}

func (a *Application) rulesStatus() map[string]any {
	status := map[string]any{"state": "running", "healthy": a.rulesHealthy.Load(), "fault": nil}
	if fault := a.rulesFault.Load(); fault != nil {
		status["state"], status["fault"] = "paused", fault
	} else if !a.rulesHealthy.Load() {
		status["state"] = "delayed"
	}
	return status
}

// rebaselineRules is the explicit recovery for a lost checkpoint: evaluation resumes
// from the newest retained telemetry and the skipped range is reported and logged.
func (a *Application) rebaselineRules(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Reason string `json:"reason"`
	}
	if !decodeBody(w, r, &request) {
		return
	}
	if len(request.Reason) < 3 {
		respond(w, 422, map[string]string{"message": "A recovery reason is required."})
		return
	}
	info, err := a.JS.StreamInfo(devices.CommittedTelemetryStream)
	if err != nil {
		respond(w, 503, map[string]string{"message": "The committed telemetry stream is unavailable."})
		return
	}
	created, sequence, err := a.Store.RebaselineRuleCheckpoint(r.Context(), info.Created, info.State.FirstSeq, info.State.LastSeq)
	if errors.Is(err, storage.ErrRuleCheckpointContinuous) {
		respond(w, 409, map[string]string{"message": "Workflow evaluation is continuous; there is nothing to recover."})
		return
	}
	if err != nil {
		respond(w, 503, map[string]string{"message": "The workflow checkpoint could not be recovered."})
		return
	}
	a.Logger.Warn("workflow checkpoint rebaselined by operator", "reason", request.Reason,
		"previous_stream_created", created, "previous_sequence", sequence,
		"stream_created", info.Created, "first_sequence", info.State.FirstSeq, "sequence", info.State.LastSeq)
	select {
	case a.rulesRetry <- struct{}{}:
	default:
	}
	respond(w, 200, map[string]any{
		"previous": map[string]any{"stream_created": created, "sequence": sequence},
		"current":  map[string]any{"stream_created": info.Created, "first_sequence": info.State.FirstSeq, "sequence": info.State.LastSeq},
	})
}
