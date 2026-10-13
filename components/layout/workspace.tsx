"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Workspace context — the authenticated org/user/branch/terminal state
 * shared by all client pages. Branch and terminal selections persist per
 * browser (operators keep their station between refreshes).
 */

export interface WorkspaceBranch {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

export interface WorkspaceTerminal {
  id: string;
  name: string;
  code: string;
  kind: string;
  branchId: string;
}

export interface WorkspaceOrg {
  id: string;
  name: string;
  demo: boolean;
  industry: string;
  industryLabel: string;
  posMode: "retail" | "hospitality";
  currency: string;
  locale: string;
  timezone: string;
  pricesIncludeTax: boolean;
  defaultTaxBps: number;
  settings: Record<string, unknown>;
  onboarded: boolean;
}

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  branchIds: string[] | null;
}

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  section: "operate" | "manage" | "analyze" | "configure";
  order: number;
  moduleId: string;
}

interface WorkspaceValue {
  user: WorkspaceUser;
  org: WorkspaceOrg;
  modules: string[];
  navigation: NavItem[];
  branches: WorkspaceBranch[];
  terminals: WorkspaceTerminal[];
  branchId: string;
  setBranchId: (id: string) => void;
  terminalId: string | null;
  setTerminalId: (id: string | null) => void;
  can: (permission: string) => boolean;
  moduleEnabled: (moduleId: string) => boolean;
  refreshWorkspace: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export interface WorkspaceBootstrap {
  user: WorkspaceUser;
  org: WorkspaceOrg;
  modules: string[];
  navigation: NavItem[];
  branches: WorkspaceBranch[];
  terminals: WorkspaceTerminal[];
}

export function WorkspaceProvider({
  bootstrap,
  children,
}: {
  bootstrap: WorkspaceBootstrap;
  children: ReactNode;
}) {
  const [data, setData] = useState<WorkspaceBootstrap>(bootstrap);
  const [branchId, setBranchIdState] = useState<string>(() => {
    if (typeof window === "undefined") return bootstrap.branches[0]?.id ?? "";
    const stored = localStorage.getItem("vantyx-branch");
    const valid = bootstrap.branches.some((b) => b.id === stored);
    return valid ? stored! : bootstrap.branches[0]?.id ?? "";
  });
  const [terminalId, setTerminalIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("vantyx-terminal");
    return bootstrap.terminals.some((t) => t.id === stored) ? stored : null;
  });

  useEffect(() => {
    if (branchId) localStorage.setItem("vantyx-branch", branchId);
  }, [branchId]);
  useEffect(() => {
    if (terminalId) localStorage.setItem("vantyx-terminal", terminalId);
  }, [terminalId]);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    // Reset terminal when switching branches
    setTerminalIdState((current) => {
      const belongs = data.terminals.find((t) => t.id === current);
      return belongs && belongs.branchId === id ? current : null;
    });
  }, [data.terminals]);

  const refreshWorkspace = useCallback(async () => {
    const res = await fetch("/api/auth/me");
    const json = (await res.json()) as { ok: boolean; data: WorkspaceBootstrap & { authenticated: boolean } };
    if (json.ok && json.data.authenticated) {
      const { authenticated: _a, ...rest } = json.data;
      void _a;
      setData(rest);
    }
  }, []);

  const permissions = useMemo(() => new Set(data.user.permissions), [data.user.permissions]);
  const moduleSet = useMemo(() => new Set(data.modules), [data.modules]);

  const value: WorkspaceValue = {
    user: data.user,
    org: data.org,
    modules: data.modules,
    navigation: data.navigation,
    branches: data.branches,
    terminals: data.terminals,
    branchId,
    setBranchId,
    terminalId,
    setTerminalId: setTerminalIdState,
    can: (p) => permissions.has(p),
    moduleEnabled: (m) => moduleSet.has(m),
    refreshWorkspace,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
