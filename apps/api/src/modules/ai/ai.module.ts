import { Module, OnModuleInit } from "@nestjs/common";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { AiService } from "./ai.service";
import { PromptLoaderService } from "./prompt-loader.service";
import { MockAiProvider } from "./providers/mock-ai.provider";
import { AnthropicAiProvider } from "./providers/anthropic-ai.provider";
import { OpenAiStubProvider } from "./providers/openai-stub.provider";
import { GeminiAiProvider } from "./providers/gemini-ai.provider";

@Module({
  providers: [AiService, PromptLoaderService, MockAiProvider, AnthropicAiProvider, OpenAiStubProvider, GeminiAiProvider],
  exports: [AiService],
})
export class AiModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly mock: MockAiProvider,
    private readonly anthropic: AnthropicAiProvider,
    private readonly openai: OpenAiStubProvider,
    private readonly gemini: GeminiAiProvider,
  ) {}

  onModuleInit(): void {

    this.registry.registerAi(this.mock);
    this.registry.registerAi(this.anthropic);
    this.registry.registerAi(this.openai);
    this.registry.registerAi(this.gemini);
  }
}
