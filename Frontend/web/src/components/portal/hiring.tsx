"use client";
/**
 * Recruitment pieces shared by the hiring screens (Phase 3 WP29).
 */
import {
  ActionMessage,
  FormButtons,
  Modal,
  useAction,
} from "@/components/portal/kit";
import { useState } from "react";
import {
  Badge,
  Field,
  Input,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  APPLICANT_SOURCES,
  APPLICATION_STATE_COLOR,
  EMPLOYMENT_TYPES,
  OFFER_STATE_COLOR,
  OPENING_STATE_COLOR,
  POSITION_STATE_COLOR,
  type ApplicationState,
  type JobOpeningState,
  type OfferState,
  type PositionRequestState,
} from "@/lib/hiring-types";
import type {
  Branch,
  Department,
  Designation,
  Grade,
} from "@/lib/portal-types";

export function AppStateBadge({ state }: { state: ApplicationState }) {
  const { t } = useI18n();
  return (
    <Badge color={APPLICATION_STATE_COLOR[state]}>
      {t(`hr.appState.${state}`)}
    </Badge>
  );
}

export function OpeningStateBadge({ state }: { state: JobOpeningState }) {
  const { t } = useI18n();
  return (
    <Badge color={OPENING_STATE_COLOR[state]}>
      {t(`hr.opening.state.${state}`)}
    </Badge>
  );
}

export function PositionStateBadge({ state }: { state: PositionRequestState }) {
  const { t } = useI18n();
  return (
    <Badge color={POSITION_STATE_COLOR[state]}>{t(`hr.state.${state}`)}</Badge>
  );
}

export function OfferStateBadge({ state }: { state: OfferState }) {
  const { t } = useI18n();
  return (
    <Badge color={OFFER_STATE_COLOR[state]}>{t(`hr.offerState.${state}`)}</Badge>
  );
}

/** Date and time in Dhaka, in the reader's language. */
export function useWhen() {
  const { lang } = useI18n();
  return (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
          timeZone: "Asia/Dhaka",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(iso))
      : "—";
}

/** A Dept Head asking for one more post (or HR asking for someone). */
export function PositionRequestDialog({
  companyId,
  onClose,
  onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const branches = useApi<Branch[]>(`/companies/${companyId}/branches`);
  const departments = useApi<Department[]>(
    `/companies/${companyId}/departments`,
  );
  const designations = useApi<Designation[]>(
    `/companies/${companyId}/designations`,
  );
  const grades = useApi<Grade[]>(`/companies/${companyId}/grades`);
  const [f, setF] = useState({
    departmentId: "",
    designationId: "",
    gradeId: "",
    branchId: "",
    employmentType: "permanent",
    headcount: "1",
    reason: "",
  });
  return (
    <Modal title={t("hr.newPosition")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await save.run(() =>
            api.post<{ id: string }>(
              `/companies/${companyId}/position-requests`,
              { ...f, headcount: Number(f.headcount) },
            ),
          );
          if (created && typeof created === "object") onDone(created.id);
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("hr.department")}>
            <Select
              required
              id="pos-dept"
              value={f.departmentId}
              onChange={(e) => setF({ ...f, departmentId: e.target.value })}
            >
              <option value="">—</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hr.designation")}>
            <Select
              required
              id="pos-desig"
              value={f.designationId}
              onChange={(e) => setF({ ...f, designationId: e.target.value })}
            >
              <option value="">—</option>
              {(designations.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hr.grade")}>
            <Select
              required
              id="pos-grade"
              value={f.gradeId}
              onChange={(e) => setF({ ...f, gradeId: e.target.value })}
            >
              <option value="">—</option>
              {(grades.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hr.branch")}>
            <Select
              required
              id="pos-branch"
              value={f.branchId}
              onChange={(e) => setF({ ...f, branchId: e.target.value })}
            >
              <option value="">—</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hr.employmentType")}>
            <Select
              id="pos-type"
              value={f.employmentType}
              onChange={(e) => setF({ ...f, employmentType: e.target.value })}
            >
              {EMPLOYMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`hr.type.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hr.headcount")}>
            <Input
              required
              type="number"
              min={1}
              id="pos-count"
              value={f.headcount}
              onChange={(e) => setF({ ...f, headcount: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t("hr.reason")}>
          <TextArea
            required
            rows={3}
            maxLength={2000}
            id="pos-reason"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("hr.newPosition")}
        />
      </form>
    </Modal>
  );
}

/** HR turning an approved post into an opening people can apply for. */
export function OpeningDialog({
  positionRequestId,
  defaultPosts,
  onClose,
  onDone,
}: {
  positionRequestId: string;
  defaultPosts: number;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    title: "",
    titleBn: "",
    description: "",
    requirements: "",
    openings: String(defaultPosts),
    closingOn: "",
  });
  return (
    <Modal title={t("hr.openOpening")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await save.run(() =>
            api.post<{ id: string }>(
              `/position-requests/${positionRequestId}/opening`,
              {
                title: f.title,
                ...(f.titleBn ? { titleBn: f.titleBn } : {}),
                description: f.description,
                requirements: f.requirements
                  .split("\n")
                  .map((r) => r.trim())
                  .filter(Boolean),
                openings: Number(f.openings),
                ...(f.closingOn ? { closingOn: f.closingOn } : {}),
              },
            ),
          );
          if (created && typeof created === "object") onDone(created.id);
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("hr.title")}>
          <Input
            required
            maxLength={200}
            id="opening-title"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <Field label={t("hr.titleBn")}>
          <Input
            maxLength={200}
            id="opening-title-bn"
            value={f.titleBn}
            onChange={(e) => setF({ ...f, titleBn: e.target.value })}
          />
        </Field>
        <Field label={t("hr.description")}>
          <TextArea
            required
            rows={3}
            maxLength={5000}
            id="opening-description"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <Field label={t("hr.requirements")} hint={t("hr.requirementsHint")}>
          <TextArea
            required
            rows={4}
            id="opening-requirements"
            value={f.requirements}
            onChange={(e) => setF({ ...f, requirements: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("hr.posts")}>
            <Input
              required
              type="number"
              min={1}
              id="opening-posts"
              value={f.openings}
              onChange={(e) => setF({ ...f, openings: e.target.value })}
            />
          </Field>
          <Field label={t("hr.closingOn")}>
            <Input
              type="date"
              id="opening-closing"
              value={f.closingOn}
              onChange={(e) => setF({ ...f, closingOn: e.target.value })}
            />
          </Field>
        </div>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("hr.openOpening")}
        />
      </form>
    </Modal>
  );
}

/** A new applicant, with the consent that lets the CV be kept at all. */
export function ApplicantDialog({
  companyId,
  openingId,
  onClose,
  onDone,
}: {
  companyId: string;
  /** When set, the applicant is added and applied to this opening in one go. */
  openingId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    fullNameEn: "",
    fullNameBn: "",
    phone: "",
    email: "",
    district: "",
    dateOfBirth: "",
    gender: "",
    source: "website",
    sourceDetail: "",
    cvText: "",
  });
  const [consent, setConsent] = useState(false);
  return (
    <Modal title={t("hr.newApplicant")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await save.run(async () => {
            const applicant = await api.post<{ id: string }>(
              `/companies/${companyId}/applicants`,
              {
                fullNameEn: f.fullNameEn,
                ...(f.fullNameBn ? { fullNameBn: f.fullNameBn } : {}),
                ...(f.phone ? { phone: f.phone } : {}),
                ...(f.email ? { email: f.email } : {}),
                ...(f.district ? { district: f.district } : {}),
                ...(f.dateOfBirth ? { dateOfBirth: f.dateOfBirth } : {}),
                ...(f.gender ? { gender: f.gender } : {}),
                source: f.source,
                ...(f.sourceDetail ? { sourceDetail: f.sourceDetail } : {}),
                ...(f.cvText ? { cvText: f.cvText } : {}),
                consent,
              },
            );
            if (openingId)
              await api.post(`/job-openings/${openingId}/applications`, {
                applicantId: applicant.id,
              });
            return applicant;
          }, t("hr.saved"));
          if (created) onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("hr.name")}>
            <Input
              required
              maxLength={200}
              id="app-name"
              value={f.fullNameEn}
              onChange={(e) => setF({ ...f, fullNameEn: e.target.value })}
            />
          </Field>
          <Field label={t("hr.nameBn")}>
            <Input
              maxLength={200}
              id="app-name-bn"
              value={f.fullNameBn}
              onChange={(e) => setF({ ...f, fullNameBn: e.target.value })}
            />
          </Field>
          <Field label={t("hr.phone")}>
            <Input
              id="app-phone"
              placeholder="01711-223344"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </Field>
          <Field label={t("hr.email")}>
            <Input
              type="email"
              id="app-email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label={t("hr.district")}>
            <Input
              id="app-district"
              value={f.district}
              onChange={(e) => setF({ ...f, district: e.target.value })}
            />
          </Field>
          <Field label={t("hr.dateOfBirth")}>
            <Input
              type="date"
              id="app-dob"
              value={f.dateOfBirth}
              onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })}
            />
          </Field>
          <Field label={t("hr.gender")}>
            <Select
              id="app-gender"
              value={f.gender}
              onChange={(e) => setF({ ...f, gender: e.target.value })}
            >
              <option value="">—</option>
              {(["male", "female", "other"] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`hr.gender.${g}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hr.source")}>
            <Select
              id="app-source"
              value={f.source}
              onChange={(e) => setF({ ...f, source: e.target.value })}
            >
              {APPLICANT_SOURCES.map((x) => (
                <option key={x} value={x}>
                  {t(`hr.source.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("hr.cvText")} hint={t("hr.cvTextHint")}>
          <TextArea
            rows={6}
            id="app-cv-text"
            value={f.cvText}
            onChange={(e) => setF({ ...f, cvText: e.target.value })}
          />
        </Field>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            required
            className="mt-1"
            id="app-consent"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            {t("hr.consent")}
            <span className="block text-xs text-slate-500">
              {t("hr.consentHint")}
            </span>
          </span>
        </label>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("hr.newApplicant")}
        />
      </form>
    </Modal>
  );
}
