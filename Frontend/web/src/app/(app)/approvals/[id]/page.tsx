"use client";
/**
 * One request: what is asked (the snapshot the approver decides on), its
 * history, and approve / return / reject. Returning or rejecting needs a comment.
 */
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  ErrorBox,
  Field,
  Loading,
  PageTitle,
  Row,
  TextArea,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ApprovalRequest } from "@/lib/types";

/** "availableBefore" -> "Available before"; ids are not shown. */
function snapshotRows(
  snapshot: Record<string, unknown>,
): Array<[string, string]> {
  return Object.entries(snapshot)
    .filter(
      ([key, value]) =>
        !/(^id$|Id$)/.test(key) &&
        value !== null &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0),
    )
    .map(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase());
      const text =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      return [label, text];
    });
}

export default function ApprovalRequestPage({
  params,
}: PageProps<"/approvals/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<ApprovalRequest>(
    `/approvals/requests/${id}`,
  );
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "return" | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject" | "return") {
    if (decision !== "approve" && !comment.trim()) {
      setProblem(t("appr.commentRequired"));
      return;
    }
    setBusy(decision);
    setProblem(null);
    try {
      await api.post(
        `/approvals/requests/${id}/${decision}`,
        comment.trim() ? { comment: comment.trim() } : {},
      );
      router.push("/approvals");
    } catch (e) {
      setProblem((e as ApiError).message);
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (error || !data)
    return <ErrorBox error={error ?? new Error("")} onRetry={reload} />;
  const open = data.state === "in_approval";

  return (
    <div className="space-y-4">
      <PageTitle
        action={
          <ButtonLink href="/approvals" variant="ghost">
            {t("common.back")}
          </ButtonLink>
        }
      >
        {t(`appr.type.${data.requestType}`)}
      </PageTitle>

      <Card>
        <p className="mb-2 font-semibold">{data.summary}</p>
        <Badge color={open ? "amber" : "gray"}>{data.state}</Badge>
      </Card>

      <Card>
        <CardTitle>{t("appr.details")}</CardTitle>
        {snapshotRows(data.snapshot).map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </Card>

      <Card>
        <CardTitle>{t("appr.history")}</CardTitle>
        <ul className="space-y-2 text-sm">
          {data.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>
                <span className="font-medium">{h.action}</span>
                {h.comment && (
                  <span className="block text-slate-600">“{h.comment}”</span>
                )}
              </span>
              <span className="shrink-0 text-slate-500 tabular-nums">
                {formatDate(h.at.slice(0, 10), lang, { short: true })}{" "}
                {formatTime(h.at, lang)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {open && (
        <Card>
          {problem && <Alert kind="error">{problem}</Alert>}
          <Field label={t("appr.comment")}>
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
            />
          </Field>
          <Button
            className="mb-2 w-full py-3"
            busy={busy === "approve"}
            onClick={() => decide("approve")}
          >
            {t("appr.approve")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              busy={busy === "return"}
              onClick={() => decide("return")}
            >
              {t("appr.return")}
            </Button>
            <Button
              variant="danger"
              busy={busy === "reject"}
              onClick={() => decide("reject")}
            >
              {t("appr.reject")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
