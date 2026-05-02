# Payroll System Documentation

## Table of Contents

1. [Overview](#1-overview)
2. [Data Models](#2-data-models)
3. [Complete Computation Walkthrough](#3-complete-computation-walkthrough)
4. [How Each Payslip Line is Computed](#4-how-each-payslip-line-is-computed)
5. [OT and Night Differential Breakdown](#5-ot-and-night-differential-breakdown)
6. [Pay Rate Table (DOLE)](#6-pay-rate-table-dole)
7. [Statutory Deductions — Exact Formulas](#7-statutory-deductions--exact-formulas)
8. [Withholding Tax Brackets](#8-withholding-tax-brackets)
9. [Timesheet Statuses](#9-timesheet-statuses)
10. [Holiday Types](#10-holiday-types)
11. [Payroll Settings (Configurable)](#11-payroll-settings-configurable)
12. [API Endpoints](#12-api-endpoints)
13. [Frontend Hooks](#13-frontend-hooks)
14. [How to Change Things](#14-how-to-change-things)

---

## 1. Overview

This is a **Philippine payroll system** built on:

- **Backend**: NestJS + Prisma + PostgreSQL (`SolveCore-API`, port 7001)
- **Frontend**: React + TanStack Query (`SolveCore`)

Pay frequency is **semi-monthly** (1st–15th and 16th–end of month). All pay rules follow DOLE (Department of Labor and Employment) guidelines and BIR Train Law.

### Data Flow

```
Employee record (monthly salary, allowances)
        +
Timesheet entries (status, timeIn, timeOut per day)
        +
Holiday calendar (REGULAR / SPECIAL / SPECIAL_WORKING)
        +
PayrollSettings (rates & multipliers from DB)
        ↓
getPayslips() — determines pay period, fetches all data
        ↓
computePayslip() — loops every calendar day in the period
        ↓
  computeDayPay() per day → sums to basicPay
        ↓
grossPay = basicPay + allowances (÷ 2)
        ↓
deductions = SSS + PhilHealth + Pag-IBIG + Withholding Tax (all ÷ 2)
        ↓
netPay = grossPay − deductions
```

---

## 2. Data Models

### Employee (key fields)
| Field | Type | Purpose |
|---|---|---|
| `salary` | Float | Monthly basic salary |
| `compensation` | JSON | `{ payFrequency, allowances: { transportation, rice, clothing, meal, communication, other } }` |
| `status` | String | `active` / `inactive` / `on_leave` — only `active` employees get payslips |

### Timesheet
| Field | Type | Purpose |
|---|---|---|
| `employeeId` | String | Links to Employee |
| `date` | DateTime | The specific date (stored as UTC midnight) |
| `status` | String | See [Timesheet Statuses](#9-timesheet-statuses) |
| `timeIn` | String? | Format: `HH:MM` (24-hour), e.g. `08:00` |
| `timeOut` | String? | Format: `HH:MM` (24-hour), e.g. `17:00` |

> **Unique constraint**: one entry per employee per date (`employeeId_date`).

### Holiday
| Field | Type | Purpose |
|---|---|---|
| `date` | DateTime | The holiday date |
| `type` | String | `REGULAR` / `SPECIAL` / `SPECIAL_WORKING` |
| `isNational` | Boolean | Whether it applies nationwide |

### PayrollSettings (singleton)
One row with ID `"singleton"`. All payroll rates are read from here at runtime. Defaults are used if the row does not exist yet.

---

## 3. Complete Computation Walkthrough

This section shows the **exact step-by-step calculation** for a single payslip, using a concrete example.

### Example Employee

| Field | Value |
|---|---|
| Monthly salary | ₱30,000 |
| Transportation allowance | ₱2,000/mo |
| Rice subsidy | ₱1,500/mo |
| Total monthly allowances | ₱3,500/mo |
| Pay period | Jan 16–31, 2026 (16 calendar days) |

---

### Step 1 — Determine the Pay Period

```
Month requested: January 2026 (month = "2026-01")

Today = April 22 → past month → always show SECOND half
  periodStart = Jan 16, 2026
  periodEnd   = Jan 31, 2026
  periodDates = [Jan 16, Jan 17, ..., Jan 31]  → 16 days
```

Code location: `payroll.service.ts → getPayslips()`

```typescript
const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === mon;
const isFirstHalf    = isCurrentMonth && now.getDate() <= 15;
const periodStart    = isFirstHalf ? new Date(year, mon - 1, 1)  : new Date(year, mon - 1, 16);
const periodEnd      = isFirstHalf ? new Date(year, mon - 1, 15) : new Date(year, mon, 0);
```

---

### Step 2 — Compute the Daily Rate

```
dailyRate = monthlySalary / dailyRateDivisor
dailyRate = ₱30,000 / 26 = ₱1,153.846...
hourlyRate = dailyRate / standardHours = ₱1,153.846 / 8 = ₱144.231
```

`dailyRateDivisor` (default 26) and `standardHours` (default 8) come from `PayrollSettings`.

Code location: `payroll.service.ts → computePayslip()`

```typescript
const dailyRate  = monthly / s.dailyRateDivisor;   // s = settings from DB
const hourlyRate = dailyRate / s.standardHours;     // inside computeDayPay()
```

---

### Step 3 — Loop Every Calendar Day

For each of the 16 days (Jan 16–31), the system calls `computeDayPay()`:

```
Jan 16 (Friday)  → present, 08:00–17:00 → 9 hrs total, 1 OT hour
Jan 17 (Saturday)→ rest → ₱0
Jan 18 (Sunday)  → rest → ₱0
Jan 19 (Monday)  → present, 08:00–17:00 → regular day
Jan 20 (Tuesday) → sick-leave → full daily rate
Jan 21 (Wednesday)→ present, 22:00–06:00 → night shift (8 hrs, all ND)
Jan 22–31        → present regular days, 08:00–17:00
```

**Day-by-day breakdown:**

#### Jan 16 — Present, OT (08:00–17:00)
```
totalHours    = 17:00 - 08:00 = 9 hours
regularHours  = min(8, 9) = 8 hours
otHours       = max(0, 9 - 8) = 1 hour
ndRegular     = overlap([08:00–16:00], [22:00–30:00]) = 0
ndOt          = overlap([16:00–17:00], [22:00–30:00]) = 0
frac          = 8/8 = 1.0

pay = dailyRate × 1.0 + hourlyRate × 1.25 × 1
    = ₱1,153.85 × 1.0 + ₱144.23 × 1.25 × 1
    = ₱1,153.85 + ₱180.29
    = ₱1,334.14
```

#### Jan 17 (Saturday) — Rest Day
```
status = 'rest', no holiday → pay = ₱0
```

#### Jan 18 (Sunday) — Rest Day
```
status = 'rest', no holiday → pay = ₱0
```

#### Jan 19 — Present, Regular (08:00–17:00)
```
totalHours   = 9h, regularHours = 8h, otHours = 1h
frac = 1.0

pay = dailyRate × 1.0 + hourlyRate × 1.25 × 1
    = ₱1,153.85 + ₱180.29 = ₱1,334.14
```

#### Jan 20 — Sick Leave
```
status = 'sick-leave' → full daily rate regardless of timeIn/timeOut
pay = dailyRate = ₱1,153.85
```

#### Jan 21 — Night Shift (22:00–06:00)
```
totalHours   = 06:00+24h - 22:00 = 8 hours  (overnight: end += 24*60)
regularHours = 8, otHours = 0
ndRegular    = overlap([22:00, 30:00], [22:00, 30:00]) = 8 hours
ndOt         = 0
frac         = 8/8 = 1.0

pay = dailyRate × 1.0 + hourlyRate × 1.1 × 8
    = ₱1,153.85 + ₱144.23 × 1.1 × 8
    = ₱1,153.85 + ₱1,269.22
    = ₱2,423.07
```

#### Jan 22–31 — Regular Present Days (assume 08:00–17:00, Mon–Fri only)
```
Working days: Jan 22(Thu), 23(Fri), 26(Mon), 27(Tue), 28(Wed), 29(Thu), 30(Fri) = 7 days
Weekends (Jan 24 Sat, Jan 25 Sun, Jan 31 Sat) = rest → ₱0

Each regular day with 1 OT hour:
pay/day = ₱1,153.85 + ₱180.29 = ₱1,334.14
```

**Period Basic Pay total:**
```
basicPay = ₱1,334.14 (Jan16)
         + ₱0        (Jan17 Sat)
         + ₱0        (Jan18 Sun)
         + ₱1,334.14 (Jan19)
         + ₱1,153.85 (Jan20 sick-leave)
         + ₱2,423.07 (Jan21 night shift)
         + ₱1,334.14 × 7  (Jan22–30 regular days)
         = ₱1,334.14 + ₱0 + ₱0 + ₱1,334.14 + ₱1,153.85 + ₱2,423.07 + ₱9,338.98
         = ₱15,584.18
```

---

### Step 4 — Add Allowances

```
monthlyAllowances = transportation + rice = ₱2,000 + ₱1,500 = ₱3,500
allowancePeriod   = ₱3,500 / 2 = ₱1,750   (always split evenly, never day-weighted)

grossPay = basicPay + allowancePeriod
         = ₱15,584.18 + ₱1,750.00
         = ₱17,334.18
```

Code location: `payroll.service.ts → computePayslip()`

```typescript
const monthlyAllowances = Object.values(allowances as Record<string, number>)
  .reduce((s, v) => s + (Number(v) || 0), 0);
const allowancePeriod = r2(monthlyAllowances / 2);
const grossPay        = r2(basicPay + allowancePeriod);
```

---

### Step 5 — Compute Deductions

> All deductions use the **full monthly salary** (₱30,000), then divide by 2 for the period.
> This is standard PH payroll — deductions are fixed, not tied to actual earnings.

#### SSS Employee Share
```
monthly SSS = min(₱30,000 × 4.5%, ₱1,350)
            = min(₱1,350, ₱1,350)
            = ₱1,350.00

period SSS  = ₱1,350 / 2 = ₱675.00
```

#### PhilHealth Employee Share
```
monthly PhilHealth = min(₱30,000 × 2.5%, ₱2,500)
                   = min(₱750, ₱2,500)
                   = ₱750.00

period PhilHealth  = ₱750 / 2 = ₱375.00
```

#### Pag-IBIG / HDMF Employee Share
```
monthly Pag-IBIG = min(₱30,000 × 2.0%, ₱200)
                 = min(₱600, ₱200)
                 = ₱200.00       ← cap applies

period Pag-IBIG  = ₱200 / 2 = ₱100.00
```

#### Withholding Tax (BIR)
```
taxableIncome = salary − SSS − PhilHealth − Pag-IBIG
              = ₱30,000 − ₱1,350 − ₱750 − ₱200
              = ₱27,700

Bracket: ₱20,834 – ₱33,332 → 15% on excess over ₱20,833
  monthly tax = (₱27,700 − ₱20,833) × 0.15
              = ₱6,867 × 0.15
              = ₱1,030.05

period tax    = ₱1,030.05 / 2 = ₱515.03
```

#### Total Deductions
```
totalDeductions = SSS + PhilHealth + Pag-IBIG + Withholding Tax
                = ₱675.00 + ₱375.00 + ₱100.00 + ₱515.03
                = ₱1,665.03
```

---

### Step 6 — Net Pay

```
netPay = grossPay − totalDeductions
       = ₱17,334.18 − ₱1,665.03
       = ₱15,669.15
```

---

### Final Payslip Summary for Jan 16–31, 2026

| Line | Amount |
|---|---|
| Basic Pay (day-by-day actual) | ₱15,584.18 |
| Allowances (half of monthly) | ₱1,750.00 |
| **Gross Pay** | **₱17,334.18** |
| SSS (employee share, ÷2) | −₱675.00 |
| PhilHealth (employee share, ÷2) | −₱375.00 |
| Pag-IBIG / HDMF (employee share, ÷2) | −₱100.00 |
| Withholding Tax (BIR, ÷2) | −₱515.03 |
| **Total Deductions** | **−₱1,665.03** |
| **NET PAY** | **₱15,669.15** |

---

## 4. How Each Payslip Line is Computed

This maps each line from the payslip template to its exact formula.

### Attendance Section

| Payslip Label | What it means | How computed |
|---|---|---|
| **No. of days worked** | Days where status = `present` or `half-day` | Count of timesheet entries with those statuses in the period |
| **OT Hours – Regular Day** | Overtime on a normal weekday | `max(0, totalShiftHours - 8)` when no holiday and not rest day |
| **OT Hours – Rest Day** | Overtime worked on Sat/Sun | Same formula, but `isRestDay = true` |
| **OT Hours – Regular Holiday** | OT on a REGULAR holiday | Same formula, `holidayType = 'REGULAR'` |
| **OT Hours – Special Holiday** | OT on a SPECIAL holiday | Same formula, `holidayType = 'SPECIAL'` |
| **OT Hours – Night Differential** | OT hours that fall in the 10 PM–6 AM window | `ndOt` value from `computeHoursBreakdown()` |
| **Absences/Leaves without Pay** | Days with `absent` or `no-pay-leave` | Count of those statuses in the period |
| **Sick leave with pay** | Days with `sick-leave` | Count of those statuses |
| **Vacation/Special Holiday with pay** | Days with `annual-leave` or `leave` | Count of those statuses |

---

### Gross Income Section

| Payslip Label | Formula | Code |
|---|---|---|
| **Basic Pay – Regular Work** | `dailyRate × (regularHours / standardHours)` per worked day | `computeDayPay()` regular branch |
| **Night Diff.** | `hourlyRate × ndMultiplier × ndRegularHours` | Added inside `computeDayPay()` for `ndRegular` hours |
| **Allowances** | `sum(compensation.allowances) / 2` | Fixed per period, not day-weighted |
| **OT – Regular Day** | `hourlyRate × otMultiplier × otHours` | `hourlyRate × 1.25 × otHours` (default) |
| **OT – Night Diff** | `hourlyRate × otMultiplier × ndMultiplier × ndOtHours` | `hourlyRate × 1.25 × 1.10 × ndOtHours` |
| **Gross Pay** | `basicPay + allowances` | `r2(basicPay + allowancePeriod)` |

---

### Deductions Section

| Payslip Label | Formula | Notes |
|---|---|---|
| **SSS Regular Contribution** | `min(salary × sssRate, sssCap) / 2` | Default: 4.5%, cap ₱1,350/mo |
| **SSS Mandatory Provident Fund** | Not computed separately in this system | SMDF is a separate employer-side contribution |
| **HDMF / Pag-IBIG** | `min(salary × pagibigRate, pagibigCap) / 2` | Default: 2%, cap ₱200/mo |
| **PhilHealth** | `min(salary × philhealthRate, philhealthCap) / 2` | Default: 2.5%, cap ₱2,500/mo |
| **Withholding Tax** | BIR bracket on `(salary − SSS − PhilHealth − Pag-IBIG)` then `/ 2` | See [Section 8](#8-withholding-tax-brackets) |
| **SSS Loan / Pag-IBIG Loan** | Not yet implemented — would be a field in employee JSON | Could be added to `compensation.loans` |
| **Absences/Leaves without Pay** | Implicit — days with `absent` or `no-pay-leave` earn ₱0 | No separate deduction line; it reduces `basicPay` directly |
| **Total Deductions** | `SSS + PhilHealth + Pag-IBIG + withholdingTax` | `r2(sss + philhealth + pagibig + tax)` |

---

### NET PAY

```
netPay = grossPay − totalDeductions
       = (basicPay + allowancePeriod) − (sss + philhealth + pagibig + withholdingTax)
```

Code location: `payroll.service.ts → computePayslip()`

```typescript
const netPay = r2(grossPay - totalDeductions);
```

---

## 5. OT and Night Differential Breakdown

**File**: `payroll.service.ts → computeHoursBreakdown(timeIn, timeOut, isHalfDay, settings)`

### How Hours Are Split from timeIn/timeOut

```
Input: timeIn = "08:00", timeOut = "19:00"

startMin  = 8 × 60       = 480
endMin    = 19 × 60      = 1140
totalMins = 1140 − 480   = 660 minutes = 11 hours

STANDARD  = 8 × 60 = 480 minutes

regularMins = min(480, 660) = 480  →  regularHours = 8.0
otMins      = max(0, 660 − 480) = 180  →  otHours = 3.0
regularEnd  = 480 + 480 = 960
```

### Night Differential Window

Default window: **22:00–06:00** (represented as minutes 1320–1560 where 1560 = 30:00 = 6 AM next day)

```typescript
const ND_START = s.ndStartHour * 60;         // 22 × 60 = 1320
const ND_END   = (s.ndEndHour + 24) * 60;    // (6 + 24) × 60 = 1800
```

The `+ 24` wraps the end time into next-day minutes so overnight shifts are handled correctly.

### Overlap Calculation

```typescript
function overlapMins(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

ndRegular = overlapMins(start, regularEnd, ND_START, ND_END)
ndOt      = overlapMins(regularEnd, regularEnd + otMins, ND_START, ND_END)
```

### Overnight Shift Example

```
timeIn = "22:00", timeOut = "06:00"

startMin = 22 × 60 = 1320
endMin   = 6 × 60  = 360  → 360 < 1320 → overnight! → endMin += 1440 = 1800

totalMins   = 1800 − 1320 = 480 = 8 hours
regularMins = 480, otMins = 0
regularEnd  = 1320 + 480 = 1800

ndRegular = overlap([1320, 1800], [1320, 1800]) = 480 min = 8 hours
ndOt      = 0

Pay = dailyRate × 1.0 + hourlyRate × 1.10 × 8
    = full day + 110% premium on all 8 hours
```

### Half-Day Without timeIn/timeOut

```
If status = 'half-day' and no timeIn/timeOut:
  regularHours = standardHours / 2 = 4
  otHours = 0, ndRegular = 0, ndOt = 0
```

---

## 6. Pay Rate Table (DOLE)

**File**: `payroll.service.ts → computeDayPay()`

Variables from `PayrollSettings` (defaults shown):
- `RH` = regularHolidayMultiplier = **2.0**
- `SH` = specialHolidayMultiplier = **1.3**
- `RD` = restDayMultiplier = **1.3**
- `OT` = otMultiplier = **1.25**
- `ND` = ndMultiplier = **1.10**

`frac = regularHours / standardHours`

---

### Regular Working Day (weekday, no holiday)

| Condition | Rate | Formula |
|---|---|---|
| Present (regular hours) | **100%** | `dailyRate × frac` |
| Overtime | **125%** | `+ hourlyRate × OT × otHours` |
| Night Differential (regular) | **110%** | `+ hourlyRate × ND × ndRegular` |
| OT + Night Diff | **137.5%** | `+ hourlyRate × OT × ND × ndOt` |
| Absent / no-pay-leave | **0%** | `return 0` |

Full formula:
```
pay = (dailyRate × frac)
    + (hourlyRate × 1.25 × otHours)
    + (hourlyRate × 1.10 × ndRegular)
    + (hourlyRate × 1.25 × 1.10 × ndOt)
```

---

### Rest Day (Saturday/Sunday, no holiday)

| Condition | Rate | Formula |
|---|---|---|
| Worked (regular hours) | **130%** | `dailyRate × RD × frac` |
| Overtime | **169%** | `+ hourlyRate × RD × OT × otHours` |
| Night Differential | **143%** | `+ hourlyRate × RD × ND × ndRegular` |
| OT + Night Diff | **185.9%** | `+ hourlyRate × RD × OT × ND × ndOt` |
| Not worked | **0%** | `return 0` |

---

### Regular Holiday — Weekday

| Condition | Rate | Formula |
|---|---|---|
| **Not worked** | **100%** | `return dailyRate` (paid regardless by law) |
| Worked (regular hours) | **200%** | `dailyRate × RH × frac` |
| Overtime | **260%** | `+ hourlyRate × RH × OT × otHours` |
| Night Differential | **220%** | `+ hourlyRate × RH × ND × ndRegular` |
| OT + Night Diff | **286%** | `+ hourlyRate × RH × OT × ND × ndOt` |

---

### Regular Holiday + Rest Day (holiday falls on Sat/Sun)

| Condition | Rate | Formula |
|---|---|---|
| **Not worked** | **0% (No Pay)** | `return 0` — DOLE rule for holiday on rest day |
| Worked | **260%** | `dailyRate × RH × RD × frac` |
| Overtime | **338%** | `+ hourlyRate × RH × RD × OT × otHours` |
| Night Differential | **286%** | `+ hourlyRate × RH × RD × ND × ndRegular` |
| OT + Night Diff | **371.8%** | `+ hourlyRate × RH × RD × OT × ND × ndOt` |

---

### Special Non-Working Holiday — Weekday

| Condition | Rate | Formula |
|---|---|---|
| Not worked | **0%** | `return 0` |
| Worked | **130%** | `dailyRate × SH × frac` |
| Overtime | **169%** | `+ hourlyRate × SH × OT × otHours` |
| Night Differential | **143%** | `+ hourlyRate × SH × ND × ndRegular` |
| OT + Night Diff | **185.9%** | `+ hourlyRate × SH × OT × ND × ndOt` |

---

### Special Holiday + Rest Day (falls on Sat/Sun)

| Condition | Rate | Formula |
|---|---|---|
| Not worked | **0%** | `return 0` |
| Worked | **150%** | `dailyRate × SH × RD × frac` |
| Overtime | **195%** | `+ hourlyRate × SH × RD × OT × otHours` |
| Night Differential | **165%** | `+ hourlyRate × SH × RD × ND × ndRegular` |
| OT + Night Diff | **214.5%** | `+ hourlyRate × SH × RD × OT × ND × ndOt` |

---

### Leave Status Pay

| Status | Pay |
|---|---|
| `present` | Based on hours worked (tables above) |
| `half-day` | 4 hrs assumed if no timeIn/timeOut |
| `leave` | **100%** daily rate |
| `sick-leave` | **100%** daily rate |
| `annual-leave` | **100%** daily rate |
| `no-pay-leave` | **0%** |
| `absent` | **0%** |
| `rest` | **0%** (unless also a holiday) |

---

## 7. Statutory Deductions — Exact Formulas

**File**: `payroll.service.ts → computeSSS / computePhilHealth / computePagibig`

All deductions use the **monthly salary** as the base, capped at statutory limits, then **divided by 2** for each semi-monthly period.

### SSS (Social Security System)

```
Employee share per month = min(monthlySalary × sssRate, sssCap)

Defaults: sssRate = 4.5% (0.045), sssCap = ₱1,350

Examples:
  Salary ₱15,000 → ₱15,000 × 4.5% = ₱675.00   → period: ₱337.50
  Salary ₱30,000 → ₱30,000 × 4.5% = ₱1,350.00  → period: ₱675.00
  Salary ₱50,000 → ₱50,000 × 4.5% = ₱2,250 → capped at ₱1,350 → period: ₱675.00
```

### PhilHealth (PHIC)

```
Employee share per month = min(monthlySalary × philhealthRate, philhealthCap)

Defaults: philhealthRate = 2.5% (0.025), philhealthCap = ₱2,500

Examples:
  Salary ₱15,000 → ₱15,000 × 2.5% = ₱375.00   → period: ₱187.50
  Salary ₱30,000 → ₱30,000 × 2.5% = ₱750.00   → period: ₱375.00
  Salary ₱120,000→ ₱120,000 × 2.5% = ₱3,000 → capped at ₱2,500 → period: ₱1,250.00
```

### Pag-IBIG / HDMF

```
Employee share per month = min(monthlySalary × pagibigRate, pagibigCap)

Defaults: pagibigRate = 2.0% (0.02), pagibigCap = ₱200

Note: Almost everyone hits the cap because 2% × ₱10,000 = ₱200 already.

Examples:
  Salary ₱10,000 → ₱10,000 × 2.0% = ₱200.00   → period: ₱100.00
  Salary ₱30,000 → ₱30,000 × 2.0% = ₱600 → capped at ₱200 → period: ₱100.00
```

### Total Monthly Deductions Formula

```
totalMonthly = SSS + PhilHealth + Pag-IBIG + WithholdingTax

Per period (semi-monthly):
  sss_period        = monthlySSS / 2
  philhealth_period = monthlyPhilHealth / 2
  pagibig_period    = monthlyPagibig / 2
  tax_period        = monthlyTax / 2
```

Code location:

```typescript
const sss        = r2(computeSSS(monthly, s) / 2);
const philhealth = r2(computePhilHealth(monthly, s) / 2);
const pagibig    = r2(computePagibig(monthly, s) / 2);
const taxable    = monthly - computeSSS(monthly, s) - computePhilHealth(monthly, s) - computePagibig(monthly, s);
const tax        = r2(computeWithholdingTax(taxable) / 2);
```

---

## 8. Withholding Tax Brackets

**File**: `payroll.service.ts → computeWithholdingTax(taxable)`

`taxableIncome = monthlySalary − monthlySSS − monthlyPhilHealth − monthlyPagibig`

| Monthly Taxable Income | Base Tax | Rate on Excess |
|---|---|---|
| ₱0 – ₱20,833 | ₱0 | 0% |
| ₱20,834 – ₱33,332 | ₱0 | 15% of (income − ₱20,833) |
| ₱33,333 – ₱66,666 | ₱1,875 | 20% of (income − ₱33,333) |
| ₱66,667 – ₱166,666 | ₱8,542 | 25% of (income − ₱66,667) |
| ₱166,667 – ₱666,666 | ₱33,542 | 30% of (income − ₱166,667) |
| ₱666,667 and above | ₱183,542 | 35% of (income − ₱666,667) |

### Worked Examples

**Salary ₱15,000:**
```
SSS        = min(₱15,000 × 4.5%, ₱1,350) = ₱675
PhilHealth = min(₱15,000 × 2.5%, ₱2,500) = ₱375
Pag-IBIG   = ₱200 (capped)
taxable    = ₱15,000 − ₱675 − ₱375 − ₱200 = ₱13,750
tax        = ₱0   (below ₱20,833 threshold)
period tax = ₱0 / 2 = ₱0
```

**Salary ₱30,000:**
```
SSS        = ₱1,350
PhilHealth = ₱750
Pag-IBIG   = ₱200
taxable    = ₱30,000 − ₱1,350 − ₱750 − ₱200 = ₱27,700
bracket    = ₱20,834–₱33,332 → (₱27,700 − ₱20,833) × 15% = ₱6,867 × 0.15 = ₱1,030.05
period tax = ₱1,030.05 / 2 = ₱515.03
```

**Salary ₱80,000:**
```
SSS        = ₱1,350 (capped)
PhilHealth = ₱2,000
Pag-IBIG   = ₱200
taxable    = ₱80,000 − ₱1,350 − ₱2,000 − ₱200 = ₱76,450
bracket    = ₱66,667–₱166,666 → ₱8,542 + (₱76,450 − ₱66,667) × 25%
           = ₱8,542 + ₱9,783 × 0.25
           = ₱8,542 + ₱2,445.75
           = ₱10,987.75
period tax = ₱10,987.75 / 2 = ₱5,493.88
```

---

## 9. Timesheet Statuses

**File**: `src/timesheet/dto/upsert-timesheet.dto.ts`

| Status | Meaning | OT/ND Detection | Pay on Regular Day |
|---|---|---|---|
| `present` | Worked full shift | Yes — from timeIn/timeOut | Based on hours |
| `half-day` | Worked 4 hours | Yes if timeIn/timeOut provided | ~50% daily rate |
| `absent` | Did not show up | No | ₱0 |
| `rest` | Scheduled rest day | No | ₱0 (unless holiday) |
| `holiday` | Recorded holiday attendance | Yes | Holiday rate applies |
| `leave` | Generic paid leave | No | 100% daily rate |
| `sick-leave` | Sick leave | No | 100% daily rate |
| `annual-leave` | Vacation leave | No | 100% daily rate |
| `no-pay-leave` | Unpaid leave | No | ₱0 |

### Leave vs Absent vs No-Pay-Leave

```
leave / sick-leave / annual-leave → employee still earns their full daily rate
no-pay-leave                      → employee loses the day's pay
absent                            → same as no-pay-leave (₱0)
```

The distinction matters for reports and HR records even when pay is the same.

---

## 10. Holiday Types

**File**: `src/holidays/holidays.service.ts`

| Type | Description | Not Worked Pay | Worked Pay |
|---|---|---|---|
| `REGULAR` | National regular holidays (New Year, Christmas, etc.) | **100%** (paid by law on weekday) / **0%** on rest day | **200%** weekday / **260%** rest day |
| `SPECIAL` | Special non-working days (Ninoy Aquino Day, All Saints Day, etc.) | **0%** | **130%** weekday / **150%** rest day |
| `SPECIAL_WORKING` | Special working holidays | **0%** | Same as regular workday (100%) |

> **Duplicate date protection**: Attempting to add a second holiday on the same date returns `409 Conflict` with the name of the existing holiday.

---

## 11. Payroll Settings (Configurable)

**API**: `GET /payroll/settings` · `PATCH /payroll/settings`  
**Frontend**: `Tax & Deductions → Settings tab`  
**File**: `payroll.service.ts → loadSettings()` — loaded once per request

All rates and multipliers are stored in the `PayrollSettings` table (singleton row with id `"singleton"`). If the row has not been created yet, the system uses built-in defaults.

| Setting | Default | What it controls |
|---|---|---|
| `sssRate` | `0.045` | SSS employee contribution rate |
| `sssCap` | `1350` | Maximum monthly SSS deduction |
| `philhealthRate` | `0.025` | PhilHealth contribution rate |
| `philhealthCap` | `2500` | Maximum monthly PhilHealth deduction |
| `pagibigRate` | `0.02` | Pag-IBIG contribution rate |
| `pagibigCap` | `200` | Maximum monthly Pag-IBIG deduction |
| `dailyRateDivisor` | `26` | Monthly salary ÷ this = daily rate |
| `standardHours` | `8` | Hours in one standard work day |
| `otMultiplier` | `1.25` | Overtime premium (125%) |
| `ndMultiplier` | `1.10` | Night differential premium (110%) |
| `regularHolidayMultiplier` | `2.0` | Regular holiday worked rate (200%) |
| `specialHolidayMultiplier` | `1.3` | Special holiday worked rate (130%) |
| `restDayMultiplier` | `1.3` | Rest day worked rate (130%) |
| `ndStartHour` | `22` | Night differential window start (10 PM) |
| `ndEndHour` | `6` | Night differential window end (6 AM next day) |

### How Settings Are Applied

Every time `getPayslips()`, `getTaxReport()`, or `getReports()` runs:
```typescript
const s = await this.loadSettings();
// s is passed to all compute functions
const dailyRate = monthly / s.dailyRateDivisor;
const otPay     = hourlyRate * s.otMultiplier * otHours;
```

Changing a setting instantly affects the **next** payslip computation — existing payslips are not stored, they are always recalculated on demand.

---

## 12. API Endpoints

All routes are protected by JWT (`JwtAuthGuard`). Base URL: `http://localhost:7001`

### Payroll

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/payroll/settings` | — | Get current payroll settings |
| PATCH | `/payroll/settings` | body: partial settings | Update any setting(s) |
| GET | `/payroll/overview` | — | Dashboard summary |
| GET | `/payroll/info` | — | Department breakdown, pay dates, contribution rates |
| GET | `/payroll/payslips` | `month=YYYY-MM` | Payslips for all active employees in the period |
| GET | `/payroll/tax` | `year=YYYY` | Tax report with YTD deductions per employee |
| GET | `/payroll/reports` | `year=YYYY` | Payroll reports with monthly breakdown |
| GET | `/payroll/thirteenth-month` | `year=YYYY` | 13th month pay per employee |

### Timesheet

| Method | Path | Query / Body | Description |
|---|---|---|---|
| GET | `/timesheet` | `weekStart=YYYY-MM-DD` | All entries for the week |
| POST | `/timesheet` | `{ employeeId, date, status, timeIn?, timeOut? }` | Create or update an entry |
| DELETE | `/timesheet/:id` | — | Remove an entry |

### Holidays

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/holidays` | `year=YYYY` | List holidays |
| POST | `/holidays` | `{ name, date, type, description?, isNational? }` | Add a holiday |
| PATCH | `/holidays/:id` | partial fields | Update a holiday |
| DELETE | `/holidays/:id` | — | Remove a holiday |

### Employees

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/employees` | `search`, `department`, `status` | List employees |
| GET | `/employees/:id` | — | Get one employee |
| POST | `/employees` | full employee DTO | Create an employee |

---

## 13. Frontend Hooks

**Folder**: `SolveCore/app/features/payroll/hooks/`

| Hook | Query Key | staleTime | Invalidated by |
|---|---|---|---|
| `usePayslips(month)` | `["payroll-payslips", month]` | `0` (always fresh) | Timesheet mutations, settings update |
| `usePayrollSettings()` | `["payroll-settings"]` | 60 sec | Settings update (sets cache directly) |
| `useUpdatePayrollSettings()` | — | — | Invalidates payslips, tax, info |
| `usePayrollOverview()` | `["payroll-overview"]` | 2 min | — |
| `usePayrollInfo()` | `["payroll-info"]` | 5 min | Settings update |
| `useTaxReport(year)` | `["payroll-tax", year]` | 5 min | Settings update |
| `useReports(year)` | `["payroll-reports", year]` | 5 min | — |
| `useEmployees(filters)` | `["employees", filters]` | 1 min | — |
| `useHolidays(year)` | `["holidays", year]` | 10 min | Holiday create/delete |
| `useTimesheet(weekStart)` | `["timesheet", weekStart]` | 30 sec | Upsert/delete mutations |

**Payslip cache invalidation flow:**
```
useUpsertTimesheet.onSuccess
  → invalidate ["timesheet"]
  → invalidate ["payroll-payslips"]   ← keeps payslips in sync with attendance

useDeleteTimesheet.onSuccess
  → same

useUpdatePayrollSettings.onSuccess
  → setQueryData ["payroll-settings"]  ← instant optimistic update
  → invalidate ["payroll-payslips"]
  → invalidate ["payroll-tax"]
  → invalidate ["payroll-info"]
```

---

## 14. How to Change Things

### Change any rate or multiplier

Use the **Settings UI** in `Tax & Deductions → Settings tab`. Changes take effect immediately on the next payslip load.

Or call the API directly:
```bash
curl -X PATCH http://localhost:7001/payroll/settings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "sssRate": 0.05, "sssCap": 1500 }'
```

---

### Change withholding tax brackets

BIR brackets are not yet in `PayrollSettings` (they are statutory law). To change them:

**File**: `src/payroll/payroll.service.ts → computeWithholdingTax()`

```typescript
function computeWithholdingTax(taxable: number): number {
  if (taxable <= 20833)  return 0;
  if (taxable <= 33332)  return (taxable - 20833)  * 0.15;
  if (taxable <= 66666)  return 1875  + (taxable - 33333)  * 0.20;
  if (taxable <= 166666) return 8542  + (taxable - 66667)  * 0.25;
  if (taxable <= 666666) return 33542 + (taxable - 166667) * 0.30;
  return 183542 + (taxable - 666667) * 0.35;
}
```

Each `if` is one bracket: `baseTax + (taxable − bracketFloor) × rate`.

---

### Add a new leave type

**Step 1** — Backend DTO:

```typescript
// src/timesheet/dto/upsert-timesheet.dto.ts
@IsIn(['present', 'absent', 'half-day', 'holiday', 'leave',
       'sick-leave', 'annual-leave', 'no-pay-leave',
       'bereavement-leave',  // ← add here
       'rest'])
status: string;
```

**Step 2** — Pay rule (paid or unpaid?):

```typescript
// src/payroll/payroll.service.ts → computeDayPay()
if (status === 'sick-leave' || status === 'annual-leave' || status === 'leave'
    || status === 'bereavement-leave')  // ← add if paid
  return dailyRate;
```

**Step 3** — Frontend type:

```typescript
// SolveCore/app/features/payroll/types/index.ts
export type DayStatus = 'present' | 'absent' | 'half-day' | 'holiday' |
  'leave' | 'sick-leave' | 'annual-leave' | 'no-pay-leave' |
  'bereavement-leave' |  // ← add
  'rest';
```

**Step 4** — Frontend label and color (TimesheetPage.tsx):

```typescript
const STATUS_STYLE: Record<DayStatus, string> = {
  ...
  'bereavement-leave': 'bg-slate-50 text-slate-700',
};
const STATUS_LABEL: Record<DayStatus, string> = {
  ...
  'bereavement-leave': 'Bereavement Leave',
};
```

---

### Add a new allowance type

The payslip computation automatically sums **all values** in `compensation.allowances`, so you only need to add the field to the employee form.

**Step 1** — Add to DTO: `src/employees/dto/create-employee.dto.ts`
**Step 2** — Add to `FormState` type: `SolveCore/app/features/payroll/types/index.ts`
**Step 3** — Add to `EMPTY_FORM_STATE`: `SolveCore/app/features/payroll/constants/index.ts`
**Step 4** — Add the form field in the employee form component

The computation picks it up automatically:
```typescript
const monthlyAllowances = Object.values(allowances as Record<string, number>)
  .reduce((s, v) => s + (Number(v) || 0), 0);
```

---

### Add SSS Loan / Pag-IBIG Loan deductions

Currently loans are not computed. To add them:

**Step 1** — Store loan amounts on the employee:
```typescript
// Employee.compensation JSON:
{ payFrequency: "Semi-monthly", allowances: {...}, loans: { sss: 500, pagibig: 300 } }
```

**Step 2** — Deduct in `computePayslip()`:
```typescript
const loans = employee.compensation?.loans ?? {};
const sssLoan    = r2((Number(loans.sss)    || 0) / 2);
const pagibigLoan = r2((Number(loans.pagibig) || 0) / 2);
const totalDeductions = r2(sss + philhealth + pagibig + tax + sssLoan + pagibigLoan);
```

**Step 3** — Return in the payslip response and display in the payslip modal.

---

### Change the pay period (e.g., monthly instead of semi-monthly)

**File**: `src/payroll/payroll.service.ts → getPayslips()`

```typescript
// Current: semi-monthly
const periodStart = isFirstHalf ? new Date(year, mon - 1, 1)  : new Date(year, mon - 1, 16);
const periodEnd   = isFirstHalf ? new Date(year, mon - 1, 15) : new Date(year, mon, 0);

// Monthly: always full month
const periodStart = new Date(year, mon - 1, 1);
const periodEnd   = new Date(year, mon, 0);
```

Then remove the `/ 2` from deductions since they're now monthly:
```typescript
const sss        = r2(computeSSS(monthly, s));      // remove / 2
const philhealth = r2(computePhilHealth(monthly, s));
const pagibig    = r2(computePagibig(monthly, s));
const tax        = r2(computeWithholdingTax(taxable));
```

---

### 13th Month Pay

**Endpoint**: `GET /payroll/thirteenth-month?year=YYYY`

**Legal basis**: RA 6686 — all rank-and-file employees employed for at least 1 month receive 1/12 of their total basic salary earned in the calendar year.

**Formula:**
```
13th Month = (monthlySalary × monthsWorkedInYear) / 12

monthsWorked = from max(startDate, Jan 1) to Dec 31
             = capped at 12
```

**Example:**
```
Employee started July 1, 2026:
  effectiveStart = July 1
  monthsWorked   = Jul + Aug + Sep + Oct + Nov + Dec = 6
  13th month     = (₱30,000 × 6) / 12 = ₱15,000

Employee since Jan 1 (full year):
  monthsWorked   = 12
  13th month     = (₱30,000 × 12) / 12 = ₱30,000
```

**File**: `src/payroll/payroll.service.ts → getThirteenthMonth()`

---

### Add a new payroll API endpoint

**Backend** — add the method to the service, then the route to the controller:

```typescript
// payroll.service.ts
async getMyReport(param: string) {
  const s = await this.loadSettings();  // get rates if needed
  const employees = await this.prisma.employee.findMany({ ... });
  return { ... };
}

// payroll.controller.ts
@Get('my-report')
getMyReport(@Query('param') param: string) {
  return this.payrollService.getMyReport(param);
}
```

**Frontend** — add a hook:

```typescript
export const useMyReport = (param: string) => useQuery({
  queryKey: ['my-report', param],
  queryFn: async () => {
    const { data } = await api.get(`/payroll/my-report?param=${param}`);
    return data;
  },
  staleTime: 5 * 60 * 1000,
});
```

---

### Change which employees are included in payroll

**File**: `src/payroll/payroll.service.ts → getPayslips()`

```typescript
// Current: active only
where: { status: { equals: 'active', mode: 'insensitive' } }

// Include on-leave employees
where: { status: { in: ['active', 'on_leave'], mode: 'insensitive' } }

// Filter by department
where: { status: { equals: 'active', mode: 'insensitive' }, department: 'Engineering' }
```

> Always use `mode: 'insensitive'` on string comparisons — employee statuses may be stored with mixed case.
