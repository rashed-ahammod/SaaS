/** The opportunities of a customer or a lead, for its page (WP24). */
import type { DatabaseService } from '../../platform/db/database.service.js';

export async function opportunitiesOf(
  db: DatabaseService,
  target: { customerId?: string; leadId?: string },
) {
  let q = db.tx
    .selectFrom('opportunities as o')
    .innerJoin('opportunity_stages as s', 's.id', 'o.stage_id')
    .select([
      'o.id',
      'o.number',
      'o.title',
      'o.state',
      'o.value',
      'o.probability',
      'o.expected_close_on',
      'o.closed_on',
      's.name as stage_name',
      's.name_bn as stage_name_bn',
    ]);
  q = target.customerId
    ? q.where('o.customer_id', '=', target.customerId)
    : q.where('o.lead_id', '=', target.leadId!);
  const rows = await q.orderBy('o.created_at', 'desc').limit(100).execute();
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    state: r.state,
    value: r.value,
    probability: r.probability,
    expectedCloseOn: r.expected_close_on,
    closedOn: r.closed_on,
    stageName: r.stage_name,
    stageNameBn: r.stage_name_bn,
  }));
}
