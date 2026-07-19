import { IsString, IsUrl, IsArray, IsOptional, IsBoolean, MinLength } from 'class-validator';

export class CreateWebhookDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsUrl()
  url!: string;

  @IsString()
  @MinLength(16)
  secret!: string;

  @IsArray()
  @IsString({ each: true })
  eventTypes!: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventTypes?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
