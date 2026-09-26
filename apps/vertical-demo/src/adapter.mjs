// The host owns these associations. No scan of good latitude records is used to
// guess a latest fix, and one selected alert is never represented as all alerts.
export async function loadEvidence(client, selection) {
  const [location, alert] = await Promise.allSettled([
    client.locationFix(selection.device, selection.event, selection.version),
    client.alert(selection.alert),
  ]);
  let alertData = null;
  if (alert.status === 'fulfilled' && alert.value.device_uuid === selection.device) {
    const episode = alert.value;
    alertData = {
      workflow_name: 'Selected episode · ' + episode.workflow_name,
      active: episode.condition === 'active' ? 1 : 0,
      unacknowledged_active: episode.condition === 'active' && !episode.acknowledged_at ? 1 : 0,
      total: 1, checked_at: new Date().toISOString(), recent: [episode],
    };
  }
  return {
    location: location.status === 'fulfilled' ? location.value : null,
    alert: alertData,
  };
}
