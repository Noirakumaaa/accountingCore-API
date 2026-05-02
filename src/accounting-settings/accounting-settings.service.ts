import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateAccountingSettingsDto } from './dto/update-accounting-settings.dto.js';

const DEFAULT_ACCESS_MINUTES = 15;
const DEFAULT_REFRESH_DAYS = 7;

type AccountSettingField =
  | 'payrollSalaryExpenseAccountId'
  | 'payrollSssExpenseAccountId'
  | 'payrollPhilhealthExpenseAccountId'
  | 'payrollPagibigExpenseAccountId'
  | 'payrollSssPayableAccountId'
  | 'payrollPhilhealthPayableAccountId'
  | 'payrollPagibigPayableAccountId'
  | 'payrollWithholdingTaxPayableAccountId'
  | 'payrollCashAccountId';

@Injectable()
export class AccountingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly selectFields = {
    accountingAccessTokenMinutes: true,
    accountingRefreshTokenDays: true,
    payrollSalaryExpenseAccountId: true,
    payrollSssExpenseAccountId: true,
    payrollPhilhealthExpenseAccountId: true,
    payrollPagibigExpenseAccountId: true,
    payrollSssPayableAccountId: true,
    payrollPhilhealthPayableAccountId: true,
    payrollPagibigPayableAccountId: true,
    payrollWithholdingTaxPayableAccountId: true,
    payrollCashAccountId: true,
  } as const;

  async findOne() {
    const settings = await this.prisma.companyInfo.findUnique({
      where: { id: 'singleton' },
      select: this.selectFields,
    });

    return {
      accountingAccessTokenMinutes:
        settings?.accountingAccessTokenMinutes ?? DEFAULT_ACCESS_MINUTES,
      accountingRefreshTokenDays:
        settings?.accountingRefreshTokenDays ?? DEFAULT_REFRESH_DAYS,
      payrollSalaryExpenseAccountId:
        settings?.payrollSalaryExpenseAccountId ?? null,
      payrollSssExpenseAccountId: settings?.payrollSssExpenseAccountId ?? null,
      payrollPhilhealthExpenseAccountId:
        settings?.payrollPhilhealthExpenseAccountId ?? null,
      payrollPagibigExpenseAccountId:
        settings?.payrollPagibigExpenseAccountId ?? null,
      payrollSssPayableAccountId: settings?.payrollSssPayableAccountId ?? null,
      payrollPhilhealthPayableAccountId:
        settings?.payrollPhilhealthPayableAccountId ?? null,
      payrollPagibigPayableAccountId:
        settings?.payrollPagibigPayableAccountId ?? null,
      payrollWithholdingTaxPayableAccountId:
        settings?.payrollWithholdingTaxPayableAccountId ?? null,
      payrollCashAccountId: settings?.payrollCashAccountId ?? null,
    };
  }

  private normalizeAccountId(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private async validateAccounts(dto: UpdateAccountingSettingsDto) {
    const fieldSpecs: Array<{
      field: AccountSettingField;
      expected: AccountType;
      label: string;
    }> = [
      {
        field: 'payrollSalaryExpenseAccountId',
        expected: AccountType.EXPENSE,
        label: 'Payroll salary expense account',
      },
      {
        field: 'payrollSssExpenseAccountId',
        expected: AccountType.EXPENSE,
        label: 'Payroll SSS expense account',
      },
      {
        field: 'payrollPhilhealthExpenseAccountId',
        expected: AccountType.EXPENSE,
        label: 'Payroll PhilHealth expense account',
      },
      {
        field: 'payrollPagibigExpenseAccountId',
        expected: AccountType.EXPENSE,
        label: 'Payroll Pag-IBIG expense account',
      },
      {
        field: 'payrollSssPayableAccountId',
        expected: AccountType.LIABILITY,
        label: 'Payroll SSS payable account',
      },
      {
        field: 'payrollPhilhealthPayableAccountId',
        expected: AccountType.LIABILITY,
        label: 'Payroll PhilHealth payable account',
      },
      {
        field: 'payrollPagibigPayableAccountId',
        expected: AccountType.LIABILITY,
        label: 'Payroll Pag-IBIG payable account',
      },
      {
        field: 'payrollWithholdingTaxPayableAccountId',
        expected: AccountType.LIABILITY,
        label: 'Payroll withholding tax payable account',
      },
      {
        field: 'payrollCashAccountId',
        expected: AccountType.ASSET,
        label: 'Payroll cash or bank account',
      },
    ];

    const providedEntries = fieldSpecs
      .filter(({ field }) => Object.prototype.hasOwnProperty.call(dto, field))
      .map(({ field, expected, label }) => ({
        field,
        expected,
        label,
        value: this.normalizeAccountId(dto[field]),
      }));

    const normalizedEntries = providedEntries
      .map(({ field, expected, label }) => ({
        field,
        expected,
        label,
        value: this.normalizeAccountId(dto[field]),
      }))
      .filter((entry) => entry.value);

    if (providedEntries.length === 0) {
      return {} as Partial<Record<AccountSettingField, string | null>>;
    }

    const accounts = await this.prisma.account.findMany({
      where: {
        id: { in: normalizedEntries.map((entry) => entry.value as string) },
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
      },
    });

    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );

    for (const entry of normalizedEntries) {
      const account = accountMap.get(entry.value as string);
      if (!account) {
        throw new BadRequestException(
          `${entry.label} is missing or inactive. Please choose an active account.`,
        );
      }

      if (account.type !== entry.expected) {
        throw new BadRequestException(
          `${entry.label} must use a ${entry.expected.toLowerCase()} account. "${account.code} - ${account.name}" is set as ${account.type.toLowerCase()}.`,
        );
      }
    }

    return Object.fromEntries(
      providedEntries.map(({ field }) => [
        field,
        this.normalizeAccountId(dto[field]),
      ]),
    ) as Partial<Record<AccountSettingField, string | null>>;
  }

  async update(dto: UpdateAccountingSettingsDto) {
    const validatedAccounts = await this.validateAccounts(dto);

    await this.prisma.companyInfo.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        accountingAccessTokenMinutes:
          dto.accountingAccessTokenMinutes ?? DEFAULT_ACCESS_MINUTES,
        accountingRefreshTokenDays:
          dto.accountingRefreshTokenDays ?? DEFAULT_REFRESH_DAYS,
        ...validatedAccounts,
      },
      update: {
        ...(dto.accountingAccessTokenMinutes !== undefined
          ? { accountingAccessTokenMinutes: dto.accountingAccessTokenMinutes }
          : {}),
        ...(dto.accountingRefreshTokenDays !== undefined
          ? { accountingRefreshTokenDays: dto.accountingRefreshTokenDays }
          : {}),
        ...validatedAccounts,
      },
    });

    return this.findOne();
  }
}
