import type { ReactNode } from "react";
import type { AdapterSourceType } from "@iot-os/api-client";
import { Building2Icon, CloudIcon, LogInIcon, RadioTowerIcon, TimerIcon } from "lucide-react";
import { Button } from "@iot-os/ui/components/button";
import { ChoiceCard } from "@iot-os/ui/components/choice-card";
import { Panel } from "@iot-os/ui/components/panel";
import { RadioGroup } from "@iot-os/ui/components/radio-group";

/** The ways data reaches an adapter, in the order people meet them. */
const sources: Record<AdapterSourceType, { title: string; description: string; icon: ReactNode }> = {
  platform: {
    title: "Devices publish to our broker",
    description: "Each device connects over MQTT with its own credentials. Nothing is needed from the vendor.",
    icon: <RadioTowerIcon />,
  },
  vendor: {
    title: "Vendor MQTT broker",
    description: "We subscribe to the manufacturer’s broker. You need its address and credentials.",
    icon: <CloudIcon />,
  },
  webhook: {
    title: "Vendor cloud sends webhooks",
    description: "The vendor’s cloud posts each message to a URL we give you. You need access to its webhook settings.",
    icon: <LogInIcon />,
  },
  poll: {
    title: "Poll a vendor API",
    description: "We call the vendor’s REST API on a schedule. You need its address and an API key.",
    icon: <TimerIcon />,
  },
  opcua: {
    title: "OPC UA server",
    description:
      "We connect to a building or plant system’s OPC UA server. You need its address, how it signs people in, and someone who can trust a certificate on the server.",
    icon: <Building2Icon />,
  },
};
const order: AdapterSourceType[] = ["platform", "vendor", "webhook", "poll", "opcua"];
const webhookOff =
  "This deployment does not accept webhooks yet: an operator has to configure a public ingest address first.";

/** One question on its own: how the data arrives. The settings for the answer come after it. */
export function SourceChooser({
  value,
  onChange,
  onContinue,
  disabled,
  webhookAvailable,
}: {
  value: AdapterSourceType;
  onChange: (type: AdapterSourceType) => void;
  onContinue: () => void;
  disabled: boolean;
  webhookAvailable: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-form flex-col gap-5 py-2 md:py-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-title">How does the data reach us?</h2>
        <p className="text-body text-muted-foreground">
          Pick one. The manufacturer’s own format stays as it is.
        </p>
      </div>
      <RadioGroup
        value={value}
        onValueChange={(next) => next && onChange(next as AdapterSourceType)}
        aria-label="Source type"
        disabled={disabled}
        className="flex flex-col gap-2"
      >
        {order.map((type) => {
          const off = type === "webhook" && !webhookAvailable;
          return (
            <ChoiceCard
              key={type}
              value={type}
              checked={value === type}
              disabled={disabled || off}
              icon={sources[type].icon}
              title={sources[type].title}
              description={off ? webhookOff : sources[type].description}
            />
          );
        })}
      </RadioGroup>
      <div>
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </div>
  );
}

/** The chosen source as one row, once its settings are on the page. */
export function SourceChoice({
  type,
  onChange,
}: {
  type: AdapterSourceType;
  /** Omitted when the person cannot edit the adapter. */
  onChange?: () => void;
}) {
  return (
    <Panel className="flex flex-row flex-wrap items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
        {sources[type].icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">{sources[type].title}</p>
      </div>
      {onChange && (
        <Button variant="outline" size="sm" onClick={onChange}>
          Change source
        </Button>
      )}
    </Panel>
  );
}
