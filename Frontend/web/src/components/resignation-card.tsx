"use client";
/**
 * Resignation from the app (2026-10-30): hand it in with the proposed last working day; the
 * Dept Head, then HR approve; withdraw it while it waits. Shows the company's notice period
 * and how many days short the proposal is.
 */
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  Row,
  TextArea,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface MyResignation {
  status: string;
  lastWorkingDay: string | null;
  noticeDays: number;
  canResign: boolean;
  request: {
    lastWorkingDay: string;
    reason: string;
    state: string;
    noticeDate: string;
  } | null;
}

const COLOR: Record<string, "amber" | "green" | "red" | "gray"> = {
  in_approval: "amber",
  accepted: "green",
  rejected: "red",
  withdrawn: "gray",
};

export function ResignationCard() {
  const { t, lang } = useI18n();
  const mine = useApi<MyResignation>("/me/resignation");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ lastWorkingDay: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = mine.data;
  if (!d || (!d.canResign && !d.request)) return null;
  const today = dhakaToday();
  const given = f.lastWorkingDay
    ? Math.round(
        (Date.parse(`${f.lastWorkingDay}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      )
    : null;
  const short =
    given !== null && given < d.noticeDays ? d.noticeDays - given : 0;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setOpen(false);
      mine.reload();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t("rs.title")}</CardTitle>
      {error && <Alert kind="error">{error}</Alert>}
      {d.request && (
        <div className="mb-3">
          <p className="mb-1">
            <Badge color={COLOR[d.request.state]}>
              {t(`rs.state.${d.request.state}`)}
            </Badge>
          </p>
          <Row
            label={t("rs.lastDay")}
            value={formatDate(d.request.lastWorkingDay, lang)}
          />
          {d.request.state === "in_approval" && (
            <Button
              variant="ghost"
              className="mt-2 w-full"
              busy={busy}
              onClick={() => {
                const reason = window.prompt(t("rs.withdrawReason"));
                if (reason)
                  void act(() =>
                    api.post("/me/resignation/withdraw", { reason }),
                  );
              }}
            >
              {t("rs.withdraw")}
            </Button>
          )}
        </div>
      )}
      {d.canResign && !open && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          {t("rs.submit")}
        </Button>
      )}
      {d.canResign && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (window.confirm(t("rs.confirm")))
              void act(() => api.post("/me/resignation", f));
          }}
        >
          <p className="mb-3 text-sm text-slate-600">
            {t("rs.hint", { days: d.noticeDays })}
          </p>
          <Field label={t("rs.lastDay")}>
            <Input
              required
              type="date"
              min={today}
              value={f.lastWorkingDay}
              onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })}
              id="resign-last-day"
            />
          </Field>
          {short > 0 && (
            <Alert kind="warning">{t("rs.short", { days: short })}</Alert>
          )}
          <Field label={t("rs.reason")}>
            <TextArea
              required
              maxLength={1000}
              rows={3}
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
              id="resign-reason"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" busy={busy}>
              {t("rs.submit")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
