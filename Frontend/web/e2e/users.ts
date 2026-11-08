/** Demo users the tasks run as; their sessions are saved by auth.setup.ts. */
export const USERS = {
  rafi: { login: "rafi@demo.test", state: "e2e/.auth/rafi.json" },
  tanvir: { login: "tanvir.hossain@demo.test", state: "e2e/.auth/tanvir.json" },
  // HR & Admin portal (WP13)
  farzana: {
    login: "farzana.akter@demo.test",
    state: "e2e/.auth/farzana.json",
  },
  sujit: { login: "sujit.das@demo.test", state: "e2e/.auth/sujit.json" },
  // the MD (Admin): approves payroll and reads salaries
  anisur: { login: "anisur.rahman@demo.test", state: "e2e/.auth/anisur.json" },
  // finance (Phase 2): the workspace owner is the second Accounts user (checker)
  owner: { login: "admin@demo.test", state: "e2e/.auth/owner.json" },
};
