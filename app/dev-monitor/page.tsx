import { notFound } from "next/navigation";

import { devMonitorPageGuard } from "../../lib/dev-monitor-guard";
import DevMonitorClient from "../components/DevMonitorClient";

export const dynamic = "force-dynamic";

export default async function DevMonitorPage() {
  const access = await devMonitorPageGuard();
  if (!access) notFound();
  return <DevMonitorClient userId={access.userId} />;
}
