/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 * Manpower plan
 *   GET   /companies/:companyId/manpower-plan?fiscalYear=2026-27
 *   PUT   /companies/:companyId/manpower-plan        Admin  { fiscalYear?, note?, lines[] }
 *   POST  /manpower-plans/:planId/approve            Admin
 *
 * Position requests (approval: HR -> Admin; the Dept Head raising it is step zero)
 *   GET   /companies/:companyId/position-requests?state=
 *   POST  /companies/:companyId/position-requests    { departmentId, designationId, gradeId, branchId, headcount, reason, employmentType?, replacementFor? }
 *   GET   /position-requests/:requestId
 *   POST  /position-requests/:requestId/cancel       { reason }
 *
 * Openings and postings (HR)
 *   GET   /companies/:companyId/job-openings?state=
 *   POST  /position-requests/:requestId/opening      { title, description, requirements[], openings?, closingOn? }
 *   GET   /job-openings/:openingId
 *   POST  /job-openings/:openingId/postings          { channel, postedOn?, reference? }
 *   POST  /job-openings/:openingId/hold · /resume
 *   POST  /job-openings/:openingId/close             { reason }
 *
 * Applicants and applications (HR)
 *   GET   /companies/:companyId/applicants?q=
 *   POST  /companies/:companyId/applicants           { fullNameEn, phone?, email?, consent: true, cvText?, ... }
 *   GET   /applicants/:applicantId
 *   POST  /applicants/:applicantId/cv                multipart: file (+ cvText)
 *   PUT   /applicants/:applicantId/cv-text           { cvText }
 *   GET   /applicants/:applicantId/cv                the file
 *   POST  /job-openings/:openingId/applications      { applicantId, appliedOn?, note? }
 *   GET   /applications/:applicationId
 *   POST  /applications/:applicationId/move          { to, note? }
 *   POST  /applications/:applicationId/screen        AI screening of the blind CV
 *
 * Interviews
 *   POST  /applications/:applicationId/interviews    HR  { scheduledAt, kind?, place?, panelUserIds[] }
 *   GET   /companies/:companyId/my-interviews        the panels I am on
 *   GET   /interviews/:interviewId
 *   POST  /interviews/:interviewId/scorecard         a panel member  { overall, recommendation, scores?, notes? }
 *   POST  /interviews/:interviewId/finish            HR  { outcome, state?, note? }
 *   POST  /interviews/:interviewId/cancel            HR  { reason }
 *
 * Offers
 *   POST  /applications/:applicationId/offer         HR  { branchId, departmentId, designationId, gradeId, grossSalary, joiningOn, validUntil, probationMonths?, terms? }
 *   GET   /job-offers/:offerId
 *   GET   /job-offers/:offerId/letter.pdf?lang=bn
 *   POST  /job-offers/:offerId/send · /accept
 *   POST  /job-offers/:offerId/decline               { reason }
 *   POST  /job-offers/:offerId/withdraw              { reason }
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import { ShortTransactions } from '../../platform/tenancy/tenant-transaction.interceptor.js';
import { ApplicantsService, MAX_CV_BYTES } from './applicants.service.js';
import { CvScreeningService } from './cv-screening.service.js';
import {
  ApplicantDto,
  ApplicantQueryDto,
  ApplyDto,
  CancelDto,
  CloseOpeningDto,
  CvTextDto,
  DeclineOfferDto,
  FinishInterviewDto,
  InterviewDto,
  MoveApplicationDto,
  OfferDto,
  OpeningDto,
  OpeningQueryDto,
  PlanDto,
  PositionQueryDto,
  PositionRequestDto,
  PostingDto,
  ScorecardDto,
  WithdrawOfferDto,
} from './dto/recruitment.dto.js';
import { InterviewsService } from './interviews.service.js';
import { ManpowerService } from './manpower.service.js';
import { OffersService } from './offers.service.js';
import { OpeningsService } from './openings.service.js';
import { PositionsService } from './positions.service.js';

const SEE = ['recruitment.view', 'recruitment.manage', 'recruitment.plan'] as const;

@Controller()
export class RecruitmentController {
  constructor(
    private readonly manpowerService: ManpowerService,
    private readonly positionsService: PositionsService,
    private readonly openingsService: OpeningsService,
    private readonly applicantsService: ApplicantsService,
    private readonly interviewsService: InterviewsService,
    private readonly offersService: OffersService,
    private readonly screeningService: CvScreeningService,
  ) {}

  // =========================================================== manpower plan

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/manpower-plan')
  plan(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    return this.manpowerService.plan(companyId, fiscalYear);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.plan')
  @Put('companies/:companyId/manpower-plan')
  savePlan(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PlanDto,
  ) {
    return this.manpowerService.savePlan(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.plan')
  @Post('manpower-plans/:planId/approve')
  @HttpCode(200)
  approvePlan(@Param('planId', ParseUUIDPipe) planId: string) {
    return this.manpowerService.approve(planId);
  }

  // ======================================================== position requests

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE, 'recruitment.request_own')
  @Get('companies/:companyId/position-requests')
  positions(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PositionQueryDto,
  ) {
    return this.positionsService.list(companyId, query);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.request_own', 'recruitment.manage', 'recruitment.plan')
  @Post('companies/:companyId/position-requests')
  raisePosition(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PositionRequestDto,
  ) {
    return this.positionsService.raise(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE, 'recruitment.request_own')
  @Get('position-requests/:requestId')
  position(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.positionsService.get(requestId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.request_own', 'recruitment.manage')
  @Post('position-requests/:requestId/cancel')
  @HttpCode(200)
  cancelPosition(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: CancelDto,
  ) {
    return this.positionsService.cancel(requestId, dto.reason);
  }

  // ============================================================== openings

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/job-openings')
  openings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: OpeningQueryDto,
  ) {
    return this.openingsService.list(companyId, query);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('position-requests/:requestId/opening')
  openOpening(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: OpeningDto,
  ) {
    return this.openingsService.open(requestId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('job-openings/:openingId')
  opening(@Param('openingId', ParseUUIDPipe) openingId: string) {
    return this.openingsService.get(openingId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-openings/:openingId/postings')
  addPosting(
    @Param('openingId', ParseUUIDPipe) openingId: string,
    @Body() dto: PostingDto,
  ) {
    return this.openingsService.addPosting(openingId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-openings/:openingId/hold')
  @HttpCode(200)
  holdOpening(@Param('openingId', ParseUUIDPipe) openingId: string) {
    return this.openingsService.hold(openingId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-openings/:openingId/resume')
  @HttpCode(200)
  resumeOpening(@Param('openingId', ParseUUIDPipe) openingId: string) {
    return this.openingsService.resume(openingId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-openings/:openingId/close')
  @HttpCode(200)
  closeOpening(
    @Param('openingId', ParseUUIDPipe) openingId: string,
    @Body() dto: CloseOpeningDto,
  ) {
    return this.openingsService.close(openingId, dto);
  }

  // ============================================= applicants and applications

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/applicants')
  applicants(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ApplicantQueryDto,
  ) {
    return this.applicantsService.list(companyId, query);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('companies/:companyId/applicants')
  addApplicant(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ApplicantDto,
  ) {
    return this.applicantsService.addApplicant(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('applicants/:applicantId')
  applicant(@Param('applicantId', ParseUUIDPipe) applicantId: string) {
    return this.applicantsService.get(applicantId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_CV_BYTES, files: 1 } }),
  )
  @Post('applicants/:applicantId/cv')
  uploadCv(
    @Param('applicantId', ParseUUIDPipe) applicantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CvTextDto,
  ) {
    return this.applicantsService.uploadCv(applicantId, file, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Put('applicants/:applicantId/cv-text')
  setCvText(
    @Param('applicantId', ParseUUIDPipe) applicantId: string,
    @Body() dto: CvTextDto,
  ) {
    return this.applicantsService.setCvText(applicantId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('applicants/:applicantId/cv')
  @Header('Cache-Control', 'no-store')
  async cvFile(@Param('applicantId', ParseUUIDPipe) applicantId: string) {
    const file = await this.applicantsService.cvFile(applicantId);
    return new StreamableFile(file.content, {
      disposition: `attachment; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`,
    });
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-openings/:openingId/applications')
  apply(
    @Param('openingId', ParseUUIDPipe) openingId: string,
    @Body() dto: ApplyDto,
  ) {
    return this.applicantsService.apply(openingId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE, 'recruitment.interview')
  @Get('applications/:applicationId')
  application(@Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.applicantsService.application(applicationId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('applications/:applicationId/move')
  @HttpCode(200)
  move(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: MoveApplicationDto,
  ) {
    return this.applicantsService.move(applicationId, dto);
  }

  /**
   * The model is asked about a CV with the person removed from it. Like every other AI
   * route it holds no transaction while the model thinks, and takes no Idempotency-Key:
   * screening changes nothing a second call could duplicate wrongly (it only adds another
   * screening row, which is a fact about a second reading).
   */
  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @ShortTransactions()
  @SkipIdempotency()
  @Post('applications/:applicationId/screen')
  @HttpCode(200)
  screen(@Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.screeningService.screen(applicationId);
  }

  // ============================================================= interviews

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('applications/:applicationId/interviews')
  schedule(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: InterviewDto,
  ) {
    return this.interviewsService.schedule(applicationId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.interview', ...SEE)
  @Get('companies/:companyId/my-interviews')
  myInterviews(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.interviewsService.mine(companyId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.interview', ...SEE)
  @Get('interviews/:interviewId')
  interview(@Param('interviewId', ParseUUIDPipe) interviewId: string) {
    return this.interviewsService.get(interviewId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.interview')
  @Post('interviews/:interviewId/scorecard')
  @HttpCode(200)
  score(
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Body() dto: ScorecardDto,
  ) {
    return this.interviewsService.score(interviewId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('interviews/:interviewId/finish')
  @HttpCode(200)
  finish(
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Body() dto: FinishInterviewDto,
  ) {
    return this.interviewsService.finish(interviewId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('interviews/:interviewId/cancel')
  @HttpCode(200)
  cancelInterview(
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Body() dto: CancelDto,
  ) {
    return this.interviewsService.cancel(interviewId, dto.reason);
  }

  // ================================================================= offers

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('applications/:applicationId/offer')
  makeOffer(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: OfferDto,
  ) {
    return this.offersService.make(applicationId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('job-offers/:offerId')
  offer(@Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.offersService.get(offerId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Get('job-offers/:offerId/letter.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'no-store')
  async letter(
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Query('lang') lang?: string,
  ) {
    const pdf = await this.offersService.letter(
      offerId,
      lang === 'bn' ? 'bn' : 'en',
    );
    return new StreamableFile(pdf, {
      disposition: `attachment; filename="offer-${offerId}.pdf"`,
    });
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-offers/:offerId/send')
  @HttpCode(200)
  sendOffer(@Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.offersService.send(offerId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-offers/:offerId/accept')
  @HttpCode(200)
  acceptOffer(@Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.offersService.accept(offerId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-offers/:offerId/decline')
  @HttpCode(200)
  declineOffer(
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: DeclineOfferDto,
  ) {
    return this.offersService.decline(offerId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('recruitment.manage')
  @Post('job-offers/:offerId/withdraw')
  @HttpCode(200)
  withdrawOffer(
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: WithdrawOfferDto,
  ) {
    return this.offersService.withdraw(offerId, dto);
  }
}
