import { ConflictException, Injectable } from "@nestjs/common";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { ErrorCodes, type AuthResponse, type ChangePasswordDto, type LoginDto, type MeResponse, type RegisterDto, type UpdateProfileDto, type UserSummary } from "@prospect/shared";
import { env } from "../../config/env";
import { AppException } from "../../common/errors";
import { unauthorized, badRequest } from "../../common/errors";
import { PrismaService } from "../../prisma/prisma.service";

interface AccessTokenPayload {
  sub: string;
  email: string;
  type: "access";
}
interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const toUserSummary = (user: User): UserSummary => ({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private signAccessToken(userId: string, email: string): string {
    const payload: AccessTokenPayload = { sub: userId, email, type: "access" };
    return this.jwt.sign(payload, { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN as JwtSignOptions["expiresIn"] });
  }

  private signRefreshToken(userId: string): string {
    const payload: RefreshTokenPayload = { sub: userId, type: "refresh" };
    return this.jwt.sign(payload, { secret: env.JWT_REFRESH_SECRET, expiresIn: env.JWT_REFRESH_EXPIRES_IN as JwtSignOptions["expiresIn"] });
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException({ statusCode: 409, code: ErrorCodes.EMAIL_TAKEN, message: "Email is already registered" });

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const slugBase = dto.email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let slug = slugBase;
    for (let i = 1; await this.prisma.workspace.findUnique({ where: { slug } }); i++) slug = `${slugBase}-${i}`;

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email: dto.email, passwordHash, name: dto.name } });
      const workspace = await tx.workspace.create({
        data: {
          name: `${dto.name}'s Workspace`,
          slug,
          settings: { aiProviderKey: "mock", enrichmentProviderKey: "mock_enrichment", outboundProviderKey: "simulated", sourcePrecedence: ["MANUAL", "ENRICHMENT", "SOURCE", "NORMALIZER", "AI"] },
        },
      });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: created.id, role: "OWNER" } });
      return created;
    });

    return {
      accessToken: this.signAccessToken(user.id, user.email),
      refreshToken: this.signRefreshToken(user.id),
      user: toUserSummary(user),
    };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw unauthorized(ErrorCodes.INVALID_CREDENTIALS, "Invalid email or password");
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw unauthorized(ErrorCodes.INVALID_CREDENTIALS, "Invalid email or password");

    return {
      accessToken: this.signAccessToken(user.id, user.email),
      refreshToken: this.signRefreshToken(user.id),
      user: toUserSummary(user),
    };
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwt.verify<RefreshTokenPayload>(refreshToken, { secret: env.JWT_REFRESH_SECRET });
    } catch {
      throw unauthorized(ErrorCodes.INVALID_REFRESH_TOKEN, "Invalid or expired refresh token");
    }
    if (payload.type !== "refresh") throw unauthorized(ErrorCodes.INVALID_REFRESH_TOKEN, "Invalid token type");

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized(ErrorCodes.INVALID_REFRESH_TOKEN, "User no longer exists");

    return {
      accessToken: this.signAccessToken(user.id, user.email),
      refreshToken: this.signRefreshToken(user.id),
      user: toUserSummary(user),
    };
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { workspace: true } } },
    });
    if (!user) throw unauthorized();
    return {
      user: toUserSummary(user),
      memberships: user.memberships.map((m) => ({
        workspaceId: m.workspaceId,
        workspaceName: m.workspace.name,
        workspaceSlug: m.workspace.slug,
        role: m.role,
      })),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserSummary> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { name: dto.name } });
    return toUserSummary(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized();
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw unauthorized(ErrorCodes.INVALID_CREDENTIALS, "Current password is incorrect");
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  /** Stored as a base64 data URL directly on the user row — no object storage in this POC. */
  async setAvatar(userId: string, file: { buffer: Buffer; mimetype: string; size: number }): Promise<UserSummary> {
    if (!ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw badRequest(ErrorCodes.VALIDATION_ERROR, `Unsupported image type "${file.mimetype}" — use PNG, JPEG, WEBP or GIF`);
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw badRequest(ErrorCodes.VALIDATION_ERROR, `Image exceeds the ${MAX_AVATAR_BYTES / (1024 * 1024)}MB limit`);
    }
    const avatarUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
    return toUserSummary(user);
  }

  async removeAvatar(userId: string): Promise<UserSummary> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
    return toUserSummary(user);
  }
}

export { AppException };
