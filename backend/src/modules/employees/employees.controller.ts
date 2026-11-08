/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /employees                         create (draft) with first placement
 *   GET   /employees?companyId=&departmentId=&branchId=&designationId=&status=&q=&page=&pageSize=
 *   GET   /employees/export.csv              the same list as a spreadsheet (no salary / bank / NID)
 *   GET   /employees/:employeeId             profile + current placement
 *   PATCH /employees/:employeeId             profile fields; body includes "version"
 *   POST  /employees/:employeeId/activate    draft -> probation/active (checklist must be complete)
 * Notice of leaving, probation and clearance: lifecycle.controller.ts
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  CreateEmployeeDto,
  ExportEmployeesQueryDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto.js';
import { EmployeesService } from './employees.service.js';

@Controller()
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // POST /employees
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees')
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.createEmployee(dto);
  }

  // GET /employees
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees')
  listEmployees(@Query() query: ListEmployeesQueryDto) {
    return this.employeesService.listEmployees(query);
  }

  // GET /employees/export.csv   (declared before :employeeId, which would reject "export.csv" as a UUID)
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/export.csv')
  async exportEmployees(@Query() query: ExportEmployeesQueryDto) {
    const file = await this.employeesService.exportEmployeesCsv(query);
    return new StreamableFile(file.content, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  // GET /employees/:employeeId
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId')
  getEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.employeesService.getEmployee(employeeId);
  }

  // PATCH /employees/:employeeId
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Patch('employees/:employeeId')
  updateEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.updateEmployee(employeeId, dto);
  }

  // POST /employees/:employeeId/activate
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/activate')
  @HttpCode(200)
  activateEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.employeesService.activateEmployee(employeeId);
  }
}
