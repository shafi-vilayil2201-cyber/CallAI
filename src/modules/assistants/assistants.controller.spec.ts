import { Test, TestingModule } from '@nestjs/testing';
import { AssistantsController } from './assistants.controller';
import { AssistantsService } from './assistants.service';
import { CreateAssistantDto, UpdateAssistantDto } from './dto/assistant.dto';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('AssistantsController', () => {
  let controller: AssistantsController;
  let service: AssistantsService;

  const mockAssistantsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const mockUser: AuthenticatedUser = {
    userId: 'user-id',
    email: 'admin@org.com',
    organizationId: 'org-id',
    role: 'ADMIN',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssistantsController],
      providers: [
        { provide: AssistantsService, useValue: mockAssistantsService },
      ],
    }).compile();

    controller = module.get<AssistantsController>(AssistantsController);
    service = module.get<AssistantsService>(AssistantsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should delegate to AssistantsService.create with org context', async () => {
      const dto: CreateAssistantDto = {
        name: 'My AI Agent',
        systemInstruction: 'Be helpful customer support.',
        voiceId: 'alloy',
        model: 'gpt-4o-realtime',
        language: 'en-US',
        aiProviderConfigId: 'config-id',
      };

      await controller.create(dto, mockUser);
      expect(service.create).toHaveBeenCalledWith(dto, 'org-id');
    });
  });

  describe('findAll', () => {
    it('should delegate to AssistantsService.findAll', async () => {
      const query = { page: 1, limit: 10, sortOrder: 'desc' as const };
      await controller.findAll(query, mockUser);
      expect(service.findAll).toHaveBeenCalledWith('org-id', query);
    });
  });

  describe('findOne', () => {
    it('should delegate to AssistantsService.findOne', async () => {
      await controller.findOne('asst-id', mockUser);
      expect(service.findOne).toHaveBeenCalledWith('asst-id', 'org-id');
    });
  });

  describe('update', () => {
    it('should delegate to AssistantsService.update', async () => {
      const dto: UpdateAssistantDto = { name: 'New Name' };
      await controller.update('asst-id', dto, mockUser);
      expect(service.update).toHaveBeenCalledWith('asst-id', dto, 'org-id');
    });
  });

  describe('remove', () => {
    it('should delegate to AssistantsService.remove', async () => {
      await controller.remove('asst-id', mockUser);
      expect(service.remove).toHaveBeenCalledWith('asst-id', 'org-id');
    });
  });
});
