import type { Metadata } from "next";
import SettingsClient from "./SettingsClient";

export const metadata: Metadata = {
  title: "Settings — BDM",
  description: "Account, connections, and capability diagnostics for BDM."
};

export default function SettingsPage() {
  return <SettingsClient />;
}
