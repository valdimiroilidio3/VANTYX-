"use client";

/**
 * /settings — organization settings hub: profile & safe industry change,
 * module registry, team & access, multi-branch structure, approvals queue
 * and the immutable audit trail.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SettingsNav, type SettingsTabId } from "@/components/settings/settings-nav";
import { ProfileTab } from "@/components/settings/profile-tab";
import { ModulesTab } from "@/components/settings/modules-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { StructureTab } from "@/components/settings/structure-tab";
import { ApprovalsTab } from "@/components/settings/approvals-tab";
import { AuditTab } from "@/components/settings/audit-tab";

const VALID_TABS: SettingsTabId[] = ["profile", "modules", "team", "structure", "approvals", "audit"];

function SettingsBody() {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<SettingsTabId>(
    initial && VALID_TABS.includes(initial as SettingsTabId) ? (initial as SettingsTabId) : "profile",
  );

  return (
    <div>
      <PageHeader title="Definições" subtitle="Perfil da organização, módulos, equipa, estrutura, aprovações e auditoria." />
      <div className="p-4">
        <SettingsNav tab={tab} onTab={setTab} />
        {tab === "profile" && <ProfileTab />}
        {tab === "modules" && <ModulesTab />}
        {tab === "team" && <TeamTab />}
        {tab === "structure" && <StructureTab />}
        {tab === "approvals" && <ApprovalsTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-8 text-graphite-400">
          <Settings className="h-5 w-5 animate-pulse" /> A carregar definições…
        </div>
      }
    >
      <SettingsBody />
    </Suspense>
  );
}
