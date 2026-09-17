import { AppShell } from "@/components/layout/app-shell";
import { CliUpgradeNotice } from "@/components/dashboard/cli-upgrade-notice";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell><CliUpgradeNotice />{children}</AppShell>;
}
