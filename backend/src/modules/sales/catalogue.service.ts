/**
 * Products, price lists and discount limits (Phase 3 WP25; spec §6.8 step 4).
 *
 *   products          what the company sells, each on a VAT item (its rate for the year); goods
 *                     kept in a store name their stock item (same unit), so delivery takes stock
 *   price lists       unit prices per fiscal year (July-June), for every customer or one
 *                     customer type; a new list replaces the active one of the same year and type
 *   priceFor          the customer type's list, else the list for every customer
 *   discount limits   the most a salesperson may give without approval; the most specific
 *                     limit applies (user + product > user > product > customer type > company);
 *                     none set: a placeholder default (sales-rules)
 *
 * Set up by the Admin or Accounts (sales.catalogue); salespeople read them.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { CustomerType, Product } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  DiscountLimitsDto,
  PriceListDto,
  ProductDto,
  UpdateProductDto,
} from './dto/sales.dto.js';
import { limitFor } from './sales-rules.js';

const READERS = [
  'sales.catalogue',
  'crm.own',
  'crm.view',
  'crm.assign',
  'crm.manage',
  'receivables.view',
] as const;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  // ================================================================ products

  async products(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertReader(companyId);
    const rows = await this.db.tx
      .selectFrom('products as p')
      .innerJoin('vat_items as v', 'v.id', 'p.vat_item_id')
      .leftJoin('stock_items as s', 's.id', 'p.stock_item_id')
      .selectAll('p')
      .select([
        'v.code as vat_code',
        'v.name_en as vat_name',
        's.code as stock_code',
      ])
      .where('p.company_id', '=', companyId)
      .orderBy('p.code')
      .execute();
    return rows.map((p) => ({
      ...this.toProduct(p),
      vatItem: `${p.vat_code} · ${p.vat_name}`,
      stockItem: p.stock_code,
    }));
  }

  async createProduct(companyId: string, dto: ProductDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('sales.catalogue', { companyId });
    await this.assertVatItem(companyId, dto.vatItemId);
    if (dto.stockItemId)
      await this.assertStockItem(
        companyId,
        dto.stockItemId,
        dto.unit,
        dto.kind ?? 'goods',
      );
    const clash = await this.db.tx
      .selectFrom('products')
      .select('id')
      .where('company_id', '=', companyId)
      .where('code', '=', dto.code)
      .executeTakeFirst();
    if (clash) throw new ConflictException(MSG.PRODUCT_CODE_TAKEN);
    const p = await this.db.tx
      .insertInto('products')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        kind: dto.kind ?? 'goods',
        unit: dto.unit,
        vat_item_id: dto.vatItemId,
        stock_item_id: dto.stockItemId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'product.created',
      entity: 'product',
      entityId: p.id,
      after: this.toProduct(p),
    });
    return this.toProduct(p);
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const p = await this.findProduct(id);
    this.access.assert('sales.catalogue', { companyId: p.company_id });
    if (dto.vatItemId) await this.assertVatItem(p.company_id, dto.vatItemId);
    if (dto.stockItemId)
      await this.assertStockItem(
        p.company_id,
        dto.stockItemId,
        dto.unit ?? p.unit,
        p.kind,
      );
    const stockItemId =
      dto.stockItemId === undefined ? p.stock_item_id : dto.stockItemId;
    const row = await this.db.tx
      .updateTable('products')
      .set({
        name: dto.name ?? p.name,
        name_bn: dto.nameBn ?? p.name_bn,
        unit: dto.unit ?? p.unit,
        vat_item_id: dto.vatItemId ?? p.vat_item_id,
        stock_item_id: stockItemId,
        is_active: dto.isActive ?? p.is_active,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'product.updated',
      entity: 'product',
      entityId: id,
      before: this.toProduct(p),
      after: this.toProduct(row),
    });
    return this.toProduct(row);
  }

  async findProduct(id: string): Promise<Product> {
    const p = await this.db.tx
      .selectFrom('products')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!p) throw new NotFoundException(MSG.PRODUCT_NOT_FOUND);
    return p;
  }

  // ================================================================ price lists

  async priceLists(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertReader(companyId);
    const lists = await this.db.tx
      .selectFrom('price_lists')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('fiscal_year_code', 'desc')
      .orderBy('customer_type')
      .execute();
    const items = lists.length
      ? await this.db.tx
          .selectFrom('price_list_items as i')
          .innerJoin('products as p', 'p.id', 'i.product_id')
          .select([
            'i.price_list_id',
            'i.product_id',
            'i.unit_price',
            'p.code',
            'p.name',
            'p.unit',
          ])
          .where(
            'i.price_list_id',
            'in',
            lists.map((l) => l.id),
          )
          .orderBy('p.code')
          .execute()
      : [];
    return lists.map((l) => ({
      id: l.id,
      name: l.name,
      fiscalYear: l.fiscal_year_code,
      customerType: l.customer_type,
      isActive: l.is_active,
      version: l.version,
      prices: items
        .filter((i) => i.price_list_id === l.id)
        .map((i) => ({
          productId: i.product_id,
          code: i.code,
          name: i.name,
          unit: i.unit,
          unitPrice: i.unit_price,
        })),
    }));
  }

  /** A new list; the active list of the same year and customer type retires. */
  async createPriceList(companyId: string, dto: PriceListDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('sales.catalogue', { companyId });
    const ids = dto.prices.map((p) => p.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['A product appears twice'] },
      });
    if (ids.length) {
      const found = await this.db.tx
        .selectFrom('products')
        .select('id')
        .where('company_id', '=', companyId)
        .where('id', 'in', ids)
        .execute();
      if (found.length !== ids.length)
        throw new BadRequestException(MSG.PRODUCT_NOT_FOUND);
    }
    let old = this.db.tx
      .updateTable('price_lists')
      .set({ is_active: false })
      .where('company_id', '=', companyId)
      .where('fiscal_year_code', '=', dto.fiscalYear)
      .where('is_active', '=', true);
    old = dto.customerType
      ? old.where('customer_type', '=', dto.customerType)
      : old.where('customer_type', 'is', null);
    const retired = await old.returning('id').execute();
    const list = await this.db.tx
      .insertInto('price_lists')
      .values({
        company_id: companyId,
        name: dto.name,
        fiscal_year_code: dto.fiscalYear,
        customer_type: dto.customerType ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (dto.prices.length)
      await this.db.tx
        .insertInto('price_list_items')
        .values(
          dto.prices.map((p) => ({
            price_list_id: list.id,
            product_id: p.productId,
            unit_price: Money.of(p.unitPrice).toDb(),
          })),
        )
        .execute();
    await this.audit.record({
      action: 'price_list.created',
      entity: 'price_list',
      entityId: list.id,
      after: {
        name: dto.name,
        fiscalYear: dto.fiscalYear,
        customerType: dto.customerType ?? null,
        prices: dto.prices.length,
        replaced: retired.map((r) => r.id),
      },
    });
    return (await this.priceLists(companyId)).find((l) => l.id === list.id)!;
  }

  /** The unit price for a customer type in a fiscal year: its own list, else the list for everyone. */
  async priceFor(
    companyId: string,
    productId: string,
    customerType: CustomerType,
    fiscalYear: string,
  ): Promise<string | null> {
    const rows = await this.db.tx
      .selectFrom('price_list_items as i')
      .innerJoin('price_lists as l', 'l.id', 'i.price_list_id')
      .select(['l.customer_type', 'i.unit_price'])
      .where('l.company_id', '=', companyId)
      .where('l.is_active', '=', true)
      .where('l.fiscal_year_code', '=', fiscalYear)
      .where('i.product_id', '=', productId)
      .where((eb) =>
        eb.or([
          eb('l.customer_type', '=', customerType),
          eb('l.customer_type', 'is', null),
        ]),
      )
      .execute();
    return (
      (
        rows.find((r) => r.customer_type === customerType) ??
        rows.find((r) => !r.customer_type)
      )?.unit_price ?? null
    );
  }

  // ================================================================ discount limits

  async discountLimits(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertReader(companyId);
    const rows = await this.db.tx
      .selectFrom('discount_limits as d')
      .leftJoin('users as u', 'u.id', 'd.user_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .leftJoin('products as p', 'p.id', 'd.product_id')
      .select([
        'd.id',
        'd.user_id',
        'd.product_id',
        'd.customer_type',
        'd.max_percent',
        'e.full_name_en',
        'u.email',
        'p.code as product_code',
      ])
      .where('d.company_id', '=', companyId)
      .orderBy('d.created_at')
      .execute();
    return rows.map((d) => ({
      id: d.id,
      userId: d.user_id,
      userName: d.full_name_en ?? d.email,
      productId: d.product_id,
      productCode: d.product_code,
      customerType: d.customer_type,
      maxPercent: d.max_percent,
    }));
  }

  /** The whole set at once (the Admin edits it as a table). */
  async setDiscountLimits(companyId: string, dto: DiscountLimitsDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('sales.catalogue', { companyId });
    const key = (l: {
      userId?: string;
      productId?: string;
      customerType?: string;
    }) => `${l.userId ?? '*'}|${l.productId ?? '*'}|${l.customerType ?? '*'}`;
    if (new Set(dto.limits.map(key)).size !== dto.limits.length)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['The same limit appears twice'] },
      });
    const before = await this.discountLimits(companyId);
    await this.db.tx
      .deleteFrom('discount_limits')
      .where('company_id', '=', companyId)
      .execute();
    if (dto.limits.length) {
      await this.db.tx
        .insertInto('discount_limits')
        .values(
          dto.limits.map((l) => ({
            company_id: companyId,
            user_id: l.userId ?? null,
            product_id: l.productId ?? null,
            customer_type: l.customerType ?? null,
            max_percent: Money.of(l.maxPercent).toDb(),
          })),
        )
        .execute();
    }
    await this.audit.record({
      action: 'discount_limits.set',
      entity: 'company',
      entityId: companyId,
      before: { limits: before.length },
      after: { limits: dto.limits },
    });
    return this.discountLimits(companyId);
  }

  /** The limit for a salesperson selling a product to a customer type. */
  async limitFor(
    companyId: string,
    who: { userId: string; productId: string; customerType: string },
  ) {
    const rows = await this.db.tx
      .selectFrom('discount_limits')
      .select(['user_id', 'product_id', 'customer_type', 'max_percent'])
      .where('company_id', '=', companyId)
      .execute();
    return limitFor(
      rows.map((r) => ({
        userId: r.user_id,
        productId: r.product_id,
        customerType: r.customer_type,
        maxPercent: r.max_percent,
      })),
      who,
    );
  }

  // ================================================================ internals

  private assertReader(companyId: string) {
    if (!READERS.some((p) => this.access.current().has(p)))
      this.access.assert('sales.catalogue', { companyId });
  }

  private async assertVatItem(companyId: string, id: string) {
    const v = await this.db.tx
      .selectFrom('vat_items')
      .select(['company_id', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!v || v.company_id !== companyId || !v.is_active)
      throw new BadRequestException(MSG.VAT_ITEM_NOT_FOUND);
  }

  /** A store's stock item for goods, counted in the same unit as the product is sold. */
  private async assertStockItem(
    companyId: string,
    id: string,
    unit: string,
    kind: string,
  ) {
    if (kind !== 'goods')
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['Only goods are kept in a store'] },
      });
    const s = await this.db.tx
      .selectFrom('stock_items')
      .select(['company_id', 'is_active', 'unit'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s || s.company_id !== companyId || !s.is_active)
      throw new BadRequestException(MSG.STOCK_ITEM_NOT_FOUND);
    if (s.unit.trim().toLowerCase() !== unit.trim().toLowerCase())
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: [
            `The stock item is counted in ${s.unit}, the product is sold in ${unit}: use the same unit`,
          ],
        },
      });
  }

  private toProduct(p: Product) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      nameBn: p.name_bn,
      kind: p.kind,
      unit: p.unit,
      vatItemId: p.vat_item_id,
      stockItemId: p.stock_item_id,
      isActive: p.is_active,
      version: p.version,
    };
  }
}
