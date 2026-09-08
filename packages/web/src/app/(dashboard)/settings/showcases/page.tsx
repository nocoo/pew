/**
 * Settings → Showcases page.
 *
 * Manage your submitted showcases.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { MyShowcasesContent } from "./my-showcases-content";
import { PageHeader } from "@nocoo/basalt/components/page-header";

export const metadata = {
  title: "My Showcases | Settings | pew",
  description: "Manage your submitted GitHub showcases.",
};

export default async function MyShowcasesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Showcases"
        description="Manage your submitted GitHub projects."
      />

      <Suspense
        fallback={
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-secondary" />
            ))}
          </div>
        }
      >
        <MyShowcasesContent />
      </Suspense>
    </div>
  );
}
