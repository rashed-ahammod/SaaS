"use client";
/**
 * The company's structure (branches, departments, designations, grades) for pickers and labels.
 *
 * A retired (inactive) branch, department, designation or grade still appears on
 * old records, and the API still returns it, but it must not be offered when
 * somebody is hired or transferred — the API refuses it with "refers to an
 * inactive record". So the pickers get the active ones only; the Organization
 * screen, which is where retiring happens, asks for everything.
 */
import { useApi } from "@/lib/api";
import type {
  Branch,
  Department,
  Designation,
  Grade,
} from "@/lib/portal-types";

export function useOrg(
  companyId: string | undefined,
  options: { includeInactive?: boolean } = {},
) {
  const c = companyId ? `/companies/${companyId}` : null;
  const branches = useApi<Branch[]>(c && `${c}/branches`);
  const departments = useApi<Department[]>(c && `${c}/departments`);
  const designations = useApi<Designation[]>(c && `${c}/designations`);
  const grades = useApi<Grade[]>(c && `${c}/grades`);
  const keep = <T extends { isActive?: boolean }>(rows: T[] | undefined) =>
    (rows ?? []).filter((r) => options.includeInactive || r.isActive !== false);
  return {
    branches: keep(branches.data),
    departments: keep(departments.data),
    designations: keep(designations.data),
    grades: keep(grades.data),
    loading:
      branches.loading ||
      departments.loading ||
      designations.loading ||
      grades.loading,
    reload: () => {
      branches.reload();
      departments.reload();
      designations.reload();
      grades.reload();
    },
  };
}
