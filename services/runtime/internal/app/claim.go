package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/nats-io/nats.go"
)

// Control messages are applied straight from the claim (ADR-043). The runtime claims
// rows of the control plane's outbox, applies them one at a time in the order it was
// given them, and acknowledges a claim in one request once its rows are applied. A row
// that fails for now is retried in place with the rows behind it held back, so no later
// row overtakes it; one that can never apply is dead-lettered and acknowledged.
//
// The claim's 30 s lease is not a deadline for applying. Only one runtime runs and it
// claims nothing while it holds rows, so a row's lease token stays current for as long
// as applying takes; the lease only hands a stopped runtime's rows to the next one. A
// row applied but not acknowledged is claimed again and seen as a repeat by its handler.
const (
	controlStream   = "IOT_DEVICE_CONTROL"
	controlConsumer = "devices-control"
	claimPoll       = time.Second
	// claimLimit is how many rows the control plane hands out at once; a full claim
	// is followed by the next without waiting.
	claimLimit = 100
	drainPoll  = 200 * time.Millisecond
)

func (c *ControlClient) claim(ctx context.Context) ([]devices.Event, error) {
	var batch struct {
		Data []devices.Event `json:"data"`
	}
	if e := c.request(ctx, "POST", "/outbox/claim", map[string]any{}, &batch); e != nil {
		return nil, e
	}
	return batch.Data, nil
}

type acknowledgedRow struct {
	UUID       string `json:"uuid"`
	LeaseToken string `json:"lease_token"`
}

// acknowledge marks rows applied in one request and returns the rows the control
// plane did not acknowledge because they were claimed again meanwhile.
func (c *ControlClient) acknowledge(ctx context.Context, rows []devices.Event) ([]string, error) {
	request := make([]acknowledgedRow, len(rows))
	for i, row := range rows {
		request[i] = acknowledgedRow{UUID: row.UUID, LeaseToken: row.LeaseToken}
	}
	var response struct {
		Results []struct {
			UUID         string `json:"uuid"`
			Acknowledged bool   `json:"acknowledged"`
		} `json:"results"`
	}
	e := c.request(ctx, "POST", "/outbox/ack", map[string]any{"rows": request}, &response)
	var status *controlStatusError
	if errors.As(e, &status) && (status.Status == http.StatusNotFound || status.Status == http.StatusMethodNotAllowed) {
		// A control plane from before ADR-043 acknowledges one row at a time.
		return c.acknowledgeEach(ctx, request)
	}
	if e != nil {
		return nil, e
	}
	stale := []string{}
	for _, result := range response.Results {
		if !result.Acknowledged {
			stale = append(stale, result.UUID)
		}
	}
	return stale, nil
}

func (c *ControlClient) acknowledgeEach(ctx context.Context, rows []acknowledgedRow) ([]string, error) {
	stale := []string{}
	for _, row := range rows {
		e := c.request(ctx, "POST", "/outbox/"+row.UUID+"/ack", map[string]string{"lease_token": row.LeaseToken}, nil)
		var status *controlStatusError
		if errors.As(e, &status) && status.Status == http.StatusConflict {
			stale = append(stale, row.UUID)
			continue
		}
		if e != nil {
			return stale, e
		}
	}
	return stale, nil
}

// claimControl claims and applies control rows until ctx ends. It starts only once
// the control stream of an earlier runtime has been applied, so those messages keep
// their place ahead of anything claimed now.
func (a *Application) claimControl(ctx context.Context) {
	if !a.awaitControlStreamDrained(ctx) {
		return
	}
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		rows, e := a.Control.claim(ctx)
		if e != nil {
			a.Logger.Debug("control outbox unavailable", "error", e)
			timer.Reset(claimPoll)
			continue
		}
		a.applyClaim(ctx, rows)
		if len(rows) >= claimLimit {
			timer.Reset(0)
		} else {
			timer.Reset(claimPoll)
		}
	}
}

// applyClaim applies the rows of one claim in order and acknowledges them together.
func (a *Application) applyClaim(ctx context.Context, rows []devices.Event) {
	apply, delay := a.handleControl, retryDelay
	if a.applyControl != nil {
		apply = a.applyControl
	}
	if a.controlRetryDelay != nil {
		delay = a.controlRetryDelay
	}
	applied := make([]devices.Event, 0, len(rows))
	flush := func() {
		if len(applied) == 0 {
			return
		}
		// Applied rows are acknowledged even when the runtime is stopping, so the next
		// one does not see them again.
		ackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		stale, e := a.Control.acknowledge(ackCtx, applied)
		cancel()
		if e != nil {
			a.Logger.Warn("control rows applied but not acknowledged; they will be claimed again and handled as repeats", "rows", len(applied), "error", e)
		} else if len(stale) > 0 {
			a.Logger.Warn("control rows were claimed again before their acknowledgement; they will be handled as repeats", "rows", stale)
		}
		applied = applied[:0]
	}
	defer flush()
	defer a.controlRetrying.Store(0)
	for _, row := range rows {
		for attempt := uint64(1); ; attempt++ {
			e := apply(row)
			if isPermanent(e) {
				if letter := a.deadLetterRow(row, e); letter != nil {
					a.Logger.Error("control row could not be dead-lettered; retrying", "type", row.Type, "uuid", row.UUID, "error", e, "dead_letter_error", letter)
					e = letter
				} else {
					a.deadLetters.Add(1)
					a.Logger.Error("control row dead-lettered", "consumer", controlConsumer, "type", row.Type, "uuid", row.UUID, "error", e)
					e = nil
				}
			}
			if e == nil {
				applied = append(applied, row)
				break
			}
			// Rows already applied are not kept waiting behind the one that failed.
			flush()
			a.controlRetrying.Store(attempt)
			if attempt%10 == 0 {
				a.Logger.Error("control rows blocked by a failing row", "type", row.Type, "uuid", row.UUID, "attempts", attempt, "error", e)
			} else {
				a.Logger.Warn("control row deferred", "type", row.Type, "uuid", row.UUID, "attempts", attempt, "error", e)
			}
			timer := time.NewTimer(delay(attempt))
			select {
			case <-ctx.Done():
				timer.Stop()
				return // unacknowledged, so the row is claimed again after its lease
			case <-timer.C:
			}
		}
		a.controlRetrying.Store(0)
	}
}

// awaitControlStreamDrained waits until the devices-control consumer has handed over
// and settled every message an earlier runtime published to IOT_DEVICE_CONTROL. This
// runtime publishes nothing there; the stream and its consumer stay for one release so
// an earlier runtime can be started again without any change to them (ADR-043).
func (a *Application) awaitControlStreamDrained(ctx context.Context) bool {
	waiting := false
	for {
		drained, e := a.controlStreamDrained()
		if drained {
			if waiting {
				a.Logger.Info("control stream of an earlier runtime applied; claiming control rows")
			}
			return true
		}
		if e != nil {
			a.Logger.Warn("control stream state unavailable; control rows wait", "error", e)
		} else if !waiting {
			a.Logger.Info("applying the control stream of an earlier runtime before claiming control rows")
			waiting = true
		}
		timer := time.NewTimer(drainPoll)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false
		case <-timer.C:
		}
	}
}

func (a *Application) controlStreamDrained() (bool, error) {
	if a.JS == nil {
		return true, nil
	}
	info, e := a.JS.ConsumerInfo(controlStream, controlConsumer)
	if errors.Is(e, nats.ErrConsumerNotFound) || errors.Is(e, nats.ErrStreamNotFound) {
		return true, nil
	}
	if e != nil {
		return false, e
	}
	return info.NumPending == 0 && info.NumAckPending == 0, nil
}
