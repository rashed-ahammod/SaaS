"use client";
/** In-app messages (WP10): approvals waiting, payslips paid, leave decisions, attendance digests. */
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  IconTile,
  Loading,
  PageTitle,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Inbox } from "@/lib/types";

/** Links in messages are full addresses of this app; open them inside the app. */
function pathOf(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

export default function NotificationsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Inbox>("/me/notifications");

  async function open(id: string, link: string | null, read: boolean) {
    if (!read)
      await api.post(`/me/notifications/${id}/read`).catch(() => undefined);
    const path = pathOf(link);
    if (path) router.push(path);
    else reload();
  }

  async function readAll() {
    await api.post("/me/notifications/read-all");
    reload();
  }

  return (
    <div>
      <PageTitle
        action={
          (data?.unread ?? 0) > 0 && (
            <Button variant="ghost" className="text-sm" onClick={readAll}>
              {t("notif.readAll")}
            </Button>
          )
        }
      >
        {t("notif.title")}
      </PageTitle>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.items.length ? (
        <Empty>{t("notif.empty")}</Empty>
      ) : (
        <ul className="space-y-2">
          {data.items.map((n) => (
            <li key={n.id}>
              <button
                className="block w-full text-left"
                onClick={() => open(n.id, n.link, n.read)}
              >
                <Card
                  className={
                    n.read
                      ? "bg-white/70"
                      : "ring-emerald-300! active:bg-slate-50"
                  }
                >
                  <div className="flex items-start gap-3">
                    <span className="relative">
                      <IconTile name="bell" tone={n.read ? "slate" : "brand"} />
                      {!n.read && (
                        <span
                          aria-label={t("notif.unread")}
                          className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-600 ring-2 ring-white"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`${n.read ? "" : "font-semibold"} break-words`}
                      >
                        {n.title}
                      </p>
                      <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-slate-600">
                        {n.text.replace(/\s*https?:\/\/\S+\s*$/, "")}
                      </p>
                      <p className="mt-1 text-xs text-slate-400 tabular-nums">
                        {formatDate(n.createdAt.slice(0, 10), lang, {
                          short: true,
                        })}{" "}
                        {formatTime(n.createdAt, lang)}
                      </p>
                    </div>
                  </div>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
