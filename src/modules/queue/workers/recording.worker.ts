import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Processor('recording-upload')
@Injectable()
export class RecordingWorker extends WorkerHost {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger
  ) {
    super();
    this.logger.setContext('RecordingWorker');

    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', 'mock-key'),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', 'mock-secret'),
      },
    });
    this.bucketName = this.configService.get<string>('AWS_S3_RECORDINGS_BUCKET', 'call-ai-recordings');
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { callSessionId, rawAudioBase64 } = job.data;
    this.logger.log(`Processing call recording upload job: ${job.id} for session ${callSessionId}`);

    if (!rawAudioBase64) {
      this.logger.warn(`No audio data provided to upload job for session ${callSessionId}`);
      return { success: false, reason: 'Empty audio buffer' };
    }

    try {
      const audioBuffer = Buffer.from(rawAudioBase64, 'base64');
      const key = `recordings/${callSessionId}.ulaw`;

      // Upload file to AWS S3 bucket
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: audioBuffer,
          ContentType: 'audio/x-mulaw',
        })
      );

      const recordingUrl = `https://${this.bucketName}.s3.amazonaws.com/${key}`;

      // Update CallSession database entry
      await this.prisma.callSession.update({
        where: { id: callSessionId },
        data: { recordingUrl },
      });

      this.logger.log(`Call recording successfully uploaded: ${recordingUrl}`);
      return { success: true, recordingUrl };
    } catch (err) {
      this.logger.error(`Recording upload job failed for call ${callSessionId}`, err instanceof Error ? err.stack : undefined);
      throw err;
    }
  }
}
