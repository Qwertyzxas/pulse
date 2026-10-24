import { FeedController } from './controller';
import type { WorkerCommand, WorkerEvent } from './protocol';

// Only the bits of the worker scope we use: the DOM and WebWorker libs can't share one program
const scope = self as unknown as {
  postMessage(event: WorkerEvent): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
};

const controller = new FeedController((event) => scope.postMessage(event));
scope.onmessage = (event) => controller.handle(event.data);
