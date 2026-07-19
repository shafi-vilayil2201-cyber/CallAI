import { IsString, MinLength, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class CreateAssistantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(10)
  systemInstruction!: string;

  @IsString()
  voiceId: string = 'alloy';

  @IsString()
  model: string = 'gpt-4o-realtime';

  @IsString()
  language: string = 'en-US';

  @IsString()
  aiProviderConfigId!: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateAssistantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  systemInstruction?: string;

  @IsOptional()
  @IsString()
  voiceId?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
