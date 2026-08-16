import type {
  AuditLogEntity,
  ChainEntity,
  SystemConfigEntity,
} from '../entities/system.entity';
import type { Paged } from '../entities/common.entity';

export interface ChainRepository {
  create(data: Omit<ChainEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChainEntity>;
  findById(id: number): Promise<ChainEntity | null>;
  findByKey(key: string): Promise<ChainEntity | null>;
  listAll(includeInactive?: boolean): Promise<ChainEntity[]>;
  update(id: number, data: Partial<Omit<ChainEntity, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ChainEntity>;
  delete(id: number): Promise<void>;
}

export interface AuditLogRepository {
  record(entry: {
    adminId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntity>;
  list(params: { page: number; limit: number }): Promise<Paged<AuditLogEntity>>;
}

export interface SystemConfigRepository {
  get(): Promise<SystemConfigEntity>;
  update(data: Partial<Omit<SystemConfigEntity, 'id' | 'updatedAt'>>): Promise<SystemConfigEntity>;
}
