import { Injectable } from '@nestjs/common';
import { InvoiceStatus, BillStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      receivables,
      payables,
      cashAccounts,
      revenueThisMonth,
      expensesThisMonth,
      revenueVsExpenses,
      arAging,
      apAging,
      recentInvoices,
      recentBills,
      recentPayments,
      recentExpenses,
      overdueInvoices,
      overdueBills,
    ] = await Promise.all([
      // Total outstanding receivables
      this.prisma.invoice.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } },
      }),

      // Total outstanding payables
      this.prisma.bill.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: ['RECEIVED', 'PARTIAL', 'OVERDUE'] } },
      }),

      // Cash balance from bank accounts
      this.prisma.bankAccount.findMany({
        select: { name: true, openingBalance: true },
        where: { isActive: true },
      }),

      // Revenue this month from journal lines
      this.prisma.journalLine.aggregate({
        _sum: { credit: true },
        where: {
          account: { type: 'REVENUE' },
          journalEntry: {
            status: 'POSTED',
            date: { gte: startOfMonth },
          },
        },
      }),

      // Expenses this month from journal lines
      this.prisma.journalLine.aggregate({
        _sum: { debit: true },
        where: {
          account: { type: 'EXPENSE' },
          journalEntry: {
            status: 'POSTED',
            date: { gte: startOfMonth },
          },
        },
      }),

      // Revenue vs expenses — last 5 months
      this.getRevenueVsExpenses(),

      // AR aging breakdown
      this.getArAging(),

      // AP aging breakdown
      this.getApAging(),

      // Recent invoices
      this.prisma.invoice.findMany({
        take: 3,
        orderBy: { issueDate: 'desc' },
        select: {
          invoiceNumber: true,
          total: true,
          issueDate: true,
          status: true,
          customer: { select: { name: true } },
        },
      }),

      // Recent bills
      this.prisma.bill.findMany({
        take: 3,
        orderBy: { issueDate: 'desc' },
        select: {
          billNumber: true,
          total: true,
          issueDate: true,
          status: true,
          vendor: { select: { name: true } },
        },
      }),

      // Recent payments received
      this.prisma.payment.findMany({
        take: 3,
        orderBy: { date: 'desc' },
        where: { invoiceId: { not: null } },
        select: {
          amount: true,
          date: true,
          invoice: { select: { customer: { select: { name: true } } } },
        },
      }),

      // Recent expenses posted
      this.prisma.expense.findMany({
        take: 3,
        orderBy: { date: 'desc' },
        select: {
          expenseNumber: true,
          amount: true,
          category: true,
          date: true,
          status: true,
        },
      }),

      // Overdue invoices (past due date, not paid/cancelled)
      this.prisma.invoice.findMany({
        where: {
          status: {
            in: [
              InvoiceStatus.OVERDUE,
              InvoiceStatus.SENT,
              InvoiceStatus.PARTIAL,
            ],
          },
          dueDate: { lt: now },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
        select: {
          id: true,
          invoiceNumber: true,
          dueDate: true,
          balanceDue: true,
          customer: { select: { name: true } },
        },
      }),

      // Overdue bills (past due date, not paid/cancelled)
      this.prisma.bill.findMany({
        where: {
          status: {
            in: [BillStatus.OVERDUE, BillStatus.RECEIVED, BillStatus.PARTIAL],
          },
          dueDate: { lt: now },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
        select: {
          id: true,
          billNumber: true,
          dueDate: true,
          balanceDue: true,
          vendor: { select: { name: true } },
        },
      }),
    ]);

    const totalReceivables = Number(receivables._sum.balanceDue ?? 0);
    const totalPayables = Number(payables._sum.balanceDue ?? 0);
    const cashBalance = cashAccounts.reduce(
      (sum, acc) => sum + Number(acc.openingBalance),
      0,
    );
    const revenueMonth = Number(revenueThisMonth._sum.credit ?? 0);
    const expensesMonth = Number(expensesThisMonth._sum.debit ?? 0);
    const netIncome = revenueMonth - expensesMonth;

    const getSeverity = (days: number): 'low' | 'medium' | 'critical' => {
      if (days >= 61) return 'critical';
      if (days >= 31) return 'medium';
      return 'low';
    };

    const criticalOverdueItems = [
      ...overdueInvoices.map((inv) => {
        const daysOverdue = Math.floor(
          (now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000,
        );
        return {
          id: inv.id,
          ref: inv.invoiceNumber,
          party: inv.customer.name,
          balanceDue: Number(inv.balanceDue),
          dueDate: inv.dueDate.toISOString(),
          daysOverdue,
          severity: getSeverity(daysOverdue),
          kind: 'invoice' as const,
        };
      }),
      ...overdueBills.map((bill) => {
        const daysOverdue = Math.floor(
          (now.getTime() - new Date(bill.dueDate).getTime()) / 86_400_000,
        );
        return {
          id: bill.id,
          ref: bill.billNumber,
          party: bill.vendor.name,
          balanceDue: Number(bill.balanceDue),
          dueDate: bill.dueDate.toISOString(),
          daysOverdue,
          severity: getSeverity(daysOverdue),
          kind: 'bill' as const,
        };
      }),
    ]
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 10);

    const recentTransactions = [
      ...recentPayments.map((p) => ({
        description: `Payment received — ${p.invoice?.customer.name ?? 'Unknown'}`,
        type: 'Receivable' as const,
        amount: Number(p.amount),
        date: p.date,
        flow: 'in' as const,
      })),
      ...recentInvoices.map((inv) => ({
        description: `Invoice issued — ${inv.customer.name}`,
        type: 'Invoice' as const,
        amount: Number(inv.total),
        date: inv.issueDate,
        flow: 'neutral' as const,
      })),
      ...recentBills.map((bill) => ({
        description: `Bill received — ${bill.vendor.name}`,
        type: 'Payable' as const,
        amount: Number(bill.total),
        date: bill.issueDate,
        flow: 'out' as const,
      })),
      ...recentExpenses.map((exp) => ({
        description: `Expense — ${exp.category}`,
        type: 'Expense' as const,
        amount: Number(exp.amount),
        date: exp.date,
        flow: 'out' as const,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

    return {
      kpis: {
        cashBalance,
        totalReceivables,
        totalPayables,
        netIncome,
        revenueThisMonth: revenueMonth,
        expensesThisMonth: expensesMonth,
      },
      revenueVsExpenses,
      arAging,
      apAging,
      recentTransactions,
      criticalOverdueItems,
    };
  }

  private async getRevenueVsExpenses() {
    const months: { month: string; revenue: number; expenses: number }[] = [];
    const now = new Date();

    for (let i = 4; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
        23,
        59,
        59,
      );

      const [rev, exp] = await Promise.all([
        this.prisma.journalLine.aggregate({
          _sum: { credit: true },
          where: {
            account: { type: 'REVENUE' },
            journalEntry: { status: 'POSTED', date: { gte: start, lte: end } },
          },
        }),
        this.prisma.journalLine.aggregate({
          _sum: { debit: true },
          where: {
            account: { type: 'EXPENSE' },
            journalEntry: { status: 'POSTED', date: { gte: start, lte: end } },
          },
        }),
      ]);

      months.push({
        month: date.toLocaleString('en-US', { month: 'short' }),
        revenue: Number(rev._sum.credit ?? 0),
        expenses: Number(exp._sum.debit ?? 0),
      });
    }

    return months;
  }

  private async getArAging() {
    const now = new Date();
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now);
    d60.setDate(d60.getDate() - 60);
    const arStatuses = [
      InvoiceStatus.SENT,
      InvoiceStatus.PARTIAL,
      InvoiceStatus.OVERDUE,
    ];

    const [current, aging, overdue] = await Promise.all([
      this.prisma.invoice.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: arStatuses }, dueDate: { gte: d30 } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: arStatuses }, dueDate: { gte: d60, lt: d30 } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: arStatuses }, dueDate: { lt: d60 } },
      }),
    ]);

    return {
      current: Number(current._sum?.balanceDue ?? 0),
      aging: Number(aging._sum?.balanceDue ?? 0),
      overdue: Number(overdue._sum?.balanceDue ?? 0),
    };
  }

  private async getApAging() {
    const now = new Date();
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now);
    d60.setDate(d60.getDate() - 60);
    const apStatuses = [
      BillStatus.RECEIVED,
      BillStatus.PARTIAL,
      BillStatus.OVERDUE,
    ];

    const [current, aging, overdue] = await Promise.all([
      this.prisma.bill.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: apStatuses }, dueDate: { gte: d30 } },
      }),
      this.prisma.bill.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: apStatuses }, dueDate: { gte: d60, lt: d30 } },
      }),
      this.prisma.bill.aggregate({
        _sum: { balanceDue: true },
        where: { status: { in: apStatuses }, dueDate: { lt: d60 } },
      }),
    ]);

    return {
      current: Number(current._sum?.balanceDue ?? 0),
      aging: Number(aging._sum?.balanceDue ?? 0),
      overdue: Number(overdue._sum?.balanceDue ?? 0),
    };
  }
}
