/**
 * Admin → Showcases moderation page.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { AdminShowcasesContent } from "./admin-showcases-content";
import { PageHeader } from "@nocoo/basalt/components/page-header";

export const metadata = {
  title: "Showcase Moderation | Admin | pew",
  description: "Moderate community-submitted showcases.",
};

export default async function AdminShowcasesPage() {
  const session = await auth();
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    redirect("/");
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Showcase Moderation"
        description="Review and moderate community-submitted GitHub showcases."
      />

      <Suspense
        fallback={
          <div className="rounded-xl bg-secondary p-1 animate-pulse">
            <div className="h-64" />
          </div>
        }
      >
        <AdminShowcasesContent />
      </Suspense>
    </div>
  );
}
