import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { AiModule } from "../ai/ai.module";
import { MessagesController, ProspectMessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";

@Module({
  imports: [ProjectsModule, AiModule],
  controllers: [MessagesController, ProspectMessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
