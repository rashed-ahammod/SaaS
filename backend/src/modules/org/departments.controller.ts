/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/departments
 *   GET   /companies/:companyId/departments     tree order, each item has "depth"
 *   GET   /departments/:departmentId
 *   PATCH /departments/:departmentId            rename, move (parentId), set head; body includes "version"
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
import { DepartmentsService } from './departments.service.js';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/org.dto.js';

@Controller()
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  // POST /companies/:companyId/departments
  @UseGuards(AuthGuard)
  @RequirePermission('org.structure.manage')
  @Post('companies/:companyId/departments')
  createDepartment(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departmentsService.createDepartment(companyId, dto);
  }

  // GET /companies/:companyId/departments
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/departments')
  listDepartments(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.departmentsService.listDepartments(companyId);
  }

  // GET /departments/:departmentId
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('departments/:departmentId')
  getDepartment(@Param('departmentId', ParseUUIDPipe) departmentId: string) {
    return this.departmentsService.getDepartment(departmentId);
  }

  // PATCH /departments/:departmentId
  @UseGuards(AuthGuard)
  @RequirePermission('org.structure.manage')
  @Patch('departments/:departmentId')
  updateDepartment(
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departmentsService.updateDepartment(departmentId, dto);
  }
}
