import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionCard } from "@iot-os/ui/components/action-card";
import { Button } from "@iot-os/ui/components/button";
import { CheckIcon, RocketIcon } from "lucide-react";
import { api } from "../lib/api";
import { Confirm } from "../components/forms";
import { profileCheck } from "../profiles/use-studio";

/**
 * The profile a conversation drafted, while it waits to be published: its unpublished draft,
 * the same automatic check the studio runs, and the version just published from chat.
 */
export function useProfileToPublish(org: string, uuid: string | null | undefined) {
  const context = useQuery({
    queryKey: ["organization", org],
    queryFn: () => api.organizationContext(org),
  });
  const can = context.data?.capabilities?.device_profiles;
  const profile = useQuery({
    queryKey: ["profile", org, uuid],
    queryFn: () => api.deviceProfile(org, uuid!),
    enabled: Boolean(uuid && can?.view),
  });
  const draft =
    profile.data?.status === "draft" && profile.data.parameters.length > 0 ? profile.data : null;
  const check = useQuery({
    ...profileCheck(org, uuid ?? "", draft?.draft_revision ?? 0),
    enabled: Boolean(draft && can?.validate),
  });
  const [published, setPublished] = useState<{ name: string; version: number } | null>(null);
  return {
    draft: can?.publish ? draft : null,
    check,
    published,
    setPublished,
  };
}

/** Publishes the drafted profile from chat, behind the studio's confirmation, then hands back to the assistant. */
export function ProfilePublishCard({
  org,
  state,
  disabled,
  onOpen,
  onContinue,
}: {
  org: string;
  state: ReturnType<typeof useProfileToPublish>;
  disabled: boolean;
  /** Called before a link leaves the panel. */
  onOpen: () => void;
  onContinue: (message: string) => void;
}) {
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const { draft, check, published } = state;
  if (published)
    return (
      <ActionCard
        icon={CheckIcon}
        label="Device profile"
        title={`Version ${published.version} is live`}
        description={`${published.name} can be used for devices now. Continue, and the assistant picks up from here.`}
      >
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            state.setPublished(null);
            onContinue(`I published ${published.name} version ${published.version}.`);
          }}
        >
          Continue setup
        </Button>
      </ActionCard>
    );
  if (!draft) return null;
  const next = draft.revision + 1;
  const result = check.data?.validation;
  const issues = result?.diagnostics.length ?? 0;
  return (
    <>
      <ActionCard
        icon={RocketIcon}
        label="Device profile"
        title={`Publish ${draft.name}`}
        description={
          check.isError
            ? "The check of the draft didn't finish. Open the profile to check it again."
            : !result
              ? "Checking the draft…"
              : result.valid
                ? `Checks passed. Version ${next} can be used for devices once it is published.`
                : `${issues} issue${issues === 1 ? "" : "s"} to fix before publishing.`
        }
      >
        {result && !result.valid ? (
          <Button asChild size="sm" variant="outline">
            <Link
              to={`/organizations/${encodeURIComponent(org)}/device-profiles/${draft.uuid}/review`}
              onClick={onOpen}
            >
              Review issues
            </Link>
          </Button>
        ) : (
          <Button size="sm" disabled={disabled || !check.data?.compiled} onClick={() => setConfirm(true)}>
            Publish version {next}
          </Button>
        )}
      </ActionCard>
      <Confirm
        open={confirm}
        title={`Publish version ${next}?`}
        description={
          draft.revision === 0
            ? `${draft.name} becomes available when you add devices. Later edits stay as a draft.`
            : `Your saved draft becomes version ${next}. Devices using version ${draft.revision} are not changed.`
        }
        action="Publish"
        destructive={false}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await api.publishDeviceProfile(org, draft.uuid, draft.draft_revision);
          state.setPublished({ name: draft.name, version: next });
          cache.removeQueries({ queryKey: profileCheck(org, draft.uuid, draft.draft_revision).queryKey });
          await Promise.all([
            cache.invalidateQueries({ queryKey: ["profile", org, draft.uuid] }),
            cache.invalidateQueries({ queryKey: ["profiles", org] }),
          ]);
        }}
      />
    </>
  );
}
