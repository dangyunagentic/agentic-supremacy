/**
 * Injection tokens. Application code depends on these symbols; the composition
 * root (infrastructure modules) binds concrete implementations to them.
 */
export const TOKENS = {
  UserRepository: 'UserRepository',
  WalletRepository: 'WalletRepository',
  TaskRepository: 'TaskRepository',
  TaskRunRepository: 'TaskRunRepository',
  ChainRepository: 'ChainRepository',
  AuditLogRepository: 'AuditLogRepository',
  SystemConfigRepository: 'SystemConfigRepository',

  PasswordHasher: 'PasswordHasherPort',
  TokenService: 'TokenServicePort',
  KeyEncryption: 'KeyEncryptionPort',
  MintScheduler: 'MintSchedulerPort',
  TaskEventPublisher: 'TaskEventPublisherPort',
  Notifier: 'NotifierPort',
  TelegramLink: 'TelegramLinkPort',
  ChainQuery: 'ChainQueryPort',
  EligibilityApi: 'EligibilityApiPort',
  RpcEndpointRepository: 'RpcEndpointRepository',
  TransferJobRepository: 'TransferJobRepository',
} as const;

export type TokenType = (typeof TOKENS)[keyof typeof TOKENS];
