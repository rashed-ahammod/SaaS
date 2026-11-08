/** Shapes of the CRM API (Phase 3 WP23 customers and leads, WP24 opportunities and targets). */

export type LeadSource =
  | "web_form"
  | "facebook"
  | "referral"
  | "call"
  | "walk_in"
  | "manual"
  | "other";
export type LeadState = "new" | "contacted" | "qualified" | "disqualified";
export type CustomerType =
  "dealer" | "distributor" | "retail" | "corporate" | "government" | "export";

export const LEAD_SOURCES: LeadSource[] = [
  "walk_in",
  "call",
  "referral",
  "web_form",
  "facebook",
  "manual",
  "other",
];
export const CUSTOMER_TYPES: CustomerType[] = [
  "dealer",
  "distributor",
  "retail",
  "corporate",
  "government",
  "export",
];
export const LEAD_STATE_COLOR = {
  new: "blue",
  contacted: "amber",
  qualified: "green",
  disqualified: "gray",
} as const;

/** The 64 districts, as the API stores them. */
export const DISTRICTS = [
  "Bagerhat",
  "Bandarban",
  "Barguna",
  "Barishal",
  "Bhola",
  "Bogura",
  "Brahmanbaria",
  "Chandpur",
  "Chapainawabganj",
  "Chattogram",
  "Chuadanga",
  "Cox's Bazar",
  "Cumilla",
  "Dhaka",
  "Dinajpur",
  "Faridpur",
  "Feni",
  "Gaibandha",
  "Gazipur",
  "Gopalganj",
  "Habiganj",
  "Jamalpur",
  "Jashore",
  "Jhalokathi",
  "Jhenaidah",
  "Joypurhat",
  "Khagrachhari",
  "Khulna",
  "Kishoreganj",
  "Kurigram",
  "Kushtia",
  "Lakshmipur",
  "Lalmonirhat",
  "Madaripur",
  "Magura",
  "Manikganj",
  "Meherpur",
  "Moulvibazar",
  "Munshiganj",
  "Mymensingh",
  "Naogaon",
  "Narail",
  "Narayanganj",
  "Narsingdi",
  "Natore",
  "Netrokona",
  "Nilphamari",
  "Noakhali",
  "Pabna",
  "Panchagarh",
  "Patuakhali",
  "Pirojpur",
  "Rajbari",
  "Rajshahi",
  "Rangamati",
  "Rangpur",
  "Satkhira",
  "Shariatpur",
  "Sherpur",
  "Sirajganj",
  "Sunamganj",
  "Sylhet",
  "Tangail",
  "Thakurgaon",
];

/** Bangla names of the districts (same as the API's crm-rules.ts), for the public enquiry form. */
export const DISTRICT_BN: Record<string, string> = {
  Bagerhat: "বাগেরহাট",
  Bandarban: "বান্দরবান",
  Barguna: "বরগুনা",
  Barishal: "বরিশাল",
  Bhola: "ভোলা",
  Bogura: "বগুড়া",
  Brahmanbaria: "ব্রাহ্মণবাড়িয়া",
  Chandpur: "চাঁদপুর",
  Chapainawabganj: "চাঁপাইনবাবগঞ্জ",
  Chattogram: "চট্টগ্রাম",
  Chuadanga: "চুয়াডাঙ্গা",
  "Cox's Bazar": "কক্সবাজার",
  Cumilla: "কুমিল্লা",
  Dhaka: "ঢাকা",
  Dinajpur: "দিনাজপুর",
  Faridpur: "ফরিদপুর",
  Feni: "ফেনী",
  Gaibandha: "গাইবান্ধা",
  Gazipur: "গাজীপুর",
  Gopalganj: "গোপালগঞ্জ",
  Habiganj: "হবিগঞ্জ",
  Jamalpur: "জামালপুর",
  Jashore: "যশোর",
  Jhalokathi: "ঝালকাঠি",
  Jhenaidah: "ঝিনাইদহ",
  Joypurhat: "জয়পুরহাট",
  Khagrachhari: "খাগড়াছড়ি",
  Khulna: "খুলনা",
  Kishoreganj: "কিশোরগঞ্জ",
  Kurigram: "কুড়িগ্রাম",
  Kushtia: "কুষ্টিয়া",
  Lakshmipur: "লক্ষ্মীপুর",
  Lalmonirhat: "লালমনিরহাট",
  Madaripur: "মাদারীপুর",
  Magura: "মাগুরা",
  Manikganj: "মানিকগঞ্জ",
  Meherpur: "মেহেরপুর",
  Moulvibazar: "মৌলভীবাজার",
  Munshiganj: "মুন্সিগঞ্জ",
  Mymensingh: "ময়মনসিংহ",
  Naogaon: "নওগাঁ",
  Narail: "নড়াইল",
  Narayanganj: "নারায়ণগঞ্জ",
  Narsingdi: "নরসিংদী",
  Natore: "নাটোর",
  Netrokona: "নেত্রকোনা",
  Nilphamari: "নীলফামারী",
  Noakhali: "নোয়াখালী",
  Pabna: "পাবনা",
  Panchagarh: "পঞ্চগড়",
  Patuakhali: "পটুয়াখালী",
  Pirojpur: "পিরোজপুর",
  Rajbari: "রাজবাড়ী",
  Rajshahi: "রাজশাহী",
  Rangamati: "রাঙ্গামাটি",
  Rangpur: "রংপুর",
  Satkhira: "সাতক্ষীরা",
  Shariatpur: "শরীয়তপুর",
  Sherpur: "শেরপুর",
  Sirajganj: "সিরাজগঞ্জ",
  Sunamganj: "সুনামগঞ্জ",
  Sylhet: "সিলেট",
  Tangail: "টাঙ্গাইল",
  Thakurgaon: "ঠাকুরগাঁও",
};

export interface Activity {
  id: string;
  leadId: string | null;
  customerId: string | null;
  kind: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  doneAt: string | null;
  ownerId: string | null;
  createdAt: string;
  byName?: string | null;
  lead?: string | null;
  customer?: string | null;
}

export interface Lead {
  id: string;
  number: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  district: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  message: string | null;
  ownerId: string;
  ownerName?: string | null;
  state: LeadState;
  disqualifyReason: string | null;
  customerId: string | null;
  createdAt: string;
  version: number;
  lastActivityAt?: string | null;
  territory?: string | null;
  canWork?: boolean;
  activities?: Activity[];
  opportunities?: OpportunityBrief[];
}

export interface Customer {
  id: string;
  code: string;
  kind: "company" | "person";
  name: string;
  nameBn: string | null;
  customerType: CustomerType;
  bin: string | null;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  district: string | null;
  accountManagerId: string | null;
  managerName?: string | null;
  paymentTermsDays: number;
  creditLimit: string;
  isActive: boolean;
  version: number;
  canWork?: boolean;
  canSetCredit?: boolean;
  contacts?: Array<{
    id: string;
    name: string;
    designation: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
  }>;
  leads?: Array<{
    id: string;
    number: string;
    source: LeadSource;
    createdAt: string;
  }>;
  activities?: Activity[];
  opportunities?: OpportunityBrief[];
}

export interface Territory {
  id: string;
  code: string;
  name: string;
  districts: string[];
  isActive: boolean;
  version: number;
  members: Array<{ userId: string; name: string }>;
}

export interface Salesperson {
  userId: string;
  name: string;
  employeeCode: string | null;
}

// ---------------------------------------------------------------- WP24

export type OpportunityState = "open" | "won" | "lost";
export type LostReason =
  | "price"
  | "competitor"
  | "no_budget"
  | "no_response"
  | "timing"
  | "product_fit"
  | "other";
export const LOST_REASONS: LostReason[] = [
  "price",
  "competitor",
  "no_budget",
  "no_response",
  "timing",
  "product_fit",
  "other",
];
export const OPP_STATE_COLOR = {
  open: "blue",
  won: "green",
  lost: "gray",
} as const;

export interface Stage {
  id: string;
  name: string;
  nameBn: string | null;
  sortOrder: number;
  probability: number;
  isActive: boolean;
  version: number;
  openCount?: number;
  canManage?: boolean;
}

export interface OpportunityBrief {
  id: string;
  number: string;
  title: string;
  state: OpportunityState;
  value: string;
  probability: number;
  expectedCloseOn: string;
  closedOn: string | null;
  stageName: string;
  stageNameBn: string | null;
}

export interface Opportunity {
  id: string;
  number: string;
  title: string;
  customerId: string;
  leadId: string | null;
  ownerId: string;
  stageId: string;
  state: OpportunityState;
  value: string;
  probability: number;
  weighted: string;
  expectedCloseOn: string;
  closedOn: string | null;
  lostReason: LostReason | null;
  closeNote: string | null;
  version: number;
  stageName: string;
  stageNameBn: string | null;
  ownerName: string | null;
}

/** GET /opportunities?... */
export interface OpportunityRow extends Opportunity {
  customer: string;
}

/** GET /opportunities/:id */
export interface OpportunityDetail extends Opportunity {
  customer: { id: string; code: string; name: string };
  lead: { id: string; number: string } | null;
  canWork: boolean;
  history: Array<{
    id: string;
    fromStage: string | null;
    toStage: string;
    fromState: OpportunityState | null;
    toState: OpportunityState;
    value: string;
    probability: number;
    note: string | null;
    changedAt: string;
    byName: string | null;
  }>;
}

export interface Totals {
  count: number;
  value: string;
  weighted: string;
}

export interface Board {
  month: string;
  stages: Array<
    Totals & {
      id: string;
      name: string;
      nameBn: string | null;
      probability: number;
      opportunities: Array<{
        id: string;
        number: string;
        title: string;
        customer: string;
        ownerName: string;
        value: string;
        probability: number;
        weighted: string;
        expectedCloseOn: string;
        late: boolean;
      }>;
    }
  >;
  open: Totals;
  wonThisMonth: Totals;
  lostThisMonth: Totals;
}

export interface Forecast {
  from: string;
  to: string;
  months: Array<Totals & { month: string; won: string }>;
  byOwner: Array<Totals & { ownerId: string; name: string }>;
  byStage: Array<
    Totals & { stageId: string; name: string; nameBn: string | null }
  >;
  total: Totals;
  late: Totals;
  won: string;
}

export interface TargetRow {
  kind: "user" | "department";
  userId: string | null;
  departmentId: string | null;
  name: string;
  targetId: string | null;
  amount: string | null;
  won: string;
  expected: string;
  attainment: number | null;
  canSet: boolean;
}
