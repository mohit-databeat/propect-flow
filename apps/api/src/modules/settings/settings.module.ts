import { Module } from "@nestjs/common";
import { PromptLoaderService } from "../ai/prompt-loader.service";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, PromptLoaderService],
})
export class SettingsModule {}
