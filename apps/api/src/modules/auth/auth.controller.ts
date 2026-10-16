import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, UpdateProfileDto, type AuthResponse, type MeResponse, type UserSummary } from "@prospect/shared";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  register(@Body(new ZodValidationPipe(RegisterDto)) dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("login")
  login(@Body(new ZodValidationPipe(LoginDto)) dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  refresh(@Body(new ZodValidationPipe(RefreshDto)) dto: RefreshDto): Promise<AuthResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.userId);
  }

  @Patch("me")
  updateProfile(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(UpdateProfileDto)) dto: UpdateProfileDto): Promise<UserSummary> {
    return this.auth.updateProfile(user.userId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("change-password")
  async changePassword(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ChangePasswordDto)) dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user.userId, dto);
  }

  @Post("me/avatar")
  @UseInterceptors(FileInterceptor("file"))
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined): Promise<UserSummary> {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    return this.auth.setAvatar(user.userId, file);
  }

  @Delete("me/avatar")
  removeAvatar(@CurrentUser() user: AuthUser): Promise<UserSummary> {
    return this.auth.removeAvatar(user.userId);
  }
}
