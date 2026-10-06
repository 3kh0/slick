/** Serialize work while allowing later tasks to run after a rejection. */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => T | PromiseLike<T>): Promise<T> => {
    const task = tail.then(work);
    tail = task.catch(() => {});
    return task;
  };
}
