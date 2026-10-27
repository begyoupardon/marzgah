export class FakeClock {
  constructor(private current = new Date('2026-01-01T00:00:00Z')) {}
  now() {
    return new Date(this.current)
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms)
  }
}
