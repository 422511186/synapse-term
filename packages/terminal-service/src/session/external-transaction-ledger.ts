import type {
  ExternalCaller,
  ExternalTransactionKind,
  ExternalTransactionStatus,
} from '@synapse-term/domain';

/**
 * 一次活动外部事务的身份。
 *
 * 账本只持有身份与存在性，事务状态由持有该事务的执行器提供——账本不复制状态值，
 * 因为同一事实两处维护正是这次收敛要消除的东西。
 */
export interface ExternalTransactionEntry {
  readonly kind: ExternalTransactionKind;
  readonly transactionId: string;
  /** 发起该事务的调用方；结构化执行允许不携带调用方身份，因此可选。 */
  readonly caller?: ExternalCaller | undefined;
  /** 读取当前事务状态；只在条目存活期间被调用。 */
  status(): ExternalTransactionStatus;
}

/**
 * 「本 Session 当前有活动外部事务」这一事实的唯一权威。
 *
 * 由每份 Sharing 的组合点构造一份，注入两个执行器；执行器在启动时登记、在终态注销。
 * 注销点是事务终态，因此不需要为「事务已消失」定义状态读取。
 */
export class ExternalTransactionLedger {
  #entry: ExternalTransactionEntry | undefined;

  /** 登记一个新事务；同一 Session 已有活动事务时抛错。 */
  open(entry: ExternalTransactionEntry): void {
    if (this.#entry !== undefined) {
      throw new Error(
        `external transaction ${this.#entry.transactionId} is already active in this session`,
      );
    }
    this.#entry = entry;
  }

  /**
   * 注销事务。只有持有当前条目的执行器会调用它，因此 id 不匹配或条目已消失都按幂等处理，
   * 返回是否真的移除了条目。
   */
  close(transactionId: string): boolean {
    if (this.#entry?.transactionId !== transactionId) return false;
    this.#entry = undefined;
    return true;
  }

  get active(): ExternalTransactionEntry | undefined {
    return this.#entry;
  }
}
