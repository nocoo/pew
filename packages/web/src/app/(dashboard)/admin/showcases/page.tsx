/**
 * Admin → Showcases moderation page.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { AdminShowcasesContent } from "./admin-showcases-content";

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
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Showcase Moderation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and moderate community-submitted GitHub showcases.
        </p>
      </div>

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
