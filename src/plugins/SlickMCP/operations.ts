import { createHash, randomUUID } from 'node:crypto';
import { serialQueue } from '../../shared/queue.ts';

type Storage = { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<boolean> };
type Receipt = {
  operation_id: string;
  tool: string;
  fingerprint: string;
  status: 'running' | 'completed' | 'unknown';
  created_at: string;
  updated_at: string;
  ids?: Record<string, string>;
};

function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .toSorted()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function identifiers(value: any): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const key of ['id', 'ts', 'channel', 'scheduled_message_id', 'file_id', 'canvas_id', 'list_id'])
    if (typeof value?.[key] === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value[key])) ids[key] = value[key];
  for (const key of ['file', 'item', 'bookmark', 'channel'])
    if (typeof value?.[key]?.id === 'string') ids[`${key}_id`] = value[key].id;
  return ids;
}

export class OperationStore {
  private records = new Map<string, Receipt>();
  private enqueue = serialQueue();
  private storage?: Storage;

  static async load(storage?: Storage) {
    const store = new OperationStore();
    store.storage = storage;
    const saved = await storage?.read('operation-receipts');
    if (saved) {
      const records = JSON.parse(saved) as Receipt[];
      if (!Array.isArray(records) || records.length > 1000) throw new Error('Invalid operation receipt storage');
      for (const receipt of records) {
        if (receipt.status === 'running') receipt.status = 'unknown';
        store.records.set(receipt.operation_id, receipt);
      }
      await store.save();
    }
    return store;
  }

  private async save() {
    if (this.storage && !(await this.storage.write('operation-receipts', JSON.stringify([...this.records.values()]))))
      throw new Error('Could not persist operation receipt; check its status before retrying');
  }

  get(id: string) {
    const receipt = this.records.get(id);
    if (!receipt) return { operation_id: id, status: 'not_found' };
    return {
      operation_id: receipt.operation_id,
      tool: receipt.tool,
      status: receipt.status,
      created_at: receipt.created_at,
      updated_at: receipt.updated_at,
      ids: receipt.ids,
    };
  }

  async run(
    id: string | undefined,
    tool: string,
    args: Record<string, unknown>,
    scope: unknown,
    run: () => Promise<unknown>,
  ) {
    const operationId = id ?? randomUUID();
    const fingerprint = createHash('sha256').update(canonical({ tool, args, scope })).digest('hex');
    const fresh = await this.enqueue(async () => {
      const existing = this.records.get(operationId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error('operation_id already belongs to different arguments or workspace');
        return false;
      }
      if (this.records.size >= 1000)
        throw new Error(
          'Operation receipt limit reached (1000); clear receipts in Slick storage only after reconciling outstanding writes',
        );
      const now = new Date().toISOString();
      this.records.set(operationId, {
        operation_id: operationId,
        tool,
        fingerprint,
        status: 'running',
        created_at: now,
        updated_at: now,
      });
      try {
        await this.save();
      } catch (error) {
        this.records.delete(operationId);
        throw error;
      }
      return true;
    });
    if (!fresh) return { operation: this.get(operationId), replayed: true };
    try {
      const value = await run();
      await this.enqueue(async () => {
        const receipt = this.records.get(operationId)!;
        receipt.status = (value as any)?.ok === false ? 'unknown' : 'completed';
        receipt.ids = identifiers(value);
        receipt.updated_at = new Date().toISOString();
        await this.save();
      });
      return {
        ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value }),
        operation: this.get(operationId),
      };
    } catch (error) {
      await this.enqueue(async () => {
        const receipt = this.records.get(operationId)!;
        receipt.status = 'unknown';
        receipt.updated_at = new Date().toISOString();
        await this.save();
      });
      throw new Error(
        `Operation ${operationId} has an uncertain outcome. Use slick_get_operation before retrying. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}
