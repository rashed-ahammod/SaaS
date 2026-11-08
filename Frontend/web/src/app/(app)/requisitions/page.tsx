"use client";
/** My purchase requests: what I asked for and where each one is; start a new one. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequisitionForm } from "@/components/requisition-form";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Empty,
  ErrorBox,
  Loading,
  PageTitle,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  REQ_STATE_COLOR,
  type RequisitionSummary,
} from "@/lib/procurement-types";
import { useSession } from "@/lib/session";

export default function RequisitionsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { profile } = useSession();
  const mine = useApi<RequisitionSummary[]>("/me/purchase-requisitions");
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <PageTitle>{t("pr.title")}</PageTitle>
      {creating && profile ? (
        <RequisitionForm
          companyId={profile.companyId}
          onCancel={() => setCreating(false)}
          onSaved={(id) => router.push(`/requisitions/${id}`)}
        />
      ) : (
        <Button className="w-full" onClick={() => setCreating(true)}>
          {t("pr.new")}
        </Button>
      )}
      <Card>
        <CardTitle>{t("pr.mine")}</CardTitle>
        {mine.loading ? (
          <Loading />
        ) : mine.error ? (
          <ErrorBox error={mine.error} onRetry={mine.reload} />
        ) : !mine.data?.length ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.data.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/requisitions/${r.id}`}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {r.title}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {r.number} ·{" "}
                      {formatDate(r.createdAt.slice(0, 10), lang, {
                        short: true,
                      })}{" "}
                      · {formatTaka(r.estimatedTotal, lang)}
                    </span>
                  </span>
                  <Badge color={REQ_STATE_COLOR[r.state]}>
                    {t(`pr.state.${r.state}`)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
