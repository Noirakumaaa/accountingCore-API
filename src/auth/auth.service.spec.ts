import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Response } from 'express';
import * as bcrypt from 'bcrypt';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  session: {
    create: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
  },
  companyInfo: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mocked.jwt.token'),
};

const cookieMock = jest.fn();
const clearCookieMock = jest.fn();
const mockRes = {
  cookie: cookieMock,
  clearCookie: clearCookieMock,
} as unknown as Response;

// ── helpers ────────────────────────────────────────────────────────────────────

const buildUser = (overrides = {}) => ({
  id: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  username: 'johndoe',
  email: 'john@example.com',
  password: '$2b$12$hashedpassword',
  role: 'employee' as const,
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ── suite ──────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ── register ─────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates a new user and issues tokens', async () => {
      const user = buildUser();
      mockPrisma.companyInfo.findUnique.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.companyInfo.upsert.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null); // email not taken, username not taken
      mockPrisma.user.create.mockResolvedValue(user);
      mockPrisma.session.create.mockResolvedValue({
        id: 'session-1',
        expiresAt: new Date(),
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(null) // username check
        .mockResolvedValueOnce({ role: 'employee', mustChangePassword: false }); // issueTokens

      const dto = {
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        email: 'john@example.com',
        password: 'Password1',
        role: 'employee',
      };

      const result = await service.register(dto, mockRes);
      expect(result).not.toHaveProperty('password');
      expect(cookieMock).toHaveBeenCalledTimes(2);
      expect(mockPrisma.companyInfo.upsert).not.toHaveBeenCalled();
    });

    it('throws ConflictException if email already taken', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findUnique.mockResolvedValue(buildUser()); // email taken

      await expect(
        service.register(
          {
            firstName: 'Jane',
            lastName: 'Doe',
            username: 'janedoe',
            email: 'john@example.com',
            password: 'Password1',
          },
          mockRes,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if username already taken', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email not taken
        .mockResolvedValueOnce(buildUser()); // username taken

      await expect(
        service.register(
          {
            firstName: 'Jane',
            lastName: 'Doe',
            username: 'johndoe',
            email: 'new@example.com',
            password: 'Password1',
          },
          mockRes,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows initial owner registration when company info exists without an owner', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue({
        companyName: 'ACME Corp',
        ownerId: null,
      });
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.companyInfo.upsert.mockResolvedValue({
        id: 'singleton',
        ownerId: 'user-1',
      });
      mockPrisma.user.create.mockResolvedValue(buildUser({ role: 'owner' }));
      mockPrisma.session.create.mockResolvedValue({
        id: 'session-1',
        expiresAt: new Date(),
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ role: 'owner', mustChangePassword: false });

      const result = await service.register(
        {
          firstName: 'Admin',
          lastName: 'User',
          username: 'admin',
          email: 'admin@example.com',
          password: 'Password1',
          role: 'owner',
        },
        mockRes,
      );

      expect(result).not.toHaveProperty('password');
      expect(mockPrisma.companyInfo.upsert).toHaveBeenCalledWith({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          ownerId: 'user-1',
        },
        update: {
          ownerId: 'user-1',
        },
      });
    });

    it('prevents second owner registration when an owner already exists', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue({
        companyName: 'ACME Corp',
        ownerId: 'owner-1',
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        service.register(
          {
            firstName: 'Admin',
            lastName: 'User',
            username: 'admin',
            email: 'admin@example.com',
            password: 'Password1',
            role: 'owner',
          },
          mockRes,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns user data (without password) on valid credentials', async () => {
      const hashed = await bcrypt.hash('Password1', 12);
      const user = buildUser({ password: hashed });

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(user) // login lookup
        .mockResolvedValueOnce({ role: 'employee', mustChangePassword: false }); // issueTokens
      mockPrisma.session.create.mockResolvedValue({
        id: 'session-1',
        expiresAt: new Date(),
      });

      const result = await service.login(
        { username: 'johndoe', password: 'Password1' },
        mockRes,
      );
      expect(result).not.toHaveProperty('password');
      expect(cookieMock).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      const hashed = await bcrypt.hash('CorrectPass1', 12);
      mockPrisma.user.findUnique.mockResolvedValue(
        buildUser({ password: hashed }),
      );

      await expect(
        service.login({ username: 'johndoe', password: 'WrongPass1' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ username: 'nobody', password: 'Password1' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('deletes session and clears cookies', async () => {
      mockPrisma.session.delete.mockResolvedValue({});

      const result = await service.logout('session-1', mockRes);
      expect(result).toEqual({ message: 'Logged out' });
      expect(clearCookieMock).toHaveBeenCalledTimes(2);
      expect(mockPrisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it('handles gracefully if session already deleted', async () => {
      mockPrisma.session.delete.mockRejectedValue(new Error('not found'));

      const result = await service.logout('session-gone', mockRes);
      expect(result).toEqual({ message: 'Logged out' });
    });
  });

  // ── changePassword ────────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password when current password is correct', async () => {
      const hashed = await bcrypt.hash('OldPass1', 12);
      mockPrisma.user.findUnique.mockResolvedValue(
        buildUser({ password: hashed }),
      );
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.changePassword(
        'user-1',
        'OldPass1',
        'NewPass1',
      );
      expect(result).toEqual({ ok: true });
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('throws BadRequestException when current password is wrong', async () => {
      const hashed = await bcrypt.hash('OldPass1', 12);
      mockPrisma.user.findUnique.mockResolvedValue(
        buildUser({ password: hashed }),
      );

      await expect(
        service.changePassword('user-1', 'WrongPass1', 'NewPass1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('missing-user', 'OldPass1', 'NewPass1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── RBAC: assertCanCreateRole (via registerEmployee) ─────────────────────────

  describe('registerEmployee — role hierarchy enforcement', () => {
    const employeeDto = {
      firstName: 'New',
      lastName: 'Employee',
      username: 'newemployee',
      email: 'new@example.com',
      password: 'Password1',
      role: 'employee',
    };

    it('allows hr to create employee account', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email
        .mockResolvedValueOnce(null); // username
      mockPrisma.user.create.mockResolvedValue(buildUser({ role: 'employee' }));

      const result = await service.registerEmployee(employeeDto, 'hr');
      expect(result).not.toHaveProperty('password');
    });

    it('prevents employee from creating any account', async () => {
      await expect(
        service.registerEmployee(employeeDto, 'employee'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('prevents manager from creating any account', async () => {
      await expect(
        service.registerEmployee(employeeDto, 'manager'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('prevents hr from creating admin account', async () => {
      await expect(
        service.registerEmployee({ ...employeeDto, role: 'admin' }, 'hr'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('allows owner to create hr account', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValue(buildUser({ role: 'hr' }));

      const result = await service.registerEmployee(
        { ...employeeDto, role: 'hr' },
        'owner',
      );
      expect(result).not.toHaveProperty('password');
    });
  });

  // ── companyStatus ─────────────────────────────────────────────────────────────

  describe('companyStatus', () => {
    it('returns { registered: true } when an owner is set', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue({
        ownerId: 'owner-1',
      });
      mockPrisma.user.count.mockResolvedValue(1);
      expect(await service.companyStatus()).toEqual({ registered: true });
    });

    it('returns { registered: false } when company info exists without an owner', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue({
        ownerId: null,
      });
      mockPrisma.user.count.mockResolvedValue(0);
      expect(await service.companyStatus()).toEqual({ registered: false });
    });

    it('returns { registered: false } when no company info', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      expect(await service.companyStatus()).toEqual({ registered: false });
    });

    it('returns { registered: true } when an owner user exists even if company info is missing', async () => {
      mockPrisma.companyInfo.findUnique.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(1);
      expect(await service.companyStatus()).toEqual({ registered: true });
    });
  });
});
