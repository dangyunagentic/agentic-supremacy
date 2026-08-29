import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { CreateTaskUseCase } from '../../application/tasks/create-task.use-case';
import {
  DeleteTaskUseCase,
  GetTaskUseCase,
  ListTaskLogsUseCase,
  ListTasksUseCase,
  ResumeTaskUseCase,
  StopTaskUseCase,
} from '../../application/tasks/task.use-cases';
import { ResolveCollectionUseCase } from '../../application/eligibility/resolve-collection.use-case';

@Module({
  providers: [
    CreateTaskUseCase,
    ListTasksUseCase,
    GetTaskUseCase,
    StopTaskUseCase,
    ResumeTaskUseCase,
    DeleteTaskUseCase,
    ListTaskLogsUseCase,
    ResolveCollectionUseCase,
  ],
  controllers: [TasksController],
})
export class TasksModule {}
