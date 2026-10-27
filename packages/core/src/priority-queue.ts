/**
 * A binary min-heap priority queue.
 *
 * Hand-written rather than pulled from a library — it's the core data structure
 * behind Dijkstra and A*, and implementing it ourselves is part of the point of
 * GhMap. Supports `decreaseKey` via an index map so the shortest-path search
 * runs in O((V + E) log V).
 */
export class PriorityQueue<T> {
  /** Heap of items; index 0 is the minimum. */
  private readonly heap: T[] = [];
  /** Priority (cost) of each item, parallel to `heap`. */
  private readonly priorities: number[] = [];
  /** Maps an item to its current index in `heap`, for decreaseKey/has. */
  private readonly positions = new Map<T, number>();

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  has(item: T): boolean {
    return this.positions.has(item);
  }

  /** Insert an item, or lower its priority if already present. */
  push(item: T, priority: number): void {
    const existing = this.positions.get(item);
    if (existing !== undefined) {
      if (priority < this.priorities[existing]!) {
        this.priorities[existing] = priority;
        this.bubbleUp(existing);
      }
      return;
    }
    const idx = this.heap.length;
    this.heap.push(item);
    this.priorities.push(priority);
    this.positions.set(item, idx);
    this.bubbleUp(idx);
  }

  /** Remove and return the lowest-priority item, or undefined if empty. */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.length - 1;
    this.swap(0, last);
    this.heap.pop();
    this.priorities.pop();
    this.positions.delete(top);
    if (this.heap.length > 0) this.bubbleDown(0);
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[i]! >= this.priorities[parent]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.priorities[left]! < this.priorities[smallest]!) {
        smallest = left;
      }
      if (right < n && this.priorities[right]! < this.priorities[smallest]!) {
        smallest = right;
      }
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const hi = this.heap[i]!;
    const hj = this.heap[j]!;
    this.heap[i] = hj;
    this.heap[j] = hi;
    const pi = this.priorities[i]!;
    this.priorities[i] = this.priorities[j]!;
    this.priorities[j] = pi;
    this.positions.set(hj, i);
    this.positions.set(hi, j);
  }
}
