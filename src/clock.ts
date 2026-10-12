export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Relógio controlado para testes: só anda quando alguém manda. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}
