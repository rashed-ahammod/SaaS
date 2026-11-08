/**
 * How PostgreSQL values are turned into JavaScript values.
 *
 * Defaults of the `pg` driver are changed for two types, because the defaults
 * cause real bugs in a payroll system:
 *  - DATE: the driver would build a JS Date at local midnight, which shifts the
 *    day when the server's timezone differs. Business dates stay 'YYYY-MM-DD' strings.
 *  - BIGINT: the driver returns a string. We return a number, but refuse values
 *    that a JS number cannot hold exactly.
 * NUMERIC is left as a string on purpose: money is converted with Money.of().
 */
import pg from 'pg';

const DATE_OID = 1082;
const INT8_OID = 20;

let installed = false;

export function installPgTypeParsers(): void {
  if (installed) return;
  installed = true;

  pg.types.setTypeParser(DATE_OID, (value: string) => value);

  pg.types.setTypeParser(INT8_OID, (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(
        `BIGINT value ${value} is too large for a JS number; select it as text instead`,
      );
    }
    return n;
  });
}
