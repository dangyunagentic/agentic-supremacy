import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { CreateTaskUseCase } from '../../application/tasks/create-task.use-case';
import {
  GetTaskUseCase,
  ListTaskLogsUseCase,
  ListTasksUseCase,
  StopTaskUseCase,
} from '../../application/tasks/task.use-cases';
import { ResolveCollectionUseCase } from '../../application/eligibility/resolve-collection.use-case';

@Module({
  providers: [
    CreateTaskUseCase,
    ListTasksUseCase,
    GetTaskUseCase,
    StopTaskUseCase,
    ListTaskLogsUseCase,
    ResolveCollectionUseCase,
  ],
  controllers: [TasksController],
})
export class TasksModule {}
