import type { Metadata } from "next";
import AdminClient from "./AdminClient";

export const metadata: Metadata = {
  title: "Administration — BDM AI",
  description: "System telemetry, security firewall, service mesh, and AI fleet control."
};

export default function AdminPage() {
  return <AdminClient />;
}
