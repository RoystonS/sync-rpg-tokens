import sharp from 'sharp';

import { cpus } from './config.js';

const quality = 80;

export class AvifProcessor {
  private readonly bufferRetriever: () => Promise<Buffer>;
  private buffer: Buffer | undefined;
  private avif: Buffer | undefined;

  public static setup() {
    sharp.concurrency(cpus * 2);
  }

  public constructor(bufferRetriever: () => Promise<Buffer>) {
    this.bufferRetriever = bufferRetriever;
  }

  public async getOriginalData() {
    if (!this.buffer) {
      this.buffer = await this.bufferRetriever();
    }
    return this.buffer;
  }

  public async getOriginalSize() {
    const buffer = await this.getOriginalData();
    return buffer.length;
  }

  public async getAvif() {
    if (!this.avif) {
      const buffer = await this.getOriginalData();

      const s = sharp(buffer).avif({ effort: 9, quality });
      this.avif = await s.toBuffer();
      s.destroy();
    }
    return this.avif;
  }

  public async getAvifSize() {
    const avif = await this.getAvif();
    return avif.length;
  }
}
