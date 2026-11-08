/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies
 *   GET   /companies
 *   GET   /companies/:companyId
 *   PATCH /companies/:companyId          body includes "version"
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/org.dto.js';

@Controller()
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // POST /companies
  @UseGuards(AuthGuard)
  @RequirePermission('org.structure.manage')
  @Post('companies')
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.companiesService.createCompany(dto);
  }

  // GET /companies
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies')
  listCompanies() {
    return this.companiesService.listCompanies();
  }

  // GET /companies/:companyId
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId')
  getCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companiesService.getCompany(companyId);
  }

  // PATCH /companies/:companyId
  @UseGuards(AuthGuard)
  @RequirePermission('org.structure.manage')
  @Patch('companies/:companyId')
  updateCompany(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.updateCompany(companyId, dto);
  }
}
