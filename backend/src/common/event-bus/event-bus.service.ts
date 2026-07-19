import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { StructuredLogger } from '../logger/logger.service';

export enum DomainEventType {
  CallStarted = 'CallStarted',
  CallAnswered = 'CallAnswered',
  CallEnded = 'CallEnded',
  SpeechStarted = 'SpeechStarted',
  SpeechEnded = 'SpeechEnded',
  TranscriptCreated = 'TranscriptCreated',
  ResponseStarted = 'ResponseStarted',
  ResponseCompleted = 'ResponseCompleted',
  RecordingUploaded = 'RecordingUploaded',
  AnalyticsGenerated = 'AnalyticsGenerated',
}

export interface DomainEvent<T = any> {
  type: DomainEventType;
  timestamp: Date;
  organizationId: string;
  callSessionId: string;
  payload: T;
}

@Injectable()
export class EventBusService {
  private readonly eventSubject = new Subject<DomainEvent>();

  constructor(private readonly logger: StructuredLogger) {
    this.logger.setContext('EventBus');
  }

  // Publish event to internal event stream
  publish(event: Omit<DomainEvent, 'timestamp'>) {
    const fullEvent: DomainEvent = {
      ...event,
      timestamp: new Date(),
    };
    
    this.logger.log({
      action: 'PublishEvent',
      type: fullEvent.type,
      callSessionId: fullEvent.callSessionId,
      organizationId: fullEvent.organizationId,
    });

    this.eventSubject.next(fullEvent);
  }

  // Subscribe to specific event types
  ofEvent<T>(type: DomainEventType): Observable<DomainEvent<T>> {
    return this.eventSubject.asObservable().pipe(
      filter(event => event.type === type)
    ) as Observable<DomainEvent<T>>;
  }

  // Subscribe to all events
  getEvents$(): Observable<DomainEvent> {
    return this.eventSubject.asObservable();
  }
}
