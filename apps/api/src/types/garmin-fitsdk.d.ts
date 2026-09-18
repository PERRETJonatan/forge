// @garmin/fitsdk ships .d.ts files with extension-less relative imports
// (e.g. `from "./stream"`), which don't resolve under our NodeNext
// moduleResolution. This is a minimal shim for the surface we use, matching
// the real API documented in the package's README and type files.
declare module "@garmin/fitsdk" {
  export class Stream {
    static fromBuffer(buffer: Uint8Array): Stream;
  }

  export class Decoder {
    constructor(stream: Stream);
    static isFIT(stream: Stream): boolean;
    read(options?: Record<string, unknown>): {
      messages: Record<string, unknown[] | undefined>;
      errors: Error[];
    };
  }
}
