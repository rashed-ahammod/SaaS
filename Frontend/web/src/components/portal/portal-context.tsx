"use client";
/**
 * What every portal screen needs: the selected company (most tenants have one;
 * a group switches between them) and can(...) for showing what the user's
 * roles allow. The API still checks every request; hiding is only convenience.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export interface Company {
  id: string;
  legalName: string;
  shortName: string | null;
  employeeCodePrefix: string;
}

interface Portal {
  companies: Company[];
  company: Company | null;
  setCompanyId: (id: string) => void;
  /** Holds at least one of the permissions. */
  can: (...permissions: string[]) => boolean;
  reloadCompanies: () => Promise<void>;
}

const PortalContext = createContext<Portal | null>(null);
const STORAGE_KEY = "erp-portal-company";

export function PortalProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyIdState] = useState<string | null>(null);

  const reloadCompanies = useCallback(async () => {
    const list = await api
      .get<Company[]>("/companies")
      .catch(() => [] as Company[]);
    setCompanies(list);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage blocked: use the first company
    }
    setCompanyIdState(
      (current) =>
        current ??
        (list.some((c) => c.id === saved) ? saved : (list[0]?.id ?? null)),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the company list is loaded once, after mount
    void reloadCompanies();
  }, [reloadCompanies]);

  const value = useMemo<Portal>(
    () => ({
      companies,
      company: companies.find((c) => c.id === companyId) ?? null,
      setCompanyId: (id: string) => {
        setCompanyIdState(id);
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // not remembered; fine
        }
      },
      can: (...permissions: string[]) =>
        permissions.some((p) => me.permissions?.includes(p)),
      reloadCompanies,
    }),
    [companies, companyId, me.permissions, reloadCompanies],
  );
  return (
    <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
  );
}

export function usePortal(): Portal {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal outside PortalProvider");
  return ctx;
}

/** Permissions that open the portal (anything beyond self-service). */
export const BACK_OFFICE = [
  "employee.manage",
  "org.structure.manage",
  "users.manage",
  "attendance.manage",
  "attendance.view",
  "leave.manage",
  "payroll.prepare",
  "payroll.verify",
  "payroll.approve",
  "payroll.disburse",
  "data.import",
  "data.import.sign_off",
  "ai.manage",
  "ai.policies.manage",
  "audit.view",
  "integrations.manage",
  "ledger.view",
  "payables.view",
  "expenses.view",
  "procurement.view",
  "budgets.view",
  "assets.view",
  "stock.view",
  "bank.view",
  "vat.view",
  "compliance.view",
  "receivables.view",
  "crm.own",
  "crm.view",
  "crm.credit",
  "sales.catalogue",
];
