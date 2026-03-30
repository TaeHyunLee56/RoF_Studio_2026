/// <reference types="w3c-web-serial" />

export class SerialController {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter | null = null;
  private reader: ReadableStreamDefaultReader | null = null;
  private isConnected: boolean = false;

  constructor() {
    if (!('serial' in navigator)) {
      console.error('[SerialController] Browser does not support the Web Serial API.');
    }
  }

  /**
   * 시리얼 포트 연결
   * @param baudRate - 보드레이트 (기본값: 115200)
   */
  async connect(baudRate: number = 115200): Promise<boolean> {
    try {
      if (!('serial' in navigator)) {
        throw new Error('Browser does not support the Web Serial API.');
      }
      this.port = await (navigator as any).serial.requestPort();

      if (this.port) {
        await this.port.open({ baudRate });

        if (this.port.writable) {
          this.writer = this.port.writable.getWriter();
        }

        if (this.port.readable) {
          this.reader = this.port.readable.getReader();
          this.startReading();
        }
      }

      this.isConnected = true;
      console.log(`[SerialController] Connected successfully (baud rate: ${baudRate})`);
      return true;
    } catch (error) {
      console.error('[SerialController] Connection failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      // Reader 해제
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }

      // Writer 해제
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }

      // 포트 닫기
      if (this.port) {
        await this.port.close();
        this.port = null;
      }

      this.isConnected = false;
      console.log('[SerialController] Disconnected successfully');
    } catch (error) {
      console.error('[SerialController] Disconnection failed:', error);
    }
  }

  /**
   * 데이터 전송
   * @param command - 전송할 명령어 (i/o/x)
   */
  async sendCommand(command: 'i' | 'o' | 'x'): Promise<boolean> {
    if (!this.isConnected || !this.writer) {
      console.error('[SerialController] Not connected or writer is unavailable.');
      return false;
    }

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(command);
      await this.writer.write(data);
      console.log(`[SerialController] Command sent: ${command}`);
      return true;
    } catch (error) {
      console.error('[SerialController] Failed to send command:', error);
      return false;
    }
  }

  // 가속 명령 전송 (i) = intro
  async accelerate(): Promise<boolean> {
    return await this.sendCommand('i');
  }

  // 감속 명령 전송 (o) - outro
  async decelerate(): Promise<boolean> {
    return await this.sendCommand('o');
  }

  
  // 네오픽셀 끄기 (x) - off
  async turnOff(): Promise<boolean> {
    return await this.sendCommand('x');
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  private async startReading(): Promise<void> {
    if (!this.reader) return;

    try {
      const decoder = new TextDecoder();
      while (this.isConnected && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) {
          console.log('[SerialController] Reader closed');
          break;
        }
        if (value) {
          const text = decoder.decode(value);
          console.log('[SerialController] Received:', text);
        }
      }
    } catch (error) {
      console.error('[SerialController] Reading error:', error);
    }
  }

  static async getAvailablePorts(): Promise<SerialPort[]> {
    if (!('serial' in navigator)) {
      console.error('[SerialController] Browser does not support the Web Serial API.');
      return [];
    }

    try {
      const ports = await (navigator as any).serial.getPorts();
      return ports;
    } catch (error) {
      console.error('[SerialController] Failed to get port list:', error);
      return [];
    }
  }
}

