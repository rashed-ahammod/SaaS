/**
 * Text of the HR / Admin portal (WP13), Bangla and English, keys "p.*". One
 * file per area; each Bangla dictionary must have every key of its English one
 * (TypeScript checks it). Merged into the app's translator (i18n.tsx).
 */
import * as admin from "./admin";
import * as common from "./common";
import * as finance from "./finance";
import * as guide from "./guide";
import * as payroll from "./payroll";
import * as people from "./people";
import * as time from "./time";

const areas = [common, people, payroll, time, admin, finance, guide];

export const PORTAL_TEXT = {
  en: Object.assign({}, ...areas.map((a) => a.en)) as Record<string, string>,
  bn: Object.assign({}, ...areas.map((a) => a.bn)) as Record<string, string>,
};
