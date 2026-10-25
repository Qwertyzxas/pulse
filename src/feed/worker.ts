import { FeedController } from './controller';
import type { WorkerCommand, WorkerEvent } from './protocol';

const scope = self as unknown as {
  postMessage(event: WorkerEvent): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
};

const controller = new FeedController((event) => scope.postMessage(event));
scope.onmessage = (event) => controller.handle(event.data);
