import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group";
import { Textarea } from "@iot-os/ui/components/textarea";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { RequestError } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  formatTime,
  useDeviceOrganization,
} from "../devices/shared";

export default function AlertRoutes() {
  return (
    <Routes>
      <Route index element={<AlertDirectory />} />
      <Route path=":alertUuid" element={<DetailRoute />} />
    </Routes>
  );
}
function DetailRoute() {
  const { organizationUuid = "", alertUuid = "" } = useParams();
  return (
    <AlertDetail key={`${organizationUuid}:${alertUuid}`} id={alertUuid} />
  );
}
function AlertDirectory() {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["alerts", org, params.toString()],
    queryFn: () => api.alerts(org, params.toString()),
    enabled: capabilities.view,
    refetchInterval: 5000,
  });
  const condition = params.get("condition") ?? "all";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-muted-foreground">
          Review conditions, acknowledge episodes and record follow-up.
        </p>
      </div>
      <RequestError error={organization.error ?? query.error} />
      {!organization.isPending && !capabilities.view ? (
        <DeviceEmpty
          title="Alerts unavailable"
          description="You need device viewing access in this organization."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Alert episodes</CardTitle>
            <CardDescription>
              Condition clearing and acknowledgement are tracked separately.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ToggleGroup
              type="single"
              value={condition}
              variant="outline"
              aria-label="Filter by condition"
              onValueChange={(value) => {
                if (!value) return;
                const next = new URLSearchParams(params);
                next.delete("page");
                value === "all"
                  ? next.delete("condition")
                  : next.set("condition", value);
                setParams(next);
              }}
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="active">Active</ToggleGroupItem>
              <ToggleGroupItem value="cleared">Cleared</ToggleGroupItem>
            </ToggleGroup>
            {query.isPending ? (
              <Skeleton className="h-48 w-full" />
            ) : query.data?.data.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Acknowledgement</TableHead>
                    <TableHead>Activated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.data.map((alert) => (
                    <TableRow key={alert.uuid}>
                      <TableCell>
                        <Link
                          className="underline underline-offset-4"
                          to={alert.uuid}
                        >
                          {alert.workflow_name} · Episode {alert.episode}
                        </Link>
                        {alert.execution_stopped_reason ? (
                          <p className="text-xs text-muted-foreground">
                            Execution stopped
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            alert.condition === "active"
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {alert.condition === "active" ? "Active" : "Cleared"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {alert.acknowledged_at
                          ? "Acknowledged"
                          : "Unacknowledged"}
                      </TableCell>
                      <TableCell>{formatTime(alert.activated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : !query.error ? (
              <DeviceEmpty
                title="No alert episodes"
                description="Episodes appear when an activated workflow emits a condition transition."
              />
            ) : null}
            <DevicePages
              meta={query.data?.meta}
              label="Alerts"
              onPage={(page) => {
                const next = new URLSearchParams(params);
                next.set("page", String(page));
                setParams(next);
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function AlertDetail({ id }: { id: string }) {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const cache = useQueryClient();
  const [comment, setComment] = useState({
    uuid: crypto.randomUUID(),
    body: "",
  });
  const [page, setPage] = useState(1);
  useUnsavedContribution(Boolean(comment.body));
  const query = useQuery({
    queryKey: ["alert", org, id],
    queryFn: () => api.alert(org, id),
    enabled: capabilities.view,
    refetchInterval: 5000,
  });
  const comments = useQuery({
    queryKey: ["alert-comments", org, id, page],
    queryFn: () => api.alertComments(org, id, page),
    enabled: capabilities.view,
  });
  const deliveries = useQuery({
    queryKey: ["alert-deliveries", org, id],
    queryFn: () => api.alertDeliveries(org, id),
    enabled: capabilities.manage,
    refetchInterval: 5000,
  });
  const acknowledge = useMutation({
    mutationFn: () => api.acknowledgeAlert(org, id),
    onSuccess: (data) => {
      cache.setQueryData(["alert", org, id], data);
      void cache.invalidateQueries({ queryKey: ["alerts", org] });
    },
  });
  const addComment = useMutation({
    mutationFn: () => api.addAlertComment(org, id, comment),
    onSuccess: () => {
      setComment({ uuid: crypto.randomUUID(), body: "" });
      void cache.invalidateQueries({ queryKey: ["alert-comments", org, id] });
    },
  });
  const alert = query.data;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Link
        className="text-sm underline underline-offset-4"
        to={`/organizations/${org}/alerts`}
      >
        Back to alerts
      </Link>
      <RequestError error={organization.error ?? query.error} />
      {query.isPending && capabilities.view ? (
        <Skeleton className="h-48 w-full" />
      ) : null}
      {!organization.isPending && !capabilities.view ? (
        <DeviceEmpty
          title="Alert unavailable"
          description="You need device viewing access in this organization."
        />
      ) : null}
      {alert ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{alert.workflow_name}</h1>
              <p className="text-muted-foreground">Episode {alert.episode}</p>
            </div>
            <Badge
              variant={alert.condition === "active" ? "warning" : "secondary"}
            >
              {alert.condition === "active"
                ? "Condition active"
                : "Condition cleared"}
            </Badge>
          </div>
          {alert.execution_stopped_reason ? (
            <Alert>
              <AlertTitle>Execution stopped</AlertTitle>
              <AlertDescription>
                {alert.execution_stopped_reason.replaceAll("_", " ")}. This
                episode preserves its last condition; stopping execution does
                not clear it.
              </AlertDescription>
            </Alert>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Episode status</CardTitle>
              <CardDescription>
                Acknowledging records that someone has seen the alert. It does
                not change the condition.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-sm text-muted-foreground">Activated</dt>
                  <dd>{formatTime(alert.activated_at)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Cleared</dt>
                  <dd>{formatTime(alert.cleared_at)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Acknowledged
                  </dt>
                  <dd>{formatTime(alert.acknowledged_at)}</dd>
                </div>
              </dl>
              <RequestError error={acknowledge.error} />
              {capabilities.manage && !alert.acknowledged_at ? (
                <Button
                  className="self-start"
                  disabled={acknowledge.isPending}
                  onClick={() => acknowledge.mutate()}
                >
                  {acknowledge.isPending
                    ? "Acknowledging…"
                    : "Acknowledge alert"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
              <CardDescription>
                Record checks and follow-up for this episode.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RequestError error={comments.error} />
              {comments.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : comments.data?.data.length ? (
                <ul className="flex flex-col gap-4">
                  {comments.data.data.map((item) => (
                    <li key={item.uuid}>
                      <p className="whitespace-pre-wrap break-words">
                        {item.body}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.author_name} · {formatTime(item.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : !comments.error ? (
                <p className="text-sm text-muted-foreground">
                  No comments yet.
                </p>
              ) : null}
              <DevicePages
                meta={comments.data?.meta}
                label="Comments"
                onPage={setPage}
              />
              {capabilities.manage ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addComment.mutate();
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="alert-comment">
                        Add a comment
                      </FieldLabel>
                      <Textarea
                        id="alert-comment"
                        required
                        maxLength={5000}
                        disabled={addComment.isPending}
                        value={comment.body}
                        onChange={(event) =>
                          setComment({
                            uuid: crypto.randomUUID(),
                            body: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <RequestError error={addComment.error} />
                  </FieldGroup>
                  <Button
                    className="self-start"
                    disabled={addComment.isPending || !comment.body.trim()}
                  >
                    {addComment.isPending ? "Adding…" : "Add comment"}
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
          {capabilities.manage ? (
            <Card>
              <CardHeader>
                <CardTitle>Email delivery</CardTitle>
                <CardDescription>
                  Email is opt-in. Delivery failures do not stop rule
                  evaluation.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <RequestError error={deliveries.error} />
                {deliveries.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : deliveries.data?.data.length ? (
                  <ul className="flex flex-col gap-3">
                    {deliveries.data.data.map((item) => (
                      <li
                        key={item.uuid}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Badge variant="secondary">{item.status}</Badge>
                        <span>
                          {item.recipient_name} ·{" "}
                          {item.type === "activated"
                            ? "Activation"
                            : "Recovery"}{" "}
                          · {item.attempts} attempt
                          {item.attempts === 1 ? "" : "s"}
                        </span>
                        {item.diagnostic ? (
                          <p className="w-full text-sm text-muted-foreground">
                            {item.diagnostic}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : !deliveries.error ? (
                  <p className="text-sm text-muted-foreground">
                    No email deliveries were requested for this episode.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
