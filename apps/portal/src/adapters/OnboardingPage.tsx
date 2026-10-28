import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WorkspacePage } from "@iot-os/ui/templates/workspace-page";
import { api } from "../lib/api";
import { OnboardingAssistant } from "./OnboardingAssistant";

/**
 * Add device → Ask the onboarding assistant (spec 020, User Story 6). The conversation
 * starts here without an adapter; once the person applies a reuse or create proposal,
 * the workbench of that adapter takes over.
 */
export function OnboardingPage() {
  const { organizationUuid: org = "" } = useParams();
  const navigate = useNavigate();
  const directory = useQuery({
    queryKey: ["adapters", org],
    queryFn: () => api.deviceAdapters(org),
  });
  const capabilities = directory.data?.capabilities;
  return (
    <WorkspacePage
      title="Onboard a device"
      back={{ to: `/organizations/${org}/devices/onboard`, label: "Add device" }}
      tools={
        <p className="text-body text-muted-foreground">
          Tell the assistant what you are connecting. It recommends how, sets up
          the adapter and its device profile with you, and checks real data
          before anything goes live.
        </p>
      }
    >
      <OnboardingAssistant
        org={org}
        canEdit={!!capabilities?.manage}
        onApplied={(adapter) =>
          navigate(`/organizations/${org}/device-adapters/${adapter.uuid}`, { state: { tab: "ai" } })
        }
      />
    </WorkspacePage>
  );
}
