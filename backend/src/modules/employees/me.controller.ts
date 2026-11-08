/**
 * Self-service for the signed-in employee (the PWA uses these in WP9).
 *
 *   GET   /me/profile     own employee profile (own NID/TIN shown in full)
 *   PATCH /me/contact     { phone?, personalEmail?, presentAddress?, emergencyContactName?, emergencyContactPhone?, version }
 *
 * The login must be linked to an employee record (users.employee_id).
 */
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { UpdateOwnContactDto } from './dto/employee.dto.js';
import { EmployeesService } from './employees.service.js';

@Controller('me')
export class MeController {
  constructor(private readonly employeesService: EmployeesService) {}

  // GET /me/profile
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('profile')
  getOwnProfile() {
    return this.employeesService.getOwnProfile();
  }

  // PATCH /me/contact
  @UseGuards(AuthGuard)
  @RequirePermission('employee.contact.edit_own')
  @Patch('contact')
  updateOwnContact(@Body() dto: UpdateOwnContactDto) {
    return this.employeesService.updateOwnContact(dto);
  }
}
