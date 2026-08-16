import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { CreateTaskUseCase } from '../../application/tasks/create-task.use-case';
import {
  GetTaskUseCase,
  ListTaskLogsUseCase,
  ListTasksUseCase,
  StopTaskUseCase,
} from '../../application/tasks/task.use-cases';

@Module({
  providers: [CreateTaskUseCase, ListTasksUseCase, GetTaskUseCase, StopTaskUseCase, ListTaskLogsUseCase],
  controllers: [TasksController],
})
export class TasksModule {}
