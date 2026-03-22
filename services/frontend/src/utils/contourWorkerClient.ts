import type { ContourRequest, ContourResult } from './contourWorker';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (result: ContourResult) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./contourWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ContourResult>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data);
      }
    };
  }
  return worker;
}

export function computeContoursAsync(
  req: Omit<ContourRequest, 'id'>,
): Promise<ContourResult> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ ...req, id });
  });
}
