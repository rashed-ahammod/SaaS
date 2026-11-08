/** The activities of a lead, or of a customer and the leads that became it (WP23). */
import type { DatabaseService } from '../../platform/db/database.service.js';

export function toActivity(a: {
  id: string;
  lead_id: string | null;
  customer_id: string | null;
  kind: string;
  subject: string;
  body: string | null;
  due_at: Date | null;
  done_at: Date | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: Date;
}) {
  return {
    id: a.id,
    leadId: a.lead_id,
    customerId: a.customer_id,
    kind: a.kind,
    subject: a.subject,
    body: a.body,
    dueAt: a.due_at,
    doneAt: a.done_at,
    ownerId: a.owner_id,
    createdBy: a.created_by,
    createdAt: a.created_at,
  };
}

export async function activitiesOf(
  db: DatabaseService,
  target: { leadId?: string; customerId?: string; leadIds?: string[] },
) {
  let q = db.tx
    .selectFrom('crm_activities as a')
    .leftJoin('users as u', 'u.id', 'a.created_by')
    .leftJoin('employees as e', 'e.id', 'u.employee_id')
    .selectAll('a')
    .select(['e.full_name_en as by_name']);
  q = target.leadId
    ? q.where('a.lead_id', '=', target.leadId)
    : q.where((eb) =>
        eb.or([
          eb('a.customer_id', '=', target.customerId!),
          ...(target.leadIds?.length
            ? [eb('a.lead_id', 'in', target.leadIds)]
            : []),
        ]),
      );
  const rows = await q.orderBy('a.created_at', 'desc').limit(300).execute();
  return rows.map((r) => ({ ...toActivity(r), byName: r.by_name }));
}
