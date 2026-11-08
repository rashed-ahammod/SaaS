import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const WALLET_PROVIDERS = ['bkash', 'nagad', 'rocket', 'upay'] as const;
const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * POST /employees/:employeeId/bank-accounts       (needs header X-OTP-Code when 2FA is enforced)
 *
 * Bank (BEFTN):
 *   { "kind": "bank", "bankName": "Dutch-Bangla Bank PLC", "branchName": "Gulshan",
 *     "routingNumber": "090261725", "accountName": "Mahmudul Hasan Rafi", "accountNumber": "1051100012345" }
 *
 * Mobile wallet:
 *   { "kind": "wallet", "walletProvider": "bkash", "walletNumber": "01712345678", "accountName": "Mahmudul Hasan Rafi" }
 */
export class RequestBankAccountDto {
  @IsIn(['bank', 'wallet'])
  kind: 'bank' | 'wallet';

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  accountName: string;

  // --- bank ---
  @ValidateIf((o) => o.kind === 'bank')
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  bankName?: string;

  @ValidateIf((o) => o.kind === 'bank')
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  branchName?: string;

  /** Bangladesh Bank routing number: 9 digits. */
  @ValidateIf((o) => o.kind === 'bank')
  @Matches(/^[0-9]{9}$/, { message: 'routingNumber must be 9 digits' })
  routingNumber?: string;

  @ValidateIf((o) => o.kind === 'bank')
  @Matches(/^[0-9]{8,20}$/, { message: 'accountNumber must be 8-20 digits' })
  accountNumber?: string;

  // --- mobile wallet ---
  @ValidateIf((o) => o.kind === 'wallet')
  @IsIn(WALLET_PROVIDERS)
  walletProvider?: (typeof WALLET_PROVIDERS)[number];

  /** Bangladeshi mobile number, 01XXXXXXXXX. */
  @ValidateIf((o) => o.kind === 'wallet')
  @Matches(/^01[3-9][0-9]{8}$/, {
    message: 'walletNumber must look like 01712345678',
  })
  walletNumber?: string;
}
