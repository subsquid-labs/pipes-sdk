export class Heap<T> {
  private compare: (a: T, b: T) => number

  private arr: T[] = []

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare
  }

  peek(): T | undefined {
    return this.arr[0]
  }

  size(): number {
    return this.arr.length
  }

  push(v: T): void {
    const a = this.arr
    const compare = this.compare
    let pos = a.length
    let parent: number

    a.push(v)

    while (pos > 0) {
      parent = (pos - 1) >>> 1
      if (compare(a[parent], v) < 0) break
      a[pos] = a[parent]
      pos = parent
    }

    a[pos] = v
  }

  pop(): T | undefined {
    const a = this.arr
    const top = a[0]
    const popped = a.pop()

    if (a.length > 0) {
      siftDown(a, popped!, 0, a.length - 1, this.compare)
    }

    return top
  }

  popStrict(): T {
    const elem = this.pop()
    if (!elem) {
      throw new Error('Heap is empty')
    }

    return elem
  }

  resort(): void {
    if (this.arr.length === 0) return

    let last = this.arr.length - 1
    let i = (last - 1) >>> 1

    while (i >= 0) {
      siftDown(this.arr, this.arr[i], i, last, this.compare)
      i--
    }
  }

  init(arr: T[]): void {
    this.arr = arr
    this.resort()
  }
}

function siftDown<T>(a: T[], v: T, pos: number, last: number, compare: (a: T, b: T) => number): void {
  let left: number
  let right: number
  let next: number

  while (true) {
    left = (pos << 1) + 1
    right = left + 1

    if (right <= last) {
      next =
        compare(a[right], a[left]) < 0 ? (compare(a[right], v) < 0 ? right : pos) : compare(a[left], v) < 0 ? left : pos
    } else if (left === last) {
      next = compare(a[left], v) < 0 ? left : pos
    } else {
      next = pos
    }

    if (next === pos) break
    a[pos] = a[next]
    pos = next
  }

  a[pos] = v
}
